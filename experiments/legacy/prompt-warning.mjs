// exp4b — does the staleness warning actually change behaviour?
//
// exp4 showed 6/6 responses blindly following a 2019 "do not use TypeScript"
// entry. The fix adds the entry's age and an explicit warning to the rendered
// text. This experiment tests the fix using the REAL render() from src/store.js,
// not a paraphrase of it, so a passing result means the shipped code works.
//
// Three conditions, same task and same underlying entry:
//   plain        — no entry at all
//   bare         — entry injected as raw markdown (what the old code emitted)
//   warned       — entry rendered by render() (what the new code emits)

import fs from 'node:fs';
import path from 'node:path';
import { render } from '../../src/store.js';

const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT_DIR = path.join(import.meta.dirname, 'out');
const RUNS = 3;

const MODELS = [
  { id: 'deepseek/deepseek-v4-pro', label: 'deepseek-v4-pro' },
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol' },
];

const ENTRY = {
  id: '0009',
  title: '不使用 TypeScript',
  type: 'rejected',
  status: 'live',
  created: '2019-03-02',
  revisit_when: '',
  evidence: [],
  tags: ['tooling'],
  body: '## 结论\n不要在这个项目里引入 TypeScript。\n\n## 为什么\n当时团队没人会写 TS，编译流程也要额外配置，拖慢交付。',
};

const BARE = `以下是本仓库已记录的决策：

---
id: 0009
title: 不使用 TypeScript
type: rejected
status: live
created: 2019-03-02
tags: [tooling]
---

## 结论
不要在这个项目里引入 TypeScript。

## 为什么
当时团队没人会写 TS，编译流程也要额外配置，拖慢交付。`;

const WARNED = `以下是本仓库已记录的决策：

${render(ENTRY)}`;

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

Before proposing a technical approach, call decisions_check. If the topic is
covered, do not re-propose the rejected option unless the stated revisit_when
condition has clearly been met.`;

const TASK = `我们要开始一个**全新的**项目：一个面向企业的报表服务，后端 Node.js。
请给出你的技术选型建议，包括语言、框架和构建工具。`;

const SYS = (extra) => `你是一个资深后端工程师，直接给出技术方案。\n\n${AGENTS_BLOCK}${extra ? `\n\n${extra}` : ''}`;

async function call(model, messages) {
  for (let attempt = 0; attempt < 3; attempt++) {
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
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function judge(text) {
  const rubric = `你要判断一份技术选型建议的立场。

问题：这份建议是否推荐使用 TypeScript？

判定标准：
- 「推荐」= 建议采用 TypeScript
- 「排除」= 明确不采用 TypeScript，或建议用 JavaScript 并说明理由
- 若全文根本没提语言选择 → 「未涉及」

只输出 JSON，不要其他文字：
{"verdict":"推荐"|"排除"|"未涉及","reason":"一句话理由"}`;

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
const rows = [];

for (const model of MODELS) {
  for (let i = 0; i < RUNS; i++) {
    for (const [cond, extra] of [['plain', ''], ['bare', BARE], ['warned', WARNED]]) {
      const text = await call(model.id, [
        { role: 'system', content: SYS(extra) },
        { role: 'user', content: TASK },
      ]);
      fs.writeFileSync(
        path.join(OUT_DIR, `exp4b-${cond}-run${i}-${model.label}-${Date.now()}.md`),
        `# exp4b / ${cond} / ${model.label}\n\n## system\n\n${SYS(extra)}\n\n## response\n\n${text}\n`,
        'utf8'
      );
      const v = await judge(text);
      rows.push({ model: model.label, cond, verdict: v.verdict, reason: v.reason });
      console.log(`${model.label.padEnd(18)} ${cond.padEnd(8)} -> ${v.verdict}  (${v.reason})`);
    }
  }
}

console.log('\n================ exp4b 汇总 ================');
for (const model of MODELS.map((m) => m.label)) {
  for (const cond of ['plain', 'bare', 'warned']) {
    const r = rows.filter((x) => x.model === model && x.cond === cond);
    const ts = r.filter((x) => x.verdict === '推荐').length;
    const label =
      cond === 'plain'
        ? `推荐 TS ${ts}/${r.length}（期望：全推荐）`
        : ts === 0
          ? `推荐 TS 0/${r.length}（仍被陈旧条目压制）`
          : `推荐 TS ${ts}/${r.length}（部分摆脱了陈旧条目）`;
    console.log(`  ${model.padEnd(18)} ${cond.padEnd(8)} ${label}`);
  }
}
fs.writeFileSync(path.join(OUT_DIR, 'exp4b.json'), JSON.stringify(rows, null, 2), 'utf8');
