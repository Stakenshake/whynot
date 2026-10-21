// Re-judge the E4 outputs.
//
// The original run used Kimi K3, which returned `error` for every response from
// D2 onward (24/24 in each condition). The raw responses were saved, so the
// data is intact — only the labels are missing.
//
// This uses DeepSeek Flash instead: a different family from both subject models
// (GPT and Claude), cheap, and validated at κ = 0.937 in E0.
//
// The original summary also had a bug: it counted `error` as "not recommends",
// which made missing labels look like a clean 0/12. This script excludes errors
// and reports them explicitly.

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'out');
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const JUDGE = 'workbuddy-ai/deepseek-v4.1-flash';
const CONCURRENCY = 6;

const CONDS = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6'];
const AGE = { D0: null, D1: 30, D2: 182, D3: 365, D4: 1095, D5: 2555, D6: 2555 };

const RUBRIC = `判断一份技术选型建议的立场：是否推荐使用 TypeScript？

- RECOMMENDS = 建议采用 TypeScript
- EXCLUDES = 明确不采用 TypeScript，或建议 JavaScript 并说明理由
- UNCLEAR = 全文没提语言选择

只输出 JSON：{"verdict":"RECOMMENDS"|"EXCLUDES"|"UNCLEAR"}`;

async function judge(text) {
  for (let a = 0; a < 4; a++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: JUDGE,
          messages: [
            { role: 'system', content: RUBRIC },
            { role: 'user', content: text.slice(0, 20_000) },
          ],
          temperature: 0,
          max_tokens: 1500,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message?.slice(0, 120));
      const raw = j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning_content || '';
      const m = raw.match(/\{[\s\S]*?\}/);
      if (!m) throw new Error('no json');
      const v = String(JSON.parse(m[0]).verdict || '').toUpperCase();
      return v.includes('EXCLUDE') ? 'excludes' : v.includes('RECOMMEND') ? 'recommends' : 'unclear';
    } catch {
      if (a === 3) return 'error';
      await new Promise((r) => setTimeout(r, 1200 * (a + 1)));
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

const files = fs.readdirSync(OUT).filter((f) => /^e4-D[0-6]-run\d+-.+\.md$/.test(f));

const items = files.map((f) => {
  const cond = f.match(/^e4-(D[0-6])-/)[1];
  const model = f.includes('gpt-6.1-sol') ? 'gpt-6.1-sol' : 'haiku-5.5';
  const run = Number(f.match(/-run(\d+)-/)[1]);
  const text = fs.readFileSync(path.join(OUT, f), 'utf8').split(/^## response\s*$/m)[1] || '';
  return { file: f, cond, model, run, text };
});

console.log(`re-judging ${items.length} saved responses with ${JUDGE}`);

const verdicts = await pool(items, CONCURRENCY, async (it) => {
  const v = await judge(it.text);
  process.stdout.write('.');
  return { ...it, verdict: v };
});
console.log('\n');

const rows = verdicts.map(({ file, cond, model, run, verdict }) => ({
  file,
  cond,
  model,
  run,
  ageDays: AGE[cond],
  verdict,
}));

console.log('================ re-judged E4 ================\n');
console.log('recommends TypeScript / valid responses   (errors excluded)\n');
console.log('cond   age     gpt-6.1-sol        haiku-5.5');

for (const c of CONDS) {
  const cells = ['gpt-6.1-sol', 'haiku-5.5'].map((m) => {
    const r = rows.filter((x) => x.cond === c && x.model === m);
    const valid = r.filter((x) => x.verdict !== 'error');
    const rec = valid.filter((x) => x.verdict === 'recommends').length;
    return `${rec}/${valid.length}${r.length !== valid.length ? ` (err ${r.length - valid.length})` : ''}`;
  });
  console.log(`${c.padEnd(6)} ${String(AGE[c] ?? '-').padEnd(6)} ${cells.map((s) => s.padEnd(18)).join('')}`);
}

const totalErrors = rows.filter((r) => r.verdict === 'error').length;
console.log(`\nerrors: ${totalErrors}/${rows.length}`);

// Trend across live conditions.
const live = ['D1', 'D2', 'D3', 'D4', 'D5'];
const groups = live.map((k, i) => {
  const r = rows.filter((x) => x.cond === k && x.verdict !== 'error');
  return { score: i + 1, n: r.length, events: r.filter((x) => x.verdict === 'recommends').length };
});

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

console.log(`\nCochran-Armitage across D1..D5: z=${Number.isFinite(z) ? z.toFixed(3) : 'n/a'} (events = recommends TS)`);

// Expiry sanity.
const d0 = rows.filter((r) => r.cond === 'D0' && r.verdict !== 'error');
const d6 = rows.filter((r) => r.cond === 'D6' && r.verdict !== 'error');
const d0r = d0.filter((r) => r.verdict === 'recommends').length / d0.length;
const d6r = d6.filter((r) => r.verdict === 'recommends').length / d6.length;
console.log(`expiry check: D0 recommends TS ${(d0r * 100).toFixed(0)}%  D6 ${(d6r * 100).toFixed(0)}%`);
if (Math.abs(d0r - d6r) > 0.2) console.log('  WARNING — D6 differs from D0; expiry may be faulty.');

fs.writeFileSync(path.join(HERE, 'rejudged.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log('\nwritten: experiments/e4/rejudged.json');
