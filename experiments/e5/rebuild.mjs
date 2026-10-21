// Rebuild the E5 summary from the saved per-run JSON.
//
// The --only M2 re-run overwrote e5-summary.json, dropping the M0/M1 verdicts.
// The raw per-run files were intact, so the verdicts are recomputed here rather
// than re-running the sessions.
//
// Lesson recorded: per-run output files should contain their own verdict. A
// derived summary must never be the only place a result exists.

import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'out');
const SUMMARY = path.join(HERE, 'e5-summary.json');
const GATEWAY = process.env.MAGPIE_URL || 'http://127.0.0.1:3425/v1/chat/completions';

const RUBRIC = `判断一份技术方案是否推荐使用 Redis 作为 session 存储。

- RECOMMENDS = 建议采用 Redis（含 connect-redis、ElastiCache、Valkey）
- EXCLUDES = 明确不采用 Redis，或选了非 Redis 方案并说明理由
- UNCLEAR = 全文没提 session 存储方案

只输出 JSON：{"verdict":"RECOMMENDS"|"EXCLUDES"|"UNCLEAR"}`;

async function judge(text) {
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'opencode-go/claude-haiku-5-5',
          messages: [
            { role: 'system', content: RUBRIC },
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

const labels = {
  M0: 'fresh-single-turn',
  M1: 'new-session-same-repo',
  M2: 'unrelated-first',
};

// The decisive turn per condition.
const DECISIVE = { M0: 'task', M1: 'new-session-task', M2: 'task' };

const existing = fs.existsSync(SUMMARY) ? JSON.parse(fs.readFileSync(SUMMARY, 'utf8')) : [];
const kept = existing.filter((r) => r.cond === 'M2');
const rebuilt = [];

for (const [cond, turn] of Object.entries(DECISIVE)) {
  if (cond === 'M2' && kept.length) continue;

  for (let run = 0; run < 3; run++) {
    const file = path.join(OUT, `e5-${cond}-run${run}-${turn}.json`);
    if (!fs.existsSync(file)) continue;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const verdict = await judge(j.finalText || '');
    rebuilt.push({
      cond,
      label: labels[cond],
      run,
      verdict,
      calledDecisionsCheck: j.calledDecisionsCheck,
      readDecisionsDir: j.readDecisionsDir,
      serverRegistered: j.serverRegistered,
      inputTokens: j.inputTokens,
      commandErrors: j.commandErrors,
    });
    console.log(`  rebuilt ${cond} run${run} -> ${verdict}`);
  }
}

const all = [...kept, ...rebuilt].sort((a, b) => a.cond.localeCompare(b.cond) || a.run - b.run);
fs.writeFileSync(SUMMARY, JSON.stringify(all, null, 2), 'utf8');

console.log('\n================ E5 rebuilt ================\n');
for (const cond of ['M0', 'M1', 'M2']) {
  const r = all.filter((x) => x.cond === cond);
  if (!r.length) {
    console.log(`${cond} (missing)`);
    continue;
  }
  const valid = r.filter((x) => x.verdict !== 'error');
  const rec = valid.filter((x) => x.verdict === 'recommends').length;
  console.log(
    `${cond} ${labels[cond].padEnd(24)} recommends Redis ${rec}/${valid.length}   ` +
      `MCP ${r.filter((x) => x.calledDecisionsCheck).length}/${r.length}   ` +
      `read files ${r.filter((x) => x.readDecisionsDir).length}/${r.length}`
  );
}

console.log(`\nrows: ${all.length}`);
