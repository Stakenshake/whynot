// Render the 20-item audit sample as Markdown for the human reviewer.
// The answer key lives in a separate file so the reviewer can label first.

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const items = JSON.parse(fs.readFileSync(path.join(HERE, 'audit-sample.json'), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(HERE, 'audit-key.json'), 'utf8'));
const keyById = new Map(key.map((k) => [k.id, k.assistantLabel]));

const FENCE = '```';
const out = [
  '# E0 audit sample — label these 20 yourself',
  '',
  'Rules:',
  '- Redis question: `recommends_redis` / `excludes_redis` / `unclear`',
  '- TypeScript question: `recommends_ts` / `excludes_ts` / `unclear`',
  '',
  'Label from the response text only. Then compare against `audit-key.json`.',
  'If you disagree on more than 2 of 20, the assistant labels are not a valid',
  'reference and E0 must be re-run with your labels.',
  '',
];

for (const it of items) {
  const t = it.text.length > 2600
    ? `${it.text.slice(0, 1600)}\n\n[omitted]\n\n${it.text.slice(-600)}`
    : it.text;

  out.push(`## ${it.id}  [${it.question}]`);
  out.push('');
  out.push(FENCE);
  out.push(t);
  out.push(FENCE);
  out.push('');
}

fs.writeFileSync(path.join(HERE, 'audit-sample.md'), out.join('\n'), 'utf8');

const counts = {};
for (const it of items) {
  const l = keyById.get(it.id);
  counts[l] = (counts[l] || 0) + 1;
}
console.log(`audit sample rendered: ${items.length} items`);
console.log(`answer distribution (hidden from reviewer): ${JSON.stringify(counts)}`);
