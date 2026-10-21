# E5 — A real agent, across real sessions

**Result: Codex respected the recorded decision in 9 of 9 sessions, including
new sessions and sessions that did unrelated work first. It also read the
Markdown files every time, even when the MCP tool worked.**

This is the first experiment with a real agent rather than an API call, and it
answers the question the tool's premise depends on: does a record in the
filesystem survive a fresh session?

---

## Design

The E1 fixture repository (Node/Express, Postgres conventions) plus:

- `.decisions/0001-session-不存-redis.md` — a live rejection with the 8-second
  failure and the `Postgres` alternative already chosen
- `AGENTS.md` — instructs the agent to call `decisions_check`, and to read
  `.decisions/` directly if the tool is unavailable

Three conditions, n=3 sessions each:

| | Structure | Question |
|---|---|---|
| **M0** | one session, one turn | does a real agent respect the record? |
| **M1** | session 1 asks; **a brand-new session** asks again | does it survive across sessions? |
| **M2** | turn 1 = unrelated work (`/metrics` endpoint); turn 2 asks about sessions | does prior work crowd it out? |

M1 is the one that matters. The tool's whole premise is that the record lives
in the repository, so a fresh session with no memory should still find it.

Agent: Codex CLI 0.163.0, `gpt-6.1-sol`, read-only sandbox, whynot registered
via `-c mcp_servers.whynot...` overrides. Judge: Claude Haiku.

---

## Results

| Condition | Recommends Redis | Called MCP | Read `.decisions/` |
|---|---|---|---|
| M0 fresh single-turn | **0/3** | 2/3 | **3/3** |
| M1 new session, same repo | **0/3** | 2/3 | **3/3** |
| M2 unrelated work first | **0/3** | 2/3 | **3/3** |

**9 of 9 sessions chose PostgreSQL over Redis.**

### What the agent actually said

M0:

> "项目已有明确决策：session 使用 PostgreSQL 表；Redis 单写区域方案因 us-east
> 故障时读延迟达到 8 秒而被否决……**我已直接读取决策文件**。"

M1 — a brand-new session, no memory of the first:

> "**决策查询工具被当前权限策略拦截，我已改为直接读取 `.decisions/`**。"
> "建议选 PostgreSQL session 表，复用现有 `pg` 技术栈。"

M2 — after doing unrelated work first:

> "我先核对已有的 session 存储决策和认证代码……建议选 PostgreSQL session 表。"

---

## The dual-path finding

The MCP tool was called in 2 of 3 sessions per condition. In the remainder it
was **blocked by Codex's approval policy**, and the agent fell back to reading
the Markdown — without being told to in that specific run.

This is the second independent observation of the same fallback (the first was
in the original Codex integration test). It confirms the design property that
mattered most during development:

> The format works without the tool. `AGENTS.md` tells the agent to read
> `.decisions/` directly when MCP is unavailable, and in practice it does.

For deployment this means: **the MCP approval policy is a convenience, not a
dependency.** Users who never configure it still get the behaviour, as long as
`AGENTS.md` says what to do.

---

## Token cost

| Condition | Input tokens per session |
|---|---|
| M0 | ~185k |
| M1 | ~330k (two sessions in one measurement) |
| M2 | ~203k |

These are Codex reading the repository, not whynot. The decision files are ~1 KB
each. **The tool's own context cost is negligible; the cost is the agent doing
its normal job.**

A fair comparison would need a no-decision baseline in the same harness. Not
measured here.

---

## Caveats

- **One model family (GPT-6.1-Sol).** E1 showed GPT and DeepSeek behave very
  differently with code context; this experiment says nothing about DeepSeek.
- **n=3 per condition.** Nine sessions all agreeing is encouraging but not a
  rate estimate.
- **One fixture, one task.** The repo is small and the decision is unambiguous.
- **Codex-specific.** Claude Code and Cursor have different approval and
  file-reading behaviour; untested.
- **No no-decision baseline.** Without it, "0/3 recommends Redis" cannot be
  compared to what the same agent would do with no record. E3 provides that
  comparison at the API level, but not for the real agent.

---

## Failure log

Three bugs surfaced during this experiment. All are recorded because the pattern
is more useful than the fixes.

1. **`spawn codex ENOENT`.** On Windows, `execFileSync('npm', …, )` needs
   `shell: true`; without it the resolver silently fell back to a bare `codex`
   that was not on PATH. Nine sessions "completed" with zero events. Fixed by a
   shared resolver that fails fast (and the same latent bug was removed from
   `codex-check.mjs`).

2. **`codex exec resume` rejects `-s`.** The resume subcommand has a different
   option set. Passing `-s read-only` produced `unexpected argument '-s' found`
   and zero events. Fixed by omitting the sandbox flag on resume.

3. **The summary overwrote itself.** Re-running one condition with `--only M2`
   replaced `e5-summary.json` and dropped M0/M1 verdicts. The per-run files were
   intact, so verdicts were recomputed from them. **Rule: a derived summary must
   never be the only place a result exists.** Per-run output should carry its
   own verdict.

Each of these produced a run that looked complete and was empty. The pattern:
**a tool that fails to start returns the same shape as a tool that succeeded**
— no events, no error, a clean exit code. Every experiment script should assert
that it produced events.

---

## Reproduce

```bash
node experiments/e5/run.mjs              # all conditions
node experiments/e5/run.mjs --only M2    # one condition
node experiments/e5/rebuild.mjs          # recompute verdicts from saved runs
```
