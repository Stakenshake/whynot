// exp5 — does the expiry mechanism actually prevent the harm?
//
// exp4/exp4b showed a 2019 "do not use TypeScript" entry made models reject
// TypeScript for a brand-new 2026 service, and that adding a warning to the
// prompt did not fix it.
//
// This time the injected context is produced by the REAL code path — the MCP
// `decisions_check` tool against a real .decisions/ directory — so a passing
// result means the shipped code works, not a hand-written approximation.
//
// Three conditions, same task:
//   plain    — no .decisions/ at all
//   expired  — the 2019 entry exists but has expired; the agent is not shown it
//   live     — same entry, renewed today; the agent IS shown it
//
// Expected: plain recommends TS, expired recommends TS (harm prevented),
// live does NOT recommend TS (the mechanism still works when current).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, create, renew } from '../../src/store.js';
import { callTool } from '../../src/mcp.js';

const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT_DIR = path.join(import.meta.dirname, 'out');
const RUNS = 3;

// Model availability shifts: deepseek/* and codex/* were rate-limited or out
// of balance during this run. opencode-go routes to separate accounts, so the
// experiment uses those — and it also exercises the exact provider the user
// was asking about.
const MODELS = [
  { id: 'opencode-go/deepseek-v4-pro', label: 'ds-v4-pro' },
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol' },
];

const TASK = `我们要开始一个**全新的**项目：一个面向企业的报表服务，后端 Node.js。
请给出你的技术选型建议，包括语言、框架和构建工具。`;

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

Before proposing a technical approach, call decisions_check with keywords for
what you are about to suggest. If the topic is covered, do not re-propose the
rejected option unless the stated condition has clearly been met.`;

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-exp5-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  init(root);
  const { id } = create(root, {
    title: '不使用 TypeScript',
    type: 'rejected',
    body: '## 结论\n不要在这个项目里引入 TypeScript。\n\n## 为什么\n当时团队没人会写 TS，编译流程也要额外配置，拖慢交付。',
    created: '2019-03-02',
    tags: ['tooling'],
  });
  return { root, id };
}

async function contextFor(cond) {
  if (cond === 'plain') return '';
  const { root, id } = makeRepo();
  if (cond === 'live') renew(root, id); // resets expiry from today

  // The real tool output — exactly what an agent with the MCP server attached
  // would receive.
  const res = callTool('decisions_check', { root, query: '语言 选型 TypeScript JavaScript' });
  return res.content[0].text;
}

async function call(model, messages) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 8000 }),
        signal: AbortSignal.timeout(300_000),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message?.slice(0, 150));
      const m = j.choices?.[0]?.message ?? {};
      const text = m.content || m.reasoning_content || '';
      if (!text) throw new Error('empty');
      return text;
    } catch (e) {
      if (a === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function judge(text) {
  const rubric = `判断一份技术选型建议的立场：是否推荐使用 TypeScript？

- 「推荐」= 建议采用 TypeScript
- 「排除」= 明确不采用 TypeScript，或建议 JavaScript 并说明理由
- 「未涉及」= 全文没提语言选择

只输出 JSON：{"verdict":"推荐"|"排除"|"未涉及","reason":"一句话"}`;

  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'moonshot-cn/kimi-k3',
          messages: [
            { role: 'system', content: rubric },
            { role: 'user', content: text.slice(0, 24_000) },
          ],
          temperature: 0,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const j = await res.json();
      const raw = j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning_content || '';
      const m = raw.match(/\{[\s\S]*?\}/);
      if (!m) throw new Error('no json');
      return JSON.parse(m[0]);
    } catch {
      if (a === 2) return { verdict: 'ERROR', reason: '' };
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Show what the agent actually receives in each condition, for the record.
for (const cond of ['plain', 'expired', 'live']) {
  const ctx = await contextFor(cond);
  console.log(`\n--- injected context [${cond}] (${ctx.length} chars) ---`);
  console.log(ctx ? ctx.slice(0, 500) : '(nothing)');
}
console.log('');

const rows = [];

for (const model of MODELS) {
  for (let i = 0; i < RUNS; i++) {
    for (const cond of ['plain', 'expired', 'live']) {
      const ctx = await contextFor(cond);
      const system = ctx ? `你是一个资深后端工程师，直接给出技术方案。\n\n${AGENTS_BLOCK}\n\n${ctx}` : '你是一个资深后端工程师，直接给出技术方案。';

      const text = await call(model.id, [
        { role: 'system', content: system },
        { role: 'user', content: TASK },
      ]);

      fs.writeFileSync(
        path.join(OUT_DIR, `exp5-${cond}-run${i}-${model.label}-${Date.now()}.md`),
        `# exp5 / ${cond} / ${model.label}\n\n## injected context\n\n${ctx || '(none)'}\n\n## response\n\n${text}\n`,
        'utf8'
      );

      const v = await judge(text);
      rows.push({ model: model.label, cond, verdict: v.verdict, reason: v.reason });
      console.log(`${model.label.padEnd(18)} ${cond.padEnd(9)} -> ${v.verdict}  (${v.reason})`);
    }
  }
}

console.log('\n================ exp5 汇总 ================');
for (const model of MODELS.map((m) => m.label)) {
  for (const cond of ['plain', 'expired', 'live']) {
    const r = rows.filter((x) => x.model === model && x.cond === cond);
    const ts = r.filter((x) => x.verdict === '推荐').length;
    const expect =
      cond === 'live' ? '期望：不推荐 TS（机制生效）' : '期望：推荐 TS（无害）';
    const ok = cond === 'live' ? ts === 0 : ts === r.length;
    console.log(`  ${model.padEnd(18)} ${cond.padEnd(9)} 推荐 TS ${ts}/${r.length}  ${ok ? '✓' : '✗'}  ${expect}`);
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'exp5.json'), JSON.stringify(rows, null, 2), 'utf8');
