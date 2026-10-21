// E3 — statistical power.
//
// Repeats the two central experiments at n=20 across three model families, and
// reports confidence intervals and a Fisher exact test rather than bare ratios.
//
//   E3a  Redis:      control (no record) vs treatment (recorded rejection)
//   E3b  TypeScript: control (no record) vs stale (7-year-old rejection)
//
// Pre-registered decision rule (docs/preregistration.md):
//   pooled p < 0.01 and risk difference >= 0.40  -> main claim stands
//   p < 0.05 with a smaller effect               -> downgrade the wording
//   not significant                              -> publish the correction
//
// Hard-won rule from E4: an `error` verdict is never a data point. Errors are
// excluded from denominators, reported, and re-judged with a fallback judge.
//
// Run: node experiments/e3/run.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, create } from '../../src/store.js';
import { callTool } from '../../src/mcp.js';

const HERE = import.meta.dirname;
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT = path.join(HERE, 'out');
const N = 20;
const CONCURRENCY = 6;

// opencode-go is at 18% for the week, so DeepSeek is served by workbuddy,
// which has its own credit pool. Claude stays on opencode-go but is cheap.
const MODELS = [
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol', family: 'OpenAI' },
  { id: 'workbuddy-ai/deepseek-v4.1-flash', label: 'ds-v4.1-flash', family: 'DeepSeek' },
  { id: 'opencode-go/claude-haiku-5-5', label: 'haiku-5.5', family: 'Anthropic' },
];

const JUDGE = 'moonshot-cn/kimi-k3';
const FALLBACK_JUDGE = 'workbuddy-ai/deepseek-v4.1-flash';

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

Before proposing a technical approach, call decisions_check with keywords for
what you are about to suggest. If the topic is covered, do not re-propose the
rejected option unless the stated condition has clearly been met.`;

const TASK_REDIS = `我们在做一个 Node.js + Express 的 SaaS，现在需要加用户 session 存储。
大约 10 万 DAU，部署在 us-east 和 eu-west 两个区域。
请给出你的技术方案，说明选型和理由。`;

const TASK_TS = `我们要开始一个**全新的**项目：一个面向企业的报表服务，后端 Node.js。
请给出你的技术选型建议，包括语言、框架和构建工具。`;

const FUTURE = '2027-10-21';

function makeContext({ title, body, created, tags }, query) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-e3-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  init(root);
  create(root, { title, type: 'rejected', body, created, expires_on: FUTURE, tags });
  const text = callTool('decisions_check', { root, query }).content[0].text;

  // Fail fast. A query that does not match the entry makes the treatment
  // condition identical to the control, and the experiment silently measures
  // nothing. This happened on the first run: the query said 存储 while the
  // decision said 存.
  if (!text.includes(title)) {
    throw new Error(
      `Context for "${title}" did not contain the entry. Query was: "${query}". ` +
        `Returned: ${text.slice(0, 120)}`
    );
  }
  return text;
}

const DECISION_REDIS = {
  title: 'session 不存 Redis',
  body: '## 结论\n不能把 session 存 Redis。\n\n## 为什么\n试过 Redis + 单写区域。us-east 故障时读延迟飙到 8s，SLO 要求 p99 < 500ms。Postgres 表方案已选中。',
  created: '2026-09-21',
  tags: ['infra', 'session'],
};

const DECISION_TS = {
  title: '不使用 TypeScript',
  body: '## 结论\n不要在这个项目里引入 TypeScript。\n\n## 为什么\n当时团队没人会写 TS，编译流程也要额外配置，拖慢交付。',
  created: '2019-03-02',
  tags: ['tooling'],
};

const EXPERIMENTS = [
  {
    key: 'E3a',
    name: 'redis',
    task: TASK_REDIS,
    target: 'Redis',
    // Must contain words that actually appear in the entry. The first run used
    // 技术/选型/存储/语言, none of which match "session 存 Redis", so the tool
    // returned "nothing found" and the treatment equalled the control.
    query: 'session 存储 Redis',
    decision: DECISION_REDIS,
    conditions: [
      { key: 'control', useDecision: false },
      { key: 'treatment', useDecision: true },
    ],
  },
  {
    key: 'E3b',
    name: 'typescript',
    task: TASK_TS,
    target: 'TypeScript',
    query: '语言 选型 TypeScript JavaScript',
    decision: DECISION_TS,
    conditions: [
      { key: 'control', useDecision: false },
      { key: 'stale', useDecision: true },
    ],
  },
];

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

async function judgeOne(text, target, model = JUDGE) {
  const rubric = `判断一份技术建议的立场：是否推荐使用 ${target}？

- RECOMMENDS = 建议采用 ${target}
- EXCLUDES = 明确不采用 ${target}，或选了非 ${target} 的方案并说明理由
- UNCLEAR = 全文没提这个选择

只输出 JSON：{"verdict":"RECOMMENDS"|"EXCLUDES"|"UNCLEAR"}`;

  for (let a = 0; a < 3; a++) {
    try {
      const raw = await callModel(
        model,
        [
          { role: 'system', content: rubric },
          { role: 'user', content: text.slice(0, 20_000) },
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

/** Wilson score interval for a binomial proportion. */
function wilson(k, n, z = 1.96) {
  if (n === 0) return [NaN, NaN];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function logChoose(n, k) {
  let r = 0;
  for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i);
  return r;
}

/** Two-sided Fisher exact test for a 2x2 table [[a,b],[c,d]]. */
function fisherExact(a, b, c, d) {
  const r1 = a + b, r2 = c + d, c1 = a + c, c2 = b + d, n = r1 + r2;
  const prob = (x) =>
    Math.exp(logChoose(r1, x) + logChoose(r2, c1 - x) - logChoose(n, c1));

  const pObs = prob(a);
  let p = 0;
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  for (let x = lo; x <= hi; x++) {
    const px = prob(x);
    if (px <= pObs + 1e-12) p += px;
  }
  return Math.min(1, p);
}

// ---------------------------------------------------------------- run

fs.mkdirSync(OUT, { recursive: true });
const allRows = [];

console.log('E3 — statistical power');
console.log(`models: ${MODELS.map((m) => m.label).join(', ')}`);
console.log(`judge: ${JUDGE} (fallback: ${FALLBACK_JUDGE})`);
console.log(`n=${N} per cell\n`);

for (const exp of EXPERIMENTS) {
  for (const cond of exp.conditions) {
    const context = cond.useDecision ? makeContext(exp.decision, exp.query) : '';
    const system = context
      ? `你是一个资深后端工程师，直接给出技术方案。\n\n${AGENTS_BLOCK}\n\n${context}`
      : '你是一个资深后端工程师，直接给出技术方案。';

    fs.writeFileSync(path.join(HERE, `context-${exp.key}-${cond.key}.txt`), context || '(none)', 'utf8');

    for (const model of MODELS) {
      const runs = Array.from({ length: N }, (_, i) => i);

      const results = await pool(runs, CONCURRENCY, async (i) => {
        const text = await callModel(model.id, [
          { role: 'system', content: system },
          { role: 'user', content: exp.task },
        ]);

        fs.writeFileSync(
          path.join(OUT, `${exp.key}-${cond.key}-run${i}-${model.label}-${Date.now()}.md`),
          `# ${exp.key} / ${cond.key} / ${model.label} / run ${i}\n\n## response\n\n${text}\n`,
          'utf8'
        );

        let verdict = await judgeOne(text, exp.target);
        let judgeUsed = JUDGE;

        // Errors are never data. Re-judge with the fallback, and if that also
        // fails the row stays `error` and is excluded from the analysis.
        if (verdict === 'error') {
          verdict = await judgeOne(text, exp.target, FALLBACK_JUDGE);
          judgeUsed = FALLBACK_JUDGE;
        }

        return { exp: exp.key, target: exp.target, cond: cond.key, model: model.label, run: i, verdict, judgeUsed };
      });

      allRows.push(...results);
      const valid = results.filter((r) => r.verdict !== 'error');
      const hit = valid.filter((r) => r.verdict === 'recommends').length;
      console.log(`  ${exp.key} ${cond.key.padEnd(10)} ${model.label.padEnd(14)} recommends ${hit}/${valid.length}` +
        (valid.length !== results.length ? ` (err ${results.length - valid.length})` : ''));
    }
  }
}

// ---------------------------------------------------------------- analysis

console.log('\n================ analysis ================\n');

const report = {};

for (const exp of EXPERIMENTS) {
  console.log(`### ${exp.key} — recommends ${exp.target} (lower = decision followed)\n`);

  const perModel = [];
  for (const model of MODELS) {
    const cell = (cond) => {
      const r = allRows.filter((x) => x.exp === exp.key && x.cond === cond && x.model === model.label);
      const valid = r.filter((x) => x.verdict !== 'error');
      return { n: valid.length, events: valid.filter((x) => x.verdict === 'recommends').length, errors: r.length - valid.length };
    };
    const c = cell('control');
    const t = cell(exp.conditions[1].key);

    const pC = c.events / c.n;
    const pT = t.events / t.n;
    const [cl, ch] = wilson(c.events, c.n);
    const [tl, th] = wilson(t.events, t.n);
    const p = fisherExact(c.events, c.n - c.events, t.events, t.n - t.events);
    const rd = pT - pC;

    console.log(`${model.label.padEnd(16)} control ${c.events}/${c.n} [${(cl * 100).toFixed(0)}–${(ch * 100).toFixed(0)}%]` +
      `   treatment ${t.events}/${t.n} [${(tl * 100).toFixed(0)}–${(th * 100).toFixed(0)}%]` +
      `   risk diff ${(rd * 100).toFixed(0)} pts   Fisher p=${p < 0.0001 ? '<0.0001' : p.toFixed(4)}` +
      (c.errors || t.errors ? `   errors ${c.errors + t.errors}` : ''));

    perModel.push({ model: model.label, control: c, treatment: t, p, riskDiff: rd });
  }

  // Pooled: sum the cells. Reported alongside the per-model results, not
  // instead of them, because pooling hides heterogeneity.
  const cAll = perModel.reduce((a, x) => ({ n: a.n + x.control.n, events: a.events + x.control.events }), { n: 0, events: 0 });
  const tAll = perModel.reduce((a, x) => ({ n: a.n + x.treatment.n, events: a.events + x.treatment.events }), { n: 0, events: 0 });
  const pPool = fisherExact(cAll.events, cAll.n - cAll.events, tAll.events, tAll.n - tAll.events);
  const rdPool = tAll.events / tAll.n - cAll.events / cAll.n;

  console.log(`\nPOOLED            control ${cAll.events}/${cAll.n}   treatment ${tAll.events}/${tAll.n}` +
    `   risk diff ${(rdPool * 100).toFixed(0)} pts   Fisher p=${pPool < 0.0001 ? '<0.0001' : pPool.toFixed(4)}\n`);

  let decision;
  if (pPool < 0.01 && Math.abs(rdPool) >= 0.4) decision = 'MAIN CLAIM STANDS';
  else if (pPool < 0.05) decision = 'DOWNGRADE — significant but smaller than pre-registered';
  else decision = 'NOT SIGNIFICANT — publish the correction';

  console.log(`  -> ${decision}\n`);
  report[exp.key] = { perModel, pooled: { control: cAll, treatment: tAll, p: pPool, riskDiff: rdPool, decision } };
}

const errors = allRows.filter((r) => r.verdict === 'error').length;
console.log(`total rows: ${allRows.length}   errors: ${errors}`);

fs.writeFileSync(path.join(HERE, 'e3-summary.json'), JSON.stringify({ rows: allRows, report, errors }, null, 2), 'utf8');
console.log('\nwritten: experiments/e3/');
