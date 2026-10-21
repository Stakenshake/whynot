// E5 — real agent, multiple sessions.
//
// Every experiment so far injected context into an API call. This one runs the
// actual Codex CLI against a real repository with a real .decisions/ directory,
// and asks three questions:
//
//   M0  fresh session, single turn      does a real agent respect the record?
//   M1  new session in the same repo    does it persist across sessions?
//   M2  unrelated work first, then ask  does prior work crowd it out?
//
// M1 is the one that matters for the product: the tool's premise is that the
// record lives in the filesystem, so a brand-new session should still find it.
//
// Each run also records whether the agent called decisions_check over MCP, and
// whether it read .decisions/ with a shell command. Those are different paths
// to the same knowledge and the distinction is worth reporting.
//
// Run: node experiments/e5/run.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { init, create } from '../../src/store.js';
import { resolveCodex, codexAvailable } from '../lib/codex.mjs';

const HERE = import.meta.dirname;
const FIXTURE = path.join(HERE, '..', 'e1', 'fixture');
const OUT = path.join(HERE, 'out');
const MCP_ENTRY = path.resolve(HERE, '..', '..', 'bin', 'whynot.js');
const N = 3;

const TASK = `在这个项目里加用户 session 存储。大约 10 万 DAU，部署在 us-east 和 eu-west 两个区域。
给出方案：选什么存储、为什么，以及需要改哪些文件。不要修改任何文件，只给方案。`;

const UNRELATED = `给这个项目加一个 /metrics 端点，暴露请求计数和运行时间。
不要修改任何文件，只说明改哪里、怎么改。`;

const AGENTS_MD = `# 项目约定

## Recorded decisions (.decisions/)

This repository keeps a record of settled decisions — especially approaches that
were tried and rejected — in \`.decisions/\`.

At the start of a session, call \`decisions_check\` with no arguments to get an
index of everything already settled.

Before proposing a technical approach, call \`decisions_check\` with keywords for
what you are about to suggest, and read the full entries that come back. If the
topic is covered, do not re-propose the rejected option.

If the MCP tool is unavailable, read the Markdown files in \`.decisions/\`
directly — they are the source of truth.
`;

const CODEX = resolveCodex();

// Fail fast. The first E5 run produced nine sessions with zero events each
// because `codex` was not on PATH and the resolver had silently fallen back to
// the bare name. Every run "completed" and every result was an error.
if (!codexAvailable(CODEX)) {
  console.error(`Codex CLI not found. Resolved: ${JSON.stringify(CODEX)}`);
  console.error('Set CODEX_BIN to the codex executable, or install @openai/codex.');
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function prepareRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whynot-e5-'));
  copyDir(FIXTURE, root);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  init(root);
  create(root, {
    title: 'session 不存 Redis',
    type: 'rejected',
    body:
      '## 结论\n不能把 session 存 Redis。\n\n## 为什么\n' +
      '试过 Redis + 单写区域。us-east 故障时读延迟飙到 8s，SLO 要求 p99 < 500ms。' +
      'Postgres 表方案已选中。',
    created: '2026-09-21',
    expires_on: '2027-10-21',
    tags: ['infra', 'session'],
  });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), AGENTS_MD, 'utf8');
  return root;
}

function runCodex({ cwd, prompt, sessionId = null, mcp = true }) {
  const args = [...CODEX.prefix, 'exec'];

  if (sessionId) {
    args.push('resume', sessionId);
  } else {
    args.push('-C', cwd);
  }

  // `codex exec resume` does not accept -s/--sandbox; passing it fails with
  // "unexpected argument '-s' found" and the turn produces zero events. The
  // resumed turn inherits the sandbox policy from the session it resumes.
  if (!sessionId) args.push('-s', 'read-only');

  args.push('--skip-git-repo-check', '--json');

  if (mcp) {
    args.push('-c', 'mcp_servers.whynot.command="node"');
    args.push('-c', `mcp_servers.whynot.args=["${MCP_ENTRY.replace(/\\/g, '/')}", "mcp"]`);
    args.push('-c', `mcp_servers.whynot.env.WHYNOT_ROOT="${cwd.replace(/\\/g, '/')}"`);
  }

  args.push(prompt);

  return new Promise((resolve) => {
    const child = spawn(CODEX.cmd, args, {
      cwd,
      windowsHide: true,
      // stdin must be ignored: codex blocks forever waiting on an open pipe.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      resolve({ code, stdout, stderr });
    };

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (c) => finish(c));
    child.on('error', (e) => {
      stderr += `\nspawn error: ${e.message}`;
      finish(null);
    });

    const timer = setTimeout(() => child.kill(), 480_000);
    child.on('close', () => clearTimeout(timer));
  });
}

function analyse(stdout) {
  const events = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      events.push(JSON.parse(t));
    } catch {
      /* ignore */
    }
  }

  const items = events.filter((e) => e.item).map((e) => e.item);
  const messages = items.filter((i) => i.type === 'agent_message' && i.text).map((i) => i.text);
  const finalText = messages.join('\n\n');

  const threadId =
    events.find((e) => e.type === 'thread.started')?.thread_id ?? null;

  const commands = items
    .filter((i) => i.type === 'command_execution')
    .map((i) => i.command || '')
    .join(' ');

  const mcpCalls = items
    .filter((i) => i.type === 'mcp_tool_call')
    .map((i) => `${i.server}.${i.tool}`)
    .join(' ');

  const usage = events.find((e) => e.type === 'turn.completed')?.usage ?? null;

  return {
    threadId,
    events: events.length,
    messages: messages.length,
    finalText,
    inputTokens: usage?.input_tokens ?? null,
    calledDecisionsCheck: /decisions_check/.test(mcpCalls),
    anyMcpCall: mcpCalls.length > 0,
    readDecisionsDir: /\.decisions/.test(commands),
    serverRegistered: JSON.stringify(events).includes('whynot'),
    commandErrors: items
      .filter((i) => i.type === 'command_execution' && i.status === 'failed')
      .length,
  };
}

async function judge(text) {
  const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';
  const rubric = `判断一份技术方案是否推荐使用 Redis 作为 session 存储。

- RECOMMENDS = 建议采用 Redis（含 connect-redis、ElastiCache、Valkey）
- EXCLUDES = 明确不采用 Redis，或选了非 Redis 方案并说明理由
- UNCLEAR = 全文没提 session 存储方案

只输出 JSON：{"verdict":"RECOMMENDS"|"EXCLUDES"|"UNCLEAR"}`;

  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'opencode-go/claude-haiku-5-5',
          messages: [
            { role: 'system', content: rubric },
            { role: 'user', content: text.slice(0, 24_000) },
          ],
          temperature: 0,
          max_tokens: 1200,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const j = await res.json();
      const raw = j.choices?.[0]?.message?.content || j.choices?.[0]?.message?.reasoning_content || '';
      const m = raw.match(/\{[\s\S]*?\}/);
      if (!m) throw new Error('no json');
      const v = String(JSON.parse(m[0]).verdict || '').toUpperCase();
      return v.includes('EXCLUDE') ? 'excludes' : v.includes('RECOMMEND') ? 'recommends' : 'unclear';
    } catch {
      if (a === 2) return 'error';
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

// ---------------------------------------------------------------- run

fs.mkdirSync(OUT, { recursive: true });

const ALL_CONDITIONS = [
  { key: 'M0', label: 'fresh-single-turn', turns: ['task'] },
  { key: 'M1', label: 'new-session-same-repo', turns: ['task', 'new-session-task'] },
  { key: 'M2', label: 'unrelated-first', turns: ['unrelated', 'task'] },
];

// --only M2 re-runs one condition without discarding the others' results.
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;
const conditions = ONLY ? ALL_CONDITIONS.filter((c) => c.key === ONLY) : ALL_CONDITIONS;

const SUMMARY_PATH = path.join(HERE, 'e5-summary.json');
const priorRows =
  ONLY && fs.existsSync(SUMMARY_PATH)
    ? JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8')).filter((r) => r.cond !== ONLY)
    : [];

const rows = [];

for (const cond of conditions) {
  for (let run = 0; run < N; run++) {
    const repo = prepareRepo();
    let sessionId = null;
    let last = null;

    for (const turn of cond.turns) {
      const prompt = turn === 'unrelated' ? UNRELATED : TASK;

      // 'new-session-task' deliberately starts a fresh process with no session id.
      const useSession = turn === 'new-session-task' ? null : sessionId;
      const { code, stdout, stderr } = await runCodex({
        cwd: repo,
        prompt,
        sessionId: useSession,
      });

      const a = analyse(stdout);
      if (a.threadId) sessionId = a.threadId;
      last = a;

      fs.writeFileSync(
        path.join(OUT, `e5-${cond.key}-run${run}-${turn}.json`),
        JSON.stringify({ cond: cond.key, run, turn, code, ...a, stderr: stderr.slice(-500) }, null, 2),
        'utf8'
      );
    }

    const verdict = await judge(last.finalText);
    rows.push({
      cond: cond.key,
      label: cond.label,
      run,
      verdict,
      calledDecisionsCheck: last.calledDecisionsCheck,
      readDecisionsDir: last.readDecisionsDir,
      serverRegistered: last.serverRegistered,
      inputTokens: last.inputTokens,
      commandErrors: last.commandErrors,
    });

    const flag = last.calledDecisionsCheck ? 'MCP' : last.readDecisionsDir ? 'read-files' : 'neither';
    console.log(
      `  ${cond.key} run${run}  decides=${flag.padEnd(10)} recommends Redis=${verdict}` +
        (last.serverRegistered ? '' : '  [whynot MCP not registered]')
    );
  }
}

const allRows = [...priorRows, ...rows];

console.log('\n================ E5 results ================\n');
for (const cond of ALL_CONDITIONS) {
  const r = allRows.filter((x) => x.cond === cond.key);
  if (!r.length) {
    console.log(`${cond.key} ${cond.label.padEnd(24)} (not run)`);
    continue;
  }
  const valid = r.filter((x) => x.verdict !== 'error');
  const rec = valid.filter((x) => x.verdict === 'recommends').length;
  console.log(
    `${cond.key} ${cond.label.padEnd(24)} recommends Redis ${rec}/${valid.length}   ` +
      `MCP ${r.filter((x) => x.calledDecisionsCheck).length}/${r.length}   ` +
      `read files ${r.filter((x) => x.readDecisionsDir).length}/${r.length}` +
      (valid.length !== r.length ? `   errors ${r.length - valid.length}` : '')
  );
}

const errors = allRows.filter((r) => r.verdict === 'error').length;
console.log(`\nrows: ${allRows.length}   judge errors: ${errors}`);
fs.writeFileSync(SUMMARY_PATH, JSON.stringify(allRows, null, 2), 'utf8');
console.log('written: experiments/e5/');
