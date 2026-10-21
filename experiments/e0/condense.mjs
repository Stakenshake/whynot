// Condensed view for human labelling: head 800 + tail 500 characters.
// The recommendation is almost always stated near the start or restated at the
// end, so this is enough to label without loading 170k characters into context.
// Items that remain ambiguous in this view get read in full.

import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const items = JSON.parse(fs.readFileSync(path.join(here, 'blind-sample.json'), 'utf8'));

const out = [];
for (const it of items) {
  const t = it.text.replace(/\r/g, '');
  const head = t.slice(0, 600).replace(/\n{3,}/g, '\n\n').trim();
  const tail = t.length > 1000 ? t.slice(-400).replace(/\n{3,}/g, '\n\n').trim() : '';

  out.push(`### ${it.id} [${it.question}]${it.reasoningFallback ? ' (rf)' : ''} len=${t.length}`);
  out.push(head);
  if (tail) {
    out.push('…');
    out.push(tail);
  }
  out.push('');
}

fs.writeFileSync(path.join(here, 'blind-condensed.md'), out.join('\n'), 'utf8');
console.log(`condensed ${items.length} items -> experiments/e0/blind-condensed.md`);
