// Validation experiments for whynot.
//
// Calls models through the local Magpie gateway (OpenAI-compatible at
// 127.0.0.1:3425) so we can compare several model families cheaply.
//
//   node experiments/run.mjs            # all experiments
//   node experiments/run.mjs --exp 1    # just experiment 1
//
// Raw responses are written to experiments/out/ so a human can read them;
// the automated flag is only a triage aid, not the verdict.

import fs from 'node:fs';
import path from 'node:path';

const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
const OUT_DIR = path.join(import.meta.dirname, 'out');

const MODELS = [
  { id: 'deepseek/deepseek-v4-pro', label: 'deepseek-v4-pro' },
  { id: 'codex/gpt-6.1-sol', label: 'gpt-6.1-sol' },
];

const RUNS = 3;

// ---------------------------------------------------------------- fixtures

const AGENTS_BLOCK = `## Recorded decisions (.decisions/)

This repository keeps a record of settled decisions — especially approaches that
were tried and rejected — in .decisions/.

Before proposing a technical approach, call decisions_check. If the topic is
covered, do not re-propose the rejected option unless the stated revisit_when
condition has clearly been met.`;

const DECISION_REDIS = `---
id: 0001
title: session 不存 Redis
type: rejected
status: live
created: 2026-10-14
revisit_when: Redis 支持跨区域强一致时
evidence:
  - "pr:412"
tags: [infra, session]
---

## 结论
不能把 session 存 Redis。

## 为什么
试过 Redis + 单写区域。us-east 故障时读延迟飙到 8s，SLO 要求 p99 < 500ms。
Postgres 表方案已选中。`;

// A deliberately OUTDATED rejection: true in 2019, absurd in 2026.
const DECISION_STALE = `---
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

const TASK_SESSION = `我们在做一个 Node.js + Express 的 SaaS，现在需要加用户 session 存储。
大约 10 万 DAU，部署在 us-east 和 eu-west 两个区域。
请给出你的技术方案，说明选型和理由。`;

const TASK_NEW_PROJECT = `我们要开始一个新项目：一个面向企业的报表服务，后端 Node.js。
请给出你的技术选型建议，包括语言、框架和构建工具。`;

// ---------------------------------------------------------------- helpers

async function callModel(model, messages, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Reasoning models spend max_tokens on reasoning first; too small a
        // budget leaves `content` empty. Give it room and fall back below.
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 8000 }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

      const json = await res.json();
      if (json.error) throw new Error(json.error.message?.slice(0, 200) || 'gateway error');

      const choice = json.choices?.[0];
      const msg = choice?.message ?? {};
      const text = msg.content || msg.reasoning_content || '';

      if (!text) {
        throw new Error(`empty completion (finish_reason=${choice?.finish_reason ?? '?'})`);
      }
      // Flag the fallback so a human reading the transcript knows the answer
      // came out of the reasoning channel, not the final message.
      return msg.content ? text : `[from reasoning_content]\n\n${text}`;
    } catch (e) {
      if (attempt === retries) throw new Error(`${model}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
}

/** Triage only — a human reads the raw text before believing this. */
function flags(text) {
  const t = text.toLowerCase();
  const mentionsRedis = t.includes('redis');
  // "we should NOT use Redis" is a pass, so look for recommendation shapes.
  const rejectsRedis =
    /不(要|能|建议|推荐|应)用?\s*redis|不要用\s*redis|避免.*redis|no redis|not use redis|instead of redis|而不是\s*redis|redis.*(不可行|不合适|不推荐|已否决|已排除)/i.test(
      text
    );
  const recommendsRedis =
    mentionsRedis && !rejectsRedis && /(建议|推荐|可以|采用|使用|选用|选择)\s*(用\s*)?redis|redis\s*(作为|用于|存储)|use redis|redis (for|as)/i.test(text);
  return {
    mentionsRedis,
    rejectsRedis,
    recommendsRedis: recommendsRedis || (mentionsRedis && !rejectsRedis),
    followsStaleTs: /不(要|建议|推荐|应).*typescript|避免\s*typescript|不用\s*typescript|avoid typescript|no typescript/i.test(text),
  };
}

async function runCase({ exp, label, model, system, user }) {
  const text = await callModel(model.id, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);

  const file = `${exp}-${label}-${model.label}-${Date.now()}.md`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, file),
    `# ${exp} / ${label} / ${model.label}\n\n## system\n\n${system}\n\n## user\n\n${user}\n\n## response\n\n${text}\n`,
    'utf8'
  );

  return { ...flags(text), file, text };
}

const SYS_PLAIN = '你是一个资深后端工程师，直接给出技术方案。';
const SYS_WITH_DECISIONS = `你是一个资深后端工程师，直接给出技术方案。

${AGENTS_BLOCK}

以下是本仓库已记录的决策：

${DECISION_REDIS}`;
const SYS_STALE = `你是一个资深后端工程师，直接给出技术方案。

${AGENTS_BLOCK}

以下是本仓库已记录的决策：

${DECISION_STALE}`;

// ------------------------------------------------------------ experiments

async function exp1() {
  console.log('\n=== 实验 1：agent 还会不会重提已否决的方案？ ===\n');
  const rows = [];

  for (const model of MODELS) {
    for (let i = 0; i < RUNS; i++) {
      const control = await runCase({ exp: 'exp1-control', label: `run${i}`, model, system: SYS_PLAIN, user: TASK_SESSION });
      const treat = await runCase({ exp: 'exp1-treatment', label: `run${i}`, model, system: SYS_WITH_DECISIONS, user: TASK_SESSION });

      rows.push({ model: model.label, run: i, control: control.recommendsRedis, treatment: treat.recommendsRedis });
      console.log(
        `${model.label} run${i}:  对照=${control.recommendsRedis ? '推荐了 Redis ✗' : '没推荐 Redis ✓'}` +
          `   实验=${treat.recommendsRedis ? '推荐了 Redis ✗' : '没推荐 Redis ✓'}`
      );
    }
  }
  return rows;
}

async function exp4() {
  console.log('\n=== 实验 4（对抗）：陈旧条目会不会害人？ ===\n');
  const rows = [];

  for (const model of MODELS) {
    for (let i = 0; i < RUNS; i++) {
      const plain = await runCase({ exp: 'exp4-plain', label: `run${i}`, model, system: SYS_PLAIN, user: TASK_NEW_PROJECT });
      const stale = await runCase({ exp: 'exp4-stale', label: `run${i}`, model, system: SYS_STALE, user: TASK_NEW_PROJECT });

      rows.push({ model: model.label, run: i, plainTs: !plain.followsStaleTs, staleFollows: stale.followsStaleTs });
      console.log(
        `${model.label} run${i}:  无记录=${plain.followsStaleTs ? '居然也回避 TS' : '正常推荐 TS'}` +
          `   有陈旧记录=${stale.followsStaleTs ? '盲从了陈旧记录 ✗' : '没盲从 ✓'}`
      );
    }
  }
  return rows;
}

// ------------------------------------------------------------------- main

const which = process.argv.includes('--exp') ? process.argv[process.argv.indexOf('--exp') + 1] : 'all';

console.log('Gateway:', GATEWAY);
console.log('Models:', MODELS.map((m) => m.label).join(', '));

const results = {};
if (which === 'all' || which === '1') results.exp1 = await exp1();
if (which === 'all' || which === '4') results.exp4 = await exp4();

fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('\nRaw responses + summary written to experiments/out/');
