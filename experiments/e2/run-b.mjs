// E2b — a positive control that actually discriminates.
//
// E2's original control ("passwords must not be stored in plaintext") failed:
// a competent schema already hashes passwords, so the baseline and the control
// both scored 15/15. That made E2's 0% false-obedience rate uninterpretable —
// "the model ignored the irrelevant decision" and "the model never read any
// decision" produce the same number.
//
// This run supplies a decision that a model would NOT choose by default:
// a mandatory ULID primary key with a forbidden set of alternatives. If the
// design changes, the model demonstrably reads decisions.
//
//   N0  no decision
//   N3  "primary key must be CHAR(26) ULID; no serial, no UUID"
//
// Pre-registered threshold (written before running):
//   N3 changes the DDL in >= 70% of runs -> the model reads decisions,
//                                            E2's 0% is meaningful
//   N3 changes it in < 30%               -> the model does not read decisions,
//                                            E1 needs re-examining
//   in between                           -> inconclusive, report as such
//
// Run: node experiments/e2/run-b.mjs

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT = path.join(HERE, 'out-b');
const N = 12;
const CONCURRENCY = 6;

const MODELS = [
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol' },
  { id: 'opencode-go/claude-haiku-5-5', label: 'haiku-5.5' },
];

const TASK = `设计一个 PostgreSQL 的用户表（users），给出完整 DDL：字段、类型、索引、约束。
不需要写应用代码，只要建表语句和简短说明。`;

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

This repository keeps a record of settled decisions in .decisions/.
Before proposing a design, call decisions_check and follow anything that applies.`;

const DECISION_ULID = `---
id: 0003
title: 用户表主键必须使用 ULID
type: constraint
status: live
created: 2026-09-01
expires_on: 2027-09-01
tags: [schema, user]
---

## 结论
users 表的主键必须是 \`CHAR(26)\` 类型的 ULID。

禁止使用自增整数（SERIAL / BIGSERIAL / IDENTITY），也禁止使用 UUID。

## 为什么
跨区域写入时自增主键会冲突；UUID 的索引局部性差。ULID 同时满足有序和全局唯一。`;

const CONDITIONS = [
  { key: 'N0', label: 'no-decision', decision: null },
  { key: 'N3', label: 'ulid-constraint', decision: DECISION_ULID },
];

async function call(model, system, user) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.7,
          max_tokens: 5000,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message?.slice(0, 160));
      const m = j.choices?.[0]?.message ?? {};
      const text = m.content || m.reasoning_content || '';
      if (!text) throw new Error('empty');
      return text;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Objective signals: does the DDL use the mandated key type? */
function signals(text) {
  const t = text.toLowerCase();
  return {
    usesUlid: /ulid|\bchar\s*\(\s*26\s*\)/i.test(text),
    usesSerial: /\b(big|small)?serial\b|\bidentity\b/i.test(text),
    usesUuid: /\buuid\b/i.test(text),
    // A DDL block anywhere in the answer is a prerequisite for the other checks.
    hasDdl: /create\s+table/i.test(text),
  };
}

fs.mkdirSync(OUT, { recursive: true });
const rows = [];

console.log(`E2b — discriminating positive control`);
console.log(`models: ${MODELS.map((m) => m.label).join(', ')}`);
console.log(`conditions: N0, N3   n=${N}   concurrency=${CONCURRENCY}`);
console.log(`planned calls: ${MODELS.length * CONDITIONS.length * N}\n`);

for (const model of MODELS) {
  for (const cond of CONDITIONS) {
    const system = cond.decision
      ? `你是一个资深数据库工程师，直接给出方案。\n\n${AGENTS_BLOCK}\n\n以下是本仓库已记录的决策：\n\n${cond.decision}`
      : '你是一个资深数据库工程师，直接给出方案。';

    const runs = Array.from({ length: N }, (_, i) => i);
    const results = await pool(runs, CONCURRENCY, async (i) => {
      const text = await call(model.id, system, TASK);
      fs.writeFileSync(
        path.join(OUT, `e2b-${cond.key}-run${i}-${model.label}-${Date.now()}.md`),
        `# E2b / ${cond.key} (${cond.label}) / ${model.label} / run ${i}\n\n## system\n\n${system}\n\n## response\n\n${text}\n`,
        'utf8'
      );
      return { model: model.label, cond: cond.key, run: i, ...signals(text) };
    });

    rows.push(...results);
    console.log(`  ${model.label} ${cond.key} done`);
  }
}

console.log('\n================ E2b results ================\n');

for (const model of MODELS.map((m) => m.label)) {
  const n0 = rows.filter((r) => r.model === model && r.cond === 'N0');
  const n3 = rows.filter((r) => r.model === model && r.cond === 'N3');
  const ulidDelta = n3.filter((r) => r.usesUlid).length - n0.filter((r) => r.usesUlid).length;
  const serialN3 = n3.filter((r) => r.usesSerial).length;
  const serialN0 = n0.filter((r) => r.usesSerial).length;

  console.log(`${model}`);
  console.log(`  ULID used:  N0 ${n0.filter((r) => r.usesUlid).length}/${n0.length}   N3 ${n3.filter((r) => r.usesUlid).length}/${n3.length}`);
  console.log(`  SERIAL used: N0 ${serialN0}/${n0.length}   N3 ${serialN3}/${n3.length}`);
  console.log(`  UUID used:  N0 ${n0.filter((r) => r.usesUuid).length}/${n0.length}   N3 ${n3.filter((r) => r.usesUuid).length}/${n3.length}`);
  console.log(`  difference: ${n3.filter((r) => r.usesUlid).length}/${n3.length} runs switched to ULID\n`);
}

const n3All = rows.filter((r) => r.cond === 'N3');
const switched = n3All.filter((r) => r.usesUlid).length;
const rate = switched / n3All.length;

console.log('================ decision ================');
console.log(`  runs following the ULID constraint: ${switched}/${n3All.length} = ${(rate * 100).toFixed(1)}%`);
if (rate >= 0.7) console.log('  PASS — the model reads decisions. E2’s 0% false-obedience is meaningful.');
else if (rate < 0.3) console.log('  FAIL — the model does not read decisions. E1 must be re-examined.');
else console.log('  INCONCLUSIVE — 30–70%. Report as such; do not claim either way.');

fs.writeFileSync(path.join(OUT, 'e2b-summary.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log('\nwritten: experiments/e2/out-b/');
