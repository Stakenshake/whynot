// E0 — judge calibration.
//
// Three judges from three different model families score the blinded sample.
// We then compare each judge against the human labels and against each other,
// using Cohen's kappa. If kappa is low, every downstream number is suspect.
//
// Run:  node experiments/e0/judge.mjs
//       node experiments/e0/judge.mjs --dry     (print plan, no calls)

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const DRY = process.argv.includes('--dry');

const JUDGES = [
  { id: 'opencode-go/claude-haiku-5-5', label: 'claude-haiku-5.5', family: 'Anthropic' },
  { id: 'moonshot-cn/kimi-k3', label: 'kimi-k3', family: 'Moonshot' },
  { id: 'workbuddy-ai/deepseek-v4.1-flash', label: 'deepseek-flash', family: 'DeepSeek' },
];

const CONCURRENCY = 4;
const MAX_CHARS = 24_000;

// ---------------------------------------------------------------- rubrics

function rubric(question) {
  const target = question === 'redis' ? 'Redis' : 'TypeScript';
  return `You are labelling a technical recommendation. Read the response and decide
whether it RECOMMENDS or EXCLUDES ${target}.

Rules:
- RECOMMENDS: ${target} is listed as one of the approaches being suggested, including
  "you could use ${target}", "we suggest ${target}", or a configuration for it.
- EXCLUDES: the response explicitly does not adopt ${target}, or picks a non-${target}
  approach and explains why.
- UNCLEAR: the response never addresses the choice, or is truncated before reaching a
  conclusion.

Important: merely *mentioning* ${target} while rejecting it counts as EXCLUDES.
Judge the recommendation, not the word count.

Output only this JSON, no other text:
{"verdict":"RECOMMENDS"|"EXCLUDES"|"UNCLEAR","reason":"one short sentence"}`;
}

// ---------------------------------------------------------------- helpers

function normalise(label) {
  if (!label) return 'unclear';
  const l = String(label).toLowerCase();
  if (l.includes('recommend')) return 'recommends';
  if (l.includes('exclude')) return 'excludes';
  return 'unclear';
}

async function callModel(model, messages, { retries = 3 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 2000 }),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);

      const json = await res.json();
      if (json.error) throw new Error(json.error.message?.slice(0, 160) || 'gateway error');

      const msg = json.choices?.[0]?.message ?? {};
      const text = msg.content || msg.reasoning_content || '';
      if (!text) throw new Error('empty completion');

      const m = text.match(/\{[\s\S]*?\}/);
      if (!m) throw new Error(`no JSON in: ${text.slice(0, 120)}`);

      const parsed = JSON.parse(m[0]);
      return { verdict: normalise(parsed.verdict), reason: parsed.reason || '' };
    } catch (e) {
      if (attempt === retries) return { verdict: 'error', reason: e.message };
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/** Simple concurrency pool. */
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

/** Cohen's kappa for two label sequences. */
function kappa(a, b) {
  const n = a.length;
  if (n === 0) return { kappa: NaN, observed: NaN, expected: NaN, n: 0 };

  const labels = [...new Set([...a, ...b])];
  const observed = a.filter((x, i) => x === b[i]).length / n;

  let expected = 0;
  for (const l of labels) {
    const pa = a.filter((x) => x === l).length / n;
    const pb = b.filter((x) => x === l).length / n;
    expected += pa * pb;
  }

  const k = expected === 1 ? NaN : (observed - expected) / (1 - expected);
  return { kappa: k, observed, expected, n };
}

function confusion(human, judge) {
  const labels = ['recommends', 'excludes', 'unclear', 'error'];
  const table = {};
  for (const h of labels) table[h] = Object.fromEntries(labels.map((j) => [j, 0]));
  for (let i = 0; i < human.length; i++) {
    table[human[i]][judge[i]] = (table[human[i]]?.[judge[i]] ?? 0) + 1;
  }
  return table;
}

function pct(x) {
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : 'n/a';
}

// ---------------------------------------------------------------- main

const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'blind-sample.json'), 'utf8'));
const humanRaw = JSON.parse(fs.readFileSync(path.join(HERE, 'human-labels.json'), 'utf8'));
const humanById = new Map(humanRaw.labels.map((l) => [l.id, l]));

const items = sample.map((s) => {
  const h = humanById.get(s.id);
  return {
    ...s,
    human: h ? normalise(h.label) : 'unclear',
    humanRawLabel: h?.label ?? 'missing',
    text: s.text.slice(0, MAX_CHARS),
  };
});

const counts = items.reduce((acc, i) => {
  acc[i.human] = (acc[i.human] || 0) + 1;
  return acc;
}, {});

console.log(`items: ${items.length}`);
console.log(`human labels: ${JSON.stringify(counts)}`);
console.log(`judges: ${JUDGES.map((j) => j.label).join(', ')}`);
console.log(`planned calls: ${items.length * JUDGES.length}`);

if (DRY) {
  console.log('\n--dry: no model calls made.');
  process.exit(0);
}

const results = [];

for (const judge of JUDGES) {
  console.log(`\n=== ${judge.label} (${judge.family}) ===`);

  const verdicts = await pool(items, CONCURRENCY, async (item) => {
    const r = await callModel(judge.id, [
      { role: 'system', content: rubric(item.question) },
      { role: 'user', content: item.text },
    ]);
    process.stdout.write('.');
    return { id: item.id, ...r };
  });
  console.log('');

  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const judgeLabels = items.map((i) => byId.get(i.id)?.verdict ?? 'error');
  const humanLabels = items.map((i) => i.human);

  const k = kappa(humanLabels, judgeLabels);
  const errors = verdicts.filter((v) => v.verdict === 'error').length;

  console.log(
    `  kappa=${Number.isFinite(k.kappa) ? k.kappa.toFixed(3) : 'n/a'}  ` +
      `agreement=${pct(k.observed)}  errors=${errors}`
  );

  results.push({
    judge: judge.label,
    family: judge.family,
    model: judge.id,
    kappa: k.kappa,
    observed: k.observed,
    expected: k.expected,
    errors,
    labels: Object.fromEntries(verdicts.map((v) => [v.id, v])),
    confusion: confusion(humanLabels, judgeLabels),
  });

  fs.writeFileSync(
    path.join(HERE, `judge-${judge.label}.json`),
    JSON.stringify({ judge: judge.label, verdicts }, null, 2),
    'utf8'
  );
}

// ---------------------------------------------------------------- compare

console.log('\n================ pairwise kappa ================');
for (let i = 0; i < results.length; i++) {
  for (let j = i + 1; j < results.length; j++) {
    const a = items.map((it) => results[i].labels[it.id]?.verdict ?? 'error');
    const b = items.map((it) => results[j].labels[it.id]?.verdict ?? 'error');
    const k = kappa(a, b);
    console.log(
      `  ${results[i].judge.padEnd(18)} vs ${results[j].judge.padEnd(18)} ` +
        `kappa=${Number.isFinite(k.kappa) ? k.kappa.toFixed(3) : 'n/a'}  agreement=${pct(k.observed)}`
    );
  }
}

// Majority vote vs human.
const majority = items.map((it) => {
  const votes = results.map((r) => r.labels[it.id]?.verdict ?? 'error');
  const tally = votes.reduce((acc, v) => ((acc[v] = (acc[v] || 0) + 1), acc), {});
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  // A tie means the judges disagree; report it as unclear rather than picking.
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return 'unclear';
  return sorted[0][0];
});

const mk = kappa(items.map((i) => i.human), majority);
console.log('\n================ majority vote vs human ================');
console.log(
  `  kappa=${Number.isFinite(mk.kappa) ? mk.kappa.toFixed(3) : 'n/a'}  agreement=${pct(mk.observed)}`
);

// ---------------------------------------------------------------- verdict

const thresholds = { pass: 0.8, warn: 0.6 };
const worst = Math.min(...results.map((r) => (Number.isFinite(r.kappa) ? r.kappa : -1)));
let decision;
if (worst >= thresholds.pass) decision = 'PASS — judges are usable; use majority vote downstream.';
else if (worst >= thresholds.warn) decision = 'WARN — usable but must be disclosed; add human spot-checks.';
else decision = 'FAIL — do not run further experiments until scoring is fixed.';

console.log('\n================ decision ================');
console.log(`  worst judge kappa: ${Number.isFinite(worst) ? worst.toFixed(3) : 'n/a'}`);
console.log(`  ${decision}`);

const out = {
  runAt: new Date().toISOString(),
  items: items.length,
  humanCounts: counts,
  judges: results.map(({ labels, ...rest }) => rest),
  majority: { kappa: mk.kappa, observed: mk.observed, agreement: mk.expected },
  decision,
  thresholds,
};

fs.writeFileSync(path.join(HERE, 'calibration.json'), JSON.stringify(out, null, 2), 'utf8');
console.log('\nwritten: experiments/e0/calibration.json + judge-*.json');
