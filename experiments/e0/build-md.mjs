// Render the blinded sample as readable Markdown for human labelling.
// Long responses are truncated to head+tail: the recommendation is almost
// always near the start or the end, and loading 18k-char reasoning dumps in
// full makes labelling slower without making it more accurate.

import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const items = JSON.parse(fs.readFileSync(path.join(here, 'blind-sample.json'), 'utf8'));

const FENCE = '```';
const out = [
  '# E0 blind sample',
  '',
  'Label each response without looking at the filename or condition.',
  'For [redis]: `recommends_redis` / `excludes_redis` / `unclear`',
  'For [typescript]: `recommends_ts` / `excludes_ts` / `unclear`',
  '',
];

for (const it of items) {
  const t = it.text;
  let shown;
  if (t.length <= 3600) {
    shown = t;
  } else {
    const omitted = t.length - 3200;
    shown = `${t.slice(0, 2000)}\n\n[${omitted} chars omitted]\n\n${t.slice(-1200)}`;
  }

  out.push(`## ${it.id}  [${it.question}]${it.reasoningFallback ? '  (reasoning fallback)' : ''}`);
  out.push('');
  out.push(FENCE);
  out.push(shown);
  out.push(FENCE);
  out.push('');
}

fs.writeFileSync(path.join(here, 'blind-sample.md'), out.join('\n'), 'utf8');

const sizes = items.map((i) => i.text.length).sort((a, b) => a - b);
console.log(`rendered ${items.length} items`);
console.log(`chars p50/p90/max: ${sizes[Math.floor(sizes.length / 2)]} / ${sizes[Math.floor(sizes.length * 0.9)]} / ${sizes.at(-1)}`);
console.log(`output: ${path.join(here, 'blind-sample.md')}`);
