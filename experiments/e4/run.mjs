// E4 — dose-response: does the age of a decision change how often it is followed?
//
// The decision text is identical in every condition. Only `created` changes.
// The injected context is produced by the real `decisions_check` tool against a
// real .decisions/ directory, so this tests the shipped code path.
//
//   D0  no decision                     (baseline)
//   D1  1 month old, live
//   D2  6 months old, live
//   D3  1 year old, live
//   D4  3 years old, live
//   D5  7 years old, live
//   D6  7 years old, EXPIRED            (must match D0 if expiry works)
//
// Pre-registered (see docs/preregistration.md):
//   D1 < 30% and D5 > 70%   -> H5, obedience increases with age
//   D1..D5 all > 70%        -> H5', obedience is age-independent (stronger claim)
//   D6 not close to D0      -> the expiry mechanism is faulty; stop
//
// Run: node experiments/e4/run.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init, create } from '../../src/store.js';
import { callTool } from '../../src/mcp.js';

const HERE = import.meta.dirname;
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT = path.join(HERE, 'out');
const N = 12;
const CONCURRENCY = 6;

const MODELS = [
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol' },
  { id: 'opencode-go/claude-haiku-5-5', label: 'haiku-5.5' },
];

const JUDGE = 'moonshot-cn/kimi-k3';

const TASK = `我们要开始一个**全新的**项目：一个面向企业的报表服务，后端 Node.js。
请给出你的技术选型建议，包括语言、框架和构建工具。`;

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

Before proposing a technical approach, call decisions_check with keywords for
what you are about to suggest. If the topic is covered, do not re-propose the
rejected option unless the stated condition has clearly been met.`;

const BODY =
  '## 结论\n不要在这个项目里引入 TypeScript。\n\n' +
  '## 为什么\n企业报表服务的字段和接口变更频繁，但引入 TypeScript 需要额外的编译与构建配置；' +
  '当时判断这会让交付变慢。';

const FUTURE = '2027-10-21';
const PAST = '2026-01-01';

function daysAgo(days) {
  const d = new Date('2026-10-21');
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const CONDITIONS = [
  { key: 'D0', label: 'no-decision', ageDays: null, expired: false },
  { key: 'D1', label: '1-month', ageDays: 30, expired: false },
  { key: 'D2', label: '6-months', ageDays: 182, expired: false },
  { key: 'D3', label: '1-year', ageDays: 365, expired: false },
  { key: 'D4', label: '3-years', ageDays: 1095, expired: false },
  { key: 'D5', label: '7-years', ageDays: 2555, expired: false },
  { key: 'D6', label: '7-years-expired', ageDays: 2555, expired: true },
];

/** Build the exact context the agent would receive from the real tool. */
function contextFor(cond) {
  if (cond.key === 'D0') return '';

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-e4-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  init(root);

  create(root, {
    title: '不使用 TypeScript',
    type: 'rejected',
    body: BODY,
    created: daysAgo(cond.ageDays),
    expires_on: cond.expired ? PAST : FUTURE,
    tags: ['tooling'],
  });

  const res = callTool('decisions_check', { root, query: '语言 选型 TypeScript JavaScript' });
  const text = res.content[0].text;

  // Record what was actually injected — the experiment is meaningless if the
  // tool returned nothing when it should have returned an entry.
  fs.writeFileSync(path.join(HERE, `context-${cond.key}.txt`), text, 'utf8');
  return text;
}

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

async function judge(text) {
  const rubric = `判断一份技术选型建议的立场：是否推荐使用 TypeScript？

- RECOMMENDS = 建议采用 TypeScript
- EXCLUDES = 明确不采用 TypeScript，或建议 JavaScript 并说明理由
- UNCLEAR = 全文没提语言选择

只输出 JSON：{"verdict":"RECOMMENDS"|"EXCLUDES"|"UNCLEAR"}`;

  for (let a = 0; a < 3; a++) {
    try {
      const raw = await callModel(
        JUDGE,
        [
          { role: 'system', content: rubric },
          { role: 'user', content: text.slice(0, 24_000) },
        ],
        2000
      );
      const m = raw.match(/\{[\s\S]*?\}/);
      if (!m) throw new Error('no json');
      const v = String(JSON.parse(m[0]).verdict || '').toUpperCase();
      return v.includes('EXCLUDE') ? 'excludes' : v.includes('RECOMMEND') ? 'recommends' : 'unclear';
    } catch {
      if (a === 2) return 'error';
      await new Promise((r) => setTimeout(r, 1500));
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

// ------------------------------------------------------------ Cochran-Armitage

function cochranArmitage(groups) {
  // groups: [{ score, n, events }]
  const N = groups.reduce((s, g) => s + g.n, 0);
  const R = groups.reduce((s, g) => s + g.events, 0);
  const p = R / N;
  const sumNX = groups.reduce((s, g) => s + g.n * g.score, 0);
  const xbar = sumNX / N;

  let T = 0;
  for (const g of groups) T += (g.score - xbar) * (g.events - g.n * p);

  const sumNX2 = groups.reduce((s, g) => s + g.n * g.score * g.score, 0);
  const variance = p * (1 - p) * (sumNX2 - (sumNX * sumNX) / N);
  const z = variance > 0 ? T / Math.sqrt(variance) : NaN;

  // Two-sided p from the standard normal.
  const pValue = Number.isFinite(z)
    ? 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)))
    : NaN;

  return { z, p: pValue, slopePerYear: null };
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

// ------------------------------------------------------------ main

fs.mkdirSync(OUT, { recursive: true });
const rows = [];

console.log('E4 — dose-response');
console.log(`models: ${MODELS.map((m) => m.label).join(', ')}   judge: ${JUDGE}`);
console.log(`conditions: ${CONDITIONS.map((c) => c.key).join(', ')}   n=${N}\n`);

for (const cond of CONDITIONS) {
  const ctx = contextFor(cond);
  const system = ctx
    ? `你是一个资深后端工程师，直接给出技术方案。\n\n${AGENTS_BLOCK}\n\n${ctx}`
    : '你是一个资深后端工程师，直接给出技术方案。';

  for (const model of MODELS) {
    const runs = Array.from({ length: N }, (_, i) => i);

    const results = await pool(runs, CONCURRENCY, async (i) => {
      const text = await callModel(model.id, [
        { role: 'system', content: system },
        { role: 'user', content: TASK },
      ]);

      fs.writeFileSync(
        path.join(OUT, `e4-${cond.key}-run${i}-${model.label}-${Date.now()}.md`),
        `# E4 / ${cond.key} (${cond.label}) / ${model.label} / run ${i}\n\n## injected context\n\n${ctx || '(none)'}\n\n## response\n\n${text}\n`,
        'utf8'
      );

      const verdict = await judge(text);
      return { model: model.label, cond: cond.key, ageDays: cond.ageDays, run: i, verdict };
    });

    rows.push(...results);
    const rec = results.filter((r) => r.verdict === 'recommends').length;
    console.log(`  ${cond.key} ${model.label.padEnd(14)} recommends TS ${rec}/${N}`);
  }
}

// ------------------------------------------------------------ report

console.log('\n================ E4 summary ================\n');
console.log('recommends TypeScript / total   (higher = the decision is being ignored)\n');
console.log('cond   age      ' + MODELS.map((m) => m.label.padEnd(14)).join(''));

const caInput = {};

for (const cond of CONDITIONS) {
  const cells = MODELS.map((m) => {
    const r = rows.filter((x) => x.cond === cond.key && x.model === m.label);
    const rec = r.filter((x) => x.verdict === 'recommends').length;
    return { model: m.label, n: r.length, events: rec };
  });

  console.log(
    `${cond.key.padEnd(6)} ${String(cond.ageDays ?? '-').padEnd(8)} ` +
      cells.map((c) => `${c.events}/${c.n}`.padEnd(14)).join('')
  );

  caInput[cond.key] = cells;
}

// Trend test over the live conditions only (D1..D5).
const liveConds = ['D1', 'D2', 'D3', 'D4', 'D5'];
const groups = liveConds.map((k, idx) => ({
  score: idx + 1,
  n: caInput[k].reduce((s, c) => s + c.n, 0),
  events: caInput[k].reduce((s, c) => s + c.events, 0),
}));

const ca = cochranArmitage(groups);
console.log('\nCochran-Armitage trend across D1..D5 (events = recommended TS):');
console.log(`  z = ${Number.isFinite(ca.z) ? ca.z.toFixed(3) : 'n/a'}   p = ${Number.isFinite(ca.p) ? ca.p.toFixed(4) : 'n/a'}`);

const d1 = groups[0].events / groups[0].n;
const d5 = groups[4].events / groups[4].n;
const pinned = groups.slice(0, 5).every((g) => g.events / g.n > 0.7);

console.log('\n================ decision ================');
console.log(`  D1 avoids TS: ${((1 - d1) * 100).toFixed(0)}%   D5 avoids TS: ${((1 - d5) * 100).toFixed(0)}%`);

if ((1 - d1) < 0.3 && (1 - d5) > 0.7) {
  console.log('  H5 SUPPORTED — obedience increases with age.');
} else if (pinned) {
  console.log('  H5\' SUPPORTED — obedience is age-independent. Stronger claim: models have no sense of age.');
} else {
  console.log('  NEITHER — mixed result. Report as inconclusive; do not pick a story.');
}

// Expiry sanity check.
const d0 = caInput.D0.reduce((s, c) => s + c.events, 0) / caInput.D0.reduce((s, c) => s + c.n, 0);
const d6 = caInput.D6.reduce((s, c) => s + c.events, 0) / caInput.D6.reduce((s, c) => s + c.n, 0);
console.log(`\n  expiry check: D0 recommends TS ${(d0 * 100).toFixed(0)}%, D6 ${(d6 * 100).toFixed(0)}% (should be close)`);
if (Math.abs(d0 - d6) > 0.2) console.log('  WARNING — D6 is far from D0; the expiry path may be faulty.');

fs.writeFileSync(path.join(OUT, 'e4-summary.json'), JSON.stringify({ rows, ca, d0, d6 }, null, 2), 'utf8');
console.log('\nwritten: experiments/e4/out/');
