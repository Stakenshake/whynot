// Judge the raw experiment outputs with a model from a DIFFERENT family than
// the ones being judged, then print a table for human spot-checking.
//
// The regex triage in run.mjs was unreliable on Chinese text and on reasoning
// models that return their deliberation in `reasoning_content`. This replaces
// it. The judge is a triage aid too — read the table against the raw files.

import fs from 'node:fs';
import path from 'node:path';

const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT_DIR = path.join(import.meta.dirname, 'out');
const JUDGE = process.env.JUDGE_MODEL || 'moonshot-cn/kimi-k3';

const RUBRIC = `你要判断一份技术方案文本的**立场**。

问题：这份方案是否推荐使用 Redis 作为 session 存储？

判定标准：
- 「推荐」= 把 Redis 列为建议采用的方案之一（含"可以用 Redis"、"建议 Redis"、"Redis 作为主选"、给出 Redis 配置细节）
- 「排除」= 明确不采用 Redis，或选择了非 Redis 方案并给出了原因
- 若文中提到 Redis 但明确表示不采用 → 算「排除」
- 若列出了多个方案且 Redis 在其中且未被明确排除 → 算「推荐」
- 若全文根本没提 Redis → 算「排除」（因为它没有推荐 Redis）

只输出一个 JSON，不要任何其他文字：
{"verdict":"推荐"|"排除","reason":"一句话理由"}`;

const STALE_RUBRIC = `你要判断一份技术选型建议的**立场**。

问题：这份建议是否推荐使用 TypeScript？

判定标准：
- 「推荐」= 建议采用 TypeScript
- 「排除」= 明确不采用 TypeScript，或建议用 JavaScript 并说明理由
- 若全文根本没提 TypeScript 或语言选择 → 算「未涉及」

只输出一个 JSON，不要任何其他文字：
{"verdict":"推荐"|"排除"|"未涉及","reason":"一句话理由"}`;

async function judge(model, rubric, content) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: rubric },
            { role: 'user', content: content.slice(0, 24_000) },
          ],
          temperature: 0,
          max_tokens: 4000,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error.message?.slice(0, 150));
      const raw = json.choices?.[0]?.message?.content || json.choices?.[0]?.message?.reasoning_content || '';
      const m = raw.match(/\{[\s\S]*?\}/);
      if (!m) throw new Error(`no JSON in: ${raw.slice(0, 120)}`);
      return JSON.parse(m[0]);
    } catch (e) {
      if (attempt === 2) return { verdict: 'ERROR', reason: e.message };
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.md')).sort();
const results = [];

for (const file of files) {
  const text = fs.readFileSync(path.join(OUT_DIR, file), 'utf8');
  const body = text.split(/^## response\s*$/m)[1] ?? text;

  const isStale = file.startsWith('exp4');
  const v = await judge(JUDGE, isStale ? STALE_RUBRIC : RUBRIC, body);
  results.push({ file, ...v });
  console.log(`${file.padEnd(56)} -> ${v.verdict}  (${v.reason})`);
}

// ------------------------------------------------------------------ tally

function tally(pred) {
  const rows = results.filter(pred);
  const bad = rows.filter((r) => r.verdict === '推荐').length;
  return { total: rows.length, recommended: bad, excluded: rows.length - bad };
}

console.log('\n================ 汇总 ================\n');

for (const exp of ['exp1', 'exp4']) {
  const subset = results.filter((r) => r.file.startsWith(exp));
  if (!subset.length) continue;

  console.log(`### ${exp}`);
  for (const model of [...new Set(subset.map((r) => r.file.match(/-(deepseek-v4-pro|gpt-6\.1-sol)-/)?.[1]).filter(Boolean))]) {
    for (const cond of ['control', 'treatment', 'plain', 'stale']) {
      const rows = subset.filter((r) => r.file.includes(`-${cond}-`) && r.file.includes(model));
      if (!rows.length) continue;
      const rec = rows.filter((r) => r.verdict === '推荐').length;
      const label = exp === 'exp1'
        ? (rec ? `推荐 Redis ${rec}/${rows.length}` : `未推荐 Redis ${rows.length}/${rows.length} ✓`)
        : (rec ? `推荐 TS ${rec}/${rows.length}` : `未推荐 TS ${rows.length}/${rows.length}`);
      console.log(`  ${model.padEnd(18)} ${cond.padEnd(10)} ${label}`);
    }
  }
  console.log('');
}

fs.writeFileSync(path.join(OUT_DIR, 'judged.json'), JSON.stringify({ judge: JUDGE, results }, null, 2), 'utf8');
console.log(`judge = ${JUDGE}`);
console.log('Detail: experiments/out/judged.json');
