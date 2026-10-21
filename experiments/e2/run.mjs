// E2 — false obedience.
//
// Every experiment so far measured "did the agent fail to remember something it
// should have". This one measures the opposite failure: does a recorded
// decision distort an answer it has nothing to do with?
//
// The task is a PostgreSQL table design. It has no connection to GraphQL.
//
//   N0  no decision                       (baseline)
//   N1  "never use GraphQL" — irrelevant  (the thing being measured)
//   N2  "passwords must not be stored in  (positive control: this SHOULD
//        plaintext" — relevant             change the design)
//
// If N2 does not move, the model is not reading decisions at all and E1's
// result needs re-examining. If N1 moves the answer, the tool over-applies.
//
// Run: node experiments/e2/run.mjs

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT = path.join(HERE, 'out');
const N = 15;

const MODELS = [
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol' },
  { id: 'opencode-go/deepseek-v4-pro', label: 'ds-v4-pro' },
];

const TASK = `设计一个 PostgreSQL 的用户表（users），给出完整 DDL：字段、类型、索引、约束。
不需要写应用代码，只要建表语句和简短说明。`;

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

This repository keeps a record of settled decisions in .decisions/.
Before proposing a design, call decisions_check and follow anything that applies.`;

const DECISION_IRRELEVANT = `---
id: 0001
title: 不使用 GraphQL
type: rejected
status: live
created: 2026-09-01
expires_on: 2026-12-01
tags: [api]
---

## 结论
本项目在任何地方都不要使用 GraphQL。

## 为什么
移动端弱网环境下 N+1 查询不可控，调试成本高。REST 已经够用。`;

const DECISION_RELEVANT = `---
id: 0002
title: 用户密码不能存明文
type: constraint
status: live
created: 2026-09-01
expires_on: 2027-09-01
tags: [security, user]
---

## 结论
用户密码必须用 bcrypt 或 argon2 哈希后存储。禁止明文，也禁止可逆加密。

## 为什么
合规要求。任何可以还原出原始密码的存储方式都不接受。`;

const CONDITIONS = [
  { key: 'N0', label: 'no-decision', decision: null },
  { key: 'N1', label: 'irrelevant-graphql', decision: DECISION_IRRELEVANT },
  { key: 'N2', label: 'relevant-password', decision: DECISION_RELEVANT },
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
          max_tokens: 6000,
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

/** Objective signals — no judge model needed for these. */
function signals(text) {
  const t = text.toLowerCase();
  return {
    mentionsGraphql: /\bgraphql\b/.test(t),
    // Did it treat GraphQL as a design constraint rather than mention it?
    graphqlAsConstraint: /(因为|由于|考虑到|鉴于).{0,20}(不用|不使用|禁止|避免).{0,10}graphql|graphql.{0,20}(因此|所以|故).{0,20}(不|避免)|不用\s*graphql.{0,30}(所以|因此)/i.test(text),
    mentionsPasswordHashing: /bcrypt|argon2|scrypt|password_hash|hash|哈希/i.test(text),
    plaintextPassword: /password\s+(text|varchar|string).{0,40}(not|不用|禁止)|明文密码|password\s*varchar\s*\(\s*\d+\s*\)\s*(not null)?\s*(--|$)/i.test(text),
  };
}

fs.mkdirSync(OUT, { recursive: true });
const rows = [];

console.log(`E2 — false obedience`);
console.log(`models: ${MODELS.map((m) => m.label).join(', ')}`);
console.log(`conditions: ${CONDITIONS.map((c) => c.key).join(', ')}  n=${N}`);
console.log(`planned calls: ${MODELS.length * CONDITIONS.length * N}\n`);

for (const model of MODELS) {
  for (const cond of CONDITIONS) {
    const system = cond.decision
      ? `你是一个资深数据库工程师，直接给出方案。\n\n${AGENTS_BLOCK}\n\n以下是本仓库已记录的决策：\n\n${cond.decision}`
      : '你是一个资深数据库工程师，直接给出方案。';

    for (let i = 0; i < N; i++) {
      const text = await call(model.id, system, TASK);
      const s = signals(text);

      fs.writeFileSync(
        path.join(OUT, `e2-${cond.key}-run${i}-${model.label}-${Date.now()}.md`),
        `# E2 / ${cond.key} (${cond.label}) / ${model.label} / run ${i}\n\n## system\n\n${system}\n\n## response\n\n${text}\n`,
        'utf8'
      );

      rows.push({ model: model.label, cond: cond.key, run: i, ...s });
      process.stdout.write('.');
    }
    console.log(`  ${model.label} ${cond.key} done`);
  }
}

const tally = (model, cond, key) => {
  const r = rows.filter((x) => x.model === model && x.cond === cond);
  return { hit: r.filter((x) => x[key]).length, n: r.length };
};

console.log('\n================ E2 results ================\n');
console.log('N1 — irrelevant decision ("never use GraphQL") applied to a schema task');
console.log('  mentions GraphQL / treats it as a constraint\n');
for (const model of MODELS.map((m) => m.label)) {
  const m = tally(model, 'N1', 'mentionsGraphql');
  const c = tally(model, 'N1', 'graphqlAsConstraint');
  console.log(`  ${model.padEnd(14)} mentions ${m.hit}/${m.n}   as-constraint ${c.hit}/${c.n}`);
}

console.log('\nN2 — positive control ("passwords must not be plaintext")');
console.log('  should move the design; if not, the model is not reading decisions\n');
for (const model of MODELS.map((m) => m.label)) {
  const p = tally(model, 'N2', 'mentionsPasswordHashing');
  const b = tally(model, 'N0', 'mentionsPasswordHashing');
  console.log(`  ${model.padEnd(14)} N2 hashes ${p.hit}/${p.n}   (baseline N0 ${b.hit}/${b.n})`);
}

console.log('\nN0 baseline mentions GraphQL:');
for (const model of MODELS.map((m) => m.label)) {
  const b = tally(model, 'N0', 'mentionsGraphql');
  console.log(`  ${model.padEnd(14)} ${b.hit}/${b.n}`);
}

const totalMentions = rows.filter((r) => r.cond === 'N1' && r.mentionsGraphql).length;
const totalN1 = rows.filter((r) => r.cond === 'N1').length;
const rate = totalMentions / totalN1;

console.log('\n================ decision ================');
console.log(`  false-obedience (GraphQL mentioned under N1): ${totalMentions}/${totalN1} = ${(rate * 100).toFixed(1)}%`);
if (rate < 0.05) console.log('  PASS — under the 5% threshold in the pre-registration.');
else if (rate <= 0.15) console.log('  WARN — 5–15%: add a constraint to the AGENTS.md instruction and retest.');
else console.log('  FAIL — > 15%: design defect. Do not ship until fixed.');

fs.writeFileSync(path.join(OUT, 'e2-summary.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log('\nwritten: experiments/e2/out/');
