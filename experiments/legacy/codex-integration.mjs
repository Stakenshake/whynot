// Third validation angle: a REAL agent with the REAL MCP server attached.
//
// Every other experiment injected context into a prompt. That tests "will it
// use this if handed to it", not "will it go and get it". This runs the actual
// Codex CLI against a real repository, with whynot registered as an MCP server,
// and reads the event stream to see whether the agent called the tool on its
// own initiative.
//
// Two conditions, one run each (Codex quota is finite):
//   control   — no .decisions/ and no AGENTS.md guidance
//   treatment — .decisions/ present + the whynot block in AGENTS.md
//
// Config is passed with -c overrides so the user's ~/.codex/config.toml is
// never touched.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { init, create } from '../../src/store.js';
import { resolveCodex, codexAvailable } from '../lib/codex.mjs';

const CODEX = resolveCodex();
if (!codexAvailable(CODEX)) {
  console.error(`Codex CLI not found: ${JSON.stringify(CODEX)}`);
  process.exit(1);
}
const MCP_ENTRY = path.resolve(import.meta.dirname, '..', 'bin', 'whynot.js');

const TASK =
  '我们要给这个 Node.js + Express 项目加用户 session 存储。10 万 DAU，部署在 us-east 和 eu-west 两个区域。' +
  '给出技术方案，说明选型和理由。不要修改任何文件，只给方案。';

const AGENTS_MD = `# 项目约定

## Recorded decisions (.decisions/)

This repository keeps a record of settled decisions — especially approaches that
were tried and rejected — in \`.decisions/\`.

At the start of a session, call \`decisions_check\` with no arguments to get an
index of everything already settled.

Before proposing a technical approach, call \`decisions_check\` with keywords for
what you are about to suggest, and read the full entries that come back. If the
topic is covered, do not re-propose the rejected option unless the stated
revisit_when condition has clearly been met.
`;

function makeRepo(withDecisions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-codex-'));
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'demo-saas', type: 'module', dependencies: { express: '^5.0.0' } }, null, 2)
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'app.js'),
    "import express from 'express';\nconst app = express();\napp.get('/health', (_, res) => res.json({ ok: true }));\nexport default app;\n"
  );

  if (withDecisions) {
    init(root);
    create(root, {
      title: 'session 不存 Redis',
      type: 'rejected',
      body: '## 结论\n不能把 session 存 Redis。\n\n## 为什么\n试过 Redis + 单写区域。us-east 故障时读延迟飙到 8s，SLO 要求 p99 < 500ms。Postgres 表方案已选中。',
      evidence: ['pr:412'],
      tags: ['infra', 'session'],
      revisit_when: 'Redis 支持跨区域强一致时',
    });
    fs.writeFileSync(path.join(root, 'AGENTS.md'), AGENTS_MD);
  }
  return root;
}

function runCodex(root, { withMcp }) {
  const args = [
    ...CODEX.prefix,
    'exec',
    '-C', root,
    '-s', 'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--json',
  ];

  if (withMcp) {
    args.push('-c', 'mcp_servers.whynot.command="node"');
    args.push('-c', `mcp_servers.whynot.args=["${MCP_ENTRY.replace(/\\/g, '/')}", "mcp"]`);
    args.push('-c', `mcp_servers.whynot.env.WHYNOT_ROOT="${root.replace(/\\/g, '/')}"`);
  }

  args.push(TASK);

  return new Promise((resolve) => {
    // stdin MUST be 'ignore'. Codex prints "Reading additional input from
    // stdin..." and then blocks forever if stdin is an open pipe, which is
    // what a default spawn gives it.
    const child = spawn(CODEX.cmd, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      resolve({ code, out, err });
    };

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => finish(code));
    child.on('error', (e) => {
      err += `\nspawn error: ${e.message}`;
      finish(null);
    });

    const timer = setTimeout(() => child.kill(), 480_000);
    child.on('close', () => clearTimeout(timer));
  });
}

export function analyse(out) {
  const events = [];
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* ignore non-JSON lines */
    }
  }

  const items = events.filter((e) => e.type === 'item.completed' && e.item).map((e) => e.item);

  // Every assistant message, concatenated — the reasoning is spread across
  // several of them, and the last one alone can omit why a choice was made.
  const finalText = items
    .filter((i) => i.type === 'agent_message' && i.text)
    .map((i) => i.text)
    .join('\n\n');

  // Tool invocations. MCP calls surface as their own item type.
  const toolItems = items.filter((i) => /mcp|tool_call/i.test(i.type || ''));
  const toolJson = JSON.stringify(toolItems) + JSON.stringify(items.filter((i) => i.type === 'command_execution'));

  const usage = events.find((e) => e.type === 'turn.completed')?.usage ?? null;

  const mentionsRedis = /redis/i.test(finalText);
  const rejectsRedis =
    /不(要|能|建议|推荐|应|采)用?\s*redis|排除\s*redis|而不是\s*redis|不引入\s*redis|no redis|not use redis|avoid redis/i.test(
      finalText
    );

  return {
    eventCount: events.length,
    assistantMessages: items.filter((i) => i.type === 'agent_message').length,
    toolItemTypes: [...new Set(toolItems.map((i) => i.type))],
    calledCheck: /decisions_check/.test(toolJson),
    calledRecord: /decisions_record/.test(toolJson),
    calledStale: /decisions_stale/.test(toolJson),
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    finalChars: finalText.length,
    mentionsRedis,
    rejectsRedis,
    finalHead: finalText.slice(0, 600),
  };
}

// ---------------------------------------------------------------------- run

const results = {};

for (const cond of ['control', 'treatment']) {
  const withDecisions = cond === 'treatment';
  const root = makeRepo(withDecisions);

  console.log(`\n=== ${cond} (decisions=${withDecisions}, mcp=${withDecisions}) ===`);
  const { code, out, err } = await runCodex(root, { withMcp: withDecisions });

  if (/usage limit|Insufficient Balance|usage_limit/i.test(out + err)) {
    console.log('  BLOCKED BY QUOTA — not a tool failure');
    console.log('  ' + (out + err).split('\n').filter((l) => /limit|Balance/i.test(l))[0]?.slice(0, 140));
    results[cond] = { blocked: true };
    continue;
  }

  if (!out.trim()) {
    console.log(`  NO STDOUT (exit=${code}). stderr tail:`);
    console.log(err.split('\n').slice(-12).map((l) => '    ' + l).join('\n'));
  }

  const a = analyse(out);
  results[cond] = { ...a, exitCode: code, stderr: err.slice(-2000) };

  console.log(`  exit=${code}  events=${a.eventCount}  stdout=${out.length}  stderr=${err.length}`);
  console.log(`  called decisions_check : ${a.calledCheck}`);
  console.log(`  called decisions_stale : ${a.calledStale}`);
  console.log(`  called decisions_record: ${a.calledRecord}`);
  console.log(`  mentions Redis: ${a.mentionsRedis}   explicitly rejects it: ${a.rejectsRedis}`);
  console.log(`  --- answer head ---`);
  console.log(a.finalHead.split('\n').map((l) => '  ' + l).join('\n'));

  fs.writeFileSync(
    path.join(import.meta.dirname, 'out', `codex-${cond}.json`),
    JSON.stringify({ cond, root, ...a, raw: out }, null, 2),
    'utf8'
  );
}

fs.writeFileSync(path.join(import.meta.dirname, 'out', 'codex-summary.json'), JSON.stringify(results, null, 2), 'utf8');

console.log('\n================ codex 汇总 ================');
for (const cond of ['control', 'treatment']) {
  const r = results[cond];
  if (!r || r.blocked) {
    console.log(`  ${cond.padEnd(10)} BLOCKED BY QUOTA`);
    continue;
  }
  console.log(
    `  ${cond.padEnd(10)} 调用 decisions_check=${r.calledCheck}  提到 Redis=${r.mentionsRedis}  明确排除 Redis=${r.rejectsRedis}`
  );
}
