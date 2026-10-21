// E1 — does real code context reduce a decision's influence?
//
// Every earlier experiment gave the model a task with no code. That leaves an
// alternative explanation for the results: the model obeyed the decision only
// because it had nothing else to reason from.
//
// This experiment crosses code context with the decision:
//
//   C0  no code, no decision     baseline
//   C1  no code, decision        replicates E3a
//   C2  code, no decision        does the code alone change the answer?
//   C3  code + decision          the cell that matters
//
// Pre-registered (docs/preregistration.md, H3):
//   avoidance in C3 >= 20 points lower than in C1 -> information vacuum is real
//   C3 ~= C1                                       -> the effect survives code
//
// Models: GPT and DeepSeek Flash. Judge: Claude Haiku (third family; Kimi is
// unavailable). Claude is only used for judging to preserve the 15% weekly
// allowance on opencode-go.
//
// Run: node experiments/e1/run.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, create } from '../../src/store.js';
import { callTool } from '../../src/mcp.js';

const HERE = import.meta.dirname;
const FIXTURE = path.join(HERE, 'fixture');
const OUT = path.join(HERE, 'out');
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const N = 12;
const CONCURRENCY = 6;

const MODELS = [
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol' },
  { id: 'workbuddy-ai/deepseek-v4.1-flash', label: 'ds-v4.1-flash' },
];

const JUDGE = 'opencode-go/claude-haiku-5-5';
const FALLBACK_JUDGE = 'workbuddy-ai/deepseek-v4.1-flash';

const TASK = `在这个 Node.js + Express 项目里加用户 session 存储。
大约 10 万 DAU，部署在 us-east 和 eu-west 两个区域。
请给出方案：选什么存储、为什么，以及需要改哪些文件。`;

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

Before proposing a technical approach, call decisions_check with keywords for
what you are about to suggest. If the topic is covered, do not re-propose the
rejected option unless the stated condition has clearly been met.`;

// ---------------------------------------------------------------- context

function readRepo() {
  const out = [];
  const walk = (dir, prefix = '') => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else out.push(`### ${rel}\n\`\`\`\n${fs.readFileSync(full, 'utf8').trimEnd()}\n\`\`\`\n`);
    }
  };
  walk(FIXTURE);
  return out.join('\n');
}

const CODE_CONTEXT = `## 项目代码\n\n${readRepo()}`;

function makeDecisionContext() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-e1-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  init(root);
  create(root, {
    title: 'session 不存 Redis',
    type: 'rejected',
    body:
      '## 结论\n不能把 session 存 Redis。\n\n## 为什么\n' +
      '试过 Redis + 单写区域。us-east 故障时读延迟飙到 8s，SLO 要求 p99 < 500ms。' +
      'Postgres 表方案已选中。',
    created: '2026-09-21',
    expires_on: '2027-10-21',
    tags: ['infra', 'session'],
  });

  const text = callTool('decisions_check', {
    root,
    query: 'session 存储 Redis',
  }).content[0].text;

  // Fail fast: a context that does not contain the entry would make the
  // treatment identical to the control.
  if (!text.includes('session 不存 Redis')) {
    throw new Error(`decision context missing the entry: ${text.slice(0, 120)}`);
  }
  return text;
}

const DECISION_CONTEXT = makeDecisionContext();

const CONDITIONS = [
  { key: 'C0', label: 'no-code-no-decision', code: false, decision: false },
  { key: 'C1', label: 'no-code-decision', code: false, decision: true },
  { key: 'C2', label: 'code-no-decision', code: true, decision: false },
  { key: 'C3', label: 'code-decision', code: true, decision: true },
];

function systemFor(cond) {
  const parts = ['你是一个资深后端工程师，直接给出方案。'];
  if (cond.code) parts.push(CODE_CONTEXT);
  if (cond.decision) parts.push(AGENTS_BLOCK, DECISION_CONTEXT);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------- helpers

async function callModel(model, messages, maxTokens = 5000) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens }),
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

async function judgeOne(text, model) {
  const rubric = `判断一份技术方案是否推荐使用 Redis 作为 session 存储。

- RECOMMENDS = 建议采用 Redis（含 connect-redis、ElastiCache、Valkey 等）
- EXCLUDES = 明确不采用 Redis，或选了非 Redis 方案并说明理由
- UNCLEAR = 全文没提 session 存储方案

只输出 JSON：{"verdict":"RECOMMENDS"|"EXCLUDES"|"UNCLEAR"}`;

  for (let a = 0; a < 3; a++) {
    try {
      const raw = await callModel(
        model,
        [
          { role: 'system', content: rubric },
          { role: 'user', content: text.slice(0, 24_000) },
        ],
        1500
      );
      const m = raw.match(/\{[\s\S]*?\}/);
      if (!m) throw new Error('no json');
      const v = String(JSON.parse(m[0]).verdict || '').toUpperCase();
      return v.includes('EXCLUDE') ? 'excludes' : v.includes('RECOMMEND') ? 'recommends' : 'unclear';
    } catch {
      if (a === 2) return 'error';
      await new Promise((r) => setTimeout(r, 1200));
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

function wilson(k, n, z = 1.96) {
  if (!n) return [NaN, NaN];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// ---------------------------------------------------------------- run

fs.mkdirSync(OUT, { recursive: true });
for (const c of CONDITIONS) {
  fs.writeFileSync(path.join(HERE, `system-${c.key}.txt`), systemFor(c), 'utf8');
}

const codeTokens = Math.round(CODE_CONTEXT.length / 3.5);
console.log('E1 — code context vs decision influence');
console.log(`models: ${MODELS.map((m) => m.label).join(', ')}   judge: ${JUDGE}`);
console.log(`conditions: ${CONDITIONS.map((c) => c.key).join(', ')}   n=${N}`);
console.log(`code context: ${CODE_CONTEXT.length} chars (~${codeTokens} tokens)`);
console.log(`planned calls: ${CONDITIONS.length * MODELS.length * N} generation + same judging\n`);

const rows = [];

for (const cond of CONDITIONS) {
  const system = systemFor(cond);

  for (const model of MODELS) {
    const runs = Array.from({ length: N }, (_, i) => i);

    const results = await pool(runs, CONCURRENCY, async (i) => {
      const text = await callModel(model.id, [
        { role: 'system', content: system },
        { role: 'user', content: TASK },
      ]);

      fs.writeFileSync(
        path.join(OUT, `e1-${cond.key}-run${i}-${model.label}-${Date.now()}.md`),
        `# E1 / ${cond.key} (${cond.label}) / ${model.label} / run ${i}\n\n## response\n\n${text}\n`,
        'utf8'
      );

      let verdict = await judgeOne(text, JUDGE);
      let used = JUDGE;
      if (verdict === 'error') {
        verdict = await judgeOne(text, FALLBACK_JUDGE);
        used = FALLBACK_JUDGE;
      }
      return { cond: cond.key, model: model.label, run: i, verdict, judge: used };
    });

    rows.push(...results);
    const valid = results.filter((r) => r.verdict !== 'error');
    const rec = valid.filter((r) => r.verdict === 'recommends').length;
    console.log(
      `  ${cond.key} ${cond.label.padEnd(20)} ${model.label.padEnd(14)} recommends Redis ${rec}/${valid.length}` +
        (valid.length !== results.length ? ` (err ${results.length - valid.length})` : '')
    );
  }
}

// ---------------------------------------------------------------- analysis

console.log('\n================ E1 results ================\n');
console.log('recommends Redis / valid   (lower = the decision is being followed)\n');

const summary = {};
for (const cond of CONDITIONS) {
  const cells = MODELS.map((m) => {
    const r = rows.filter((x) => x.cond === cond.key && x.model === m.label && x.verdict !== 'error');
    return { model: m.label, n: r.length, events: r.filter((x) => x.verdict === 'recommends').length };
  });
  const n = cells.reduce((s, c) => s + c.n, 0);
  const ev = cells.reduce((s, c) => s + c.events, 0);
  summary[cond.key] = { cells, n, events: ev };

  console.log(
    `${cond.key} ${cond.label.padEnd(20)} ` +
      cells.map((c) => `${c.events}/${c.n}`.padEnd(12)).join('') +
      `  pooled ${ev}/${n} [${(wilson(ev, n)[0] * 100).toFixed(0)}–${(wilson(ev, n)[1] * 100).toFixed(0)}%]`
  );
}

const rate = (k) => summary[k].events / summary[k].n;
const c1 = rate('C1');
const c3 = rate('C3');
const c2 = rate('C2');
const c0 = rate('C0');

console.log('\n================ comparison ================');
console.log(`  C0 no code, no decision : ${(c0 * 100).toFixed(0)}% recommend Redis`);
console.log(`  C1 no code + decision   : ${(c1 * 100).toFixed(0)}%`);
console.log(`  C2 code, no decision    : ${(c2 * 100).toFixed(0)}%`);
console.log(`  C3 code + decision      : ${(c3 * 100).toFixed(0)}%`);
console.log('');
console.log(`  decision effect without code (C1 - C0): ${((c1 - c0) * 100).toFixed(0)} pts`);
console.log(`  decision effect with code    (C3 - C2): ${((c3 - c2) * 100).toFixed(0)} pts`);
console.log(`  code effect without decision (C2 - C0): ${((c2 - c0) * 100).toFixed(0)} pts`);
console.log('');
console.log(`  H3 test (avoidance in C3 vs C1): ${((c3 - c1) * 100).toFixed(0)} pts`);

let decision;
if (c3 - c1 >= 0.2) decision = 'H3 SUPPORTED — code context substantially weakens the decision. Rewrite the public claim.';
else if (Math.abs(c3 - c1) < 0.1) decision = 'H3 NOT SUPPORTED — the effect survives code context. Claim holds.';
else decision = 'PARTIAL / INCONCLUSIVE — report as such.';
console.log(`\n  -> ${decision}`);

const errors = rows.filter((r) => r.verdict === 'error').length;
console.log(`\ntotal rows: ${rows.length}   errors: ${errors}`);

fs.writeFileSync(
  path.join(HERE, 'e1-summary.json'),
  JSON.stringify({ rows, summary, rates: { c0, c1, c2, c3 }, decision, errors }, null, 2),
  'utf8'
);
console.log('written: experiments/e1/');
