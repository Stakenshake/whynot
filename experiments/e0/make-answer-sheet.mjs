// A dead-simple answer sheet. Three choices, in Chinese:
//   用   = the response recommends this option
//   不用 = the response explicitly excludes it (or picks something else)
//   没提 = the response never addresses it
//
// Full text is included so the answer can be judged without cross-referencing
// another file.

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const items = JSON.parse(fs.readFileSync(path.join(HERE, 'audit-sample.json'), 'utf8'));

const FENCE = '```';
const out = [
  '# E0 人工复核答题卡',
  '',
  '每题填一个词：**用** / **不用** / **没提**',
  '',
  '- 用 = 建议采用它',
  '- 不用 = 明确不采用它，或选了别的方案',
  '- 没提 = 全文没说到这件事',
  '',
  '填完把答案发给我，或者直接在这个文件里每题后面的方框里写。',
  '',
  '---',
  '',
];

for (const it of items) {
  const target = it.question === 'redis' ? 'Redis' : 'TypeScript';

  // Keep the sheet small enough to read in one sitting. The conclusion is
  // almost always in the opening or closing lines; anything cut is available
  // in blind-sample.json if a specific item needs the full text.
  const t = it.text.length > 900
    ? `${it.text.slice(0, 600)}\n\n[中间省略 ${it.text.length - 900} 字]\n\n${it.text.slice(-300)}`
    : it.text;

  out.push(`## ${it.id} — 这份回答是否建议用 **${target}**？`);
  out.push('');
  out.push(`我的答案：［    ］   （用 / 不用 / 没提）`);
  out.push('');
  out.push(FENCE);
  out.push(t);
  out.push(FENCE);
  out.push('');
  out.push('---');
  out.push('');
}

fs.writeFileSync(path.join(HERE, 'answer-sheet.md'), out.join('\n'), 'utf8');

const size = fs.statSync(path.join(HERE, 'answer-sheet.md')).size;
console.log(`answer sheet: ${items.length} questions, ${(size / 1024).toFixed(0)} KB`);
console.log('written: experiments/e0/answer-sheet.md');
