# whynot

**Record what you ruled out — and why — so your coding agent stops re-suggesting it.**

Your agent starts every session from zero. The approach you rejected last week,
it will propose again this week. Three months from now, you will not remember
why you rejected it either.

Memory tools record **what you did**. That is already in your code, your
commits, and your pull requests. What exists nowhere is **why you did not do
something** — and it lives only in your head, decaying.

`whynot` is a folder of Markdown files in your repo, plus a thin MCP server.

---

## What we found

Six experiments, three model families, mostly n=20 per cell. Full write-ups and
scripts are in [`docs/`](docs/) and [`experiments/`](experiments/).

### Age does not matter. Presence does

A recorded decision is followed at the same rate whether it was written a month
ago or seven years ago:

| Age of the decision | Recommends the rejected option |
|---|---|
| none (baseline) | 100% |
| 30 days | **0%** |
| 1 year | **0%** |
| 7 years | **0%** |
| 7 years, expired and hidden | **100%** |

Same decision text every time; only the `created` date changed. The model does
not discount old records — it treats every record as current.

Adding "this is old, be skeptical" to the prompt did not help. Hiding the
expired entry did. That is why expiry is the core of this tool.

### Recording a rejection changes the answer

At n=20 across three families, a recorded rejection moved the recommendation by
78–87 percentage points (Fisher p < 0.0001).

### Two honest qualifications

- **Not every model obeys equally.** With real code in context, one model
  inferred the answer from the repository and ignored the record; another still
  preferred the rejected option until the record stopped it.
- **The stated reason matters more than the date.** When the record said "the
  team did not know TypeScript", about one in five responses attacked that
  premise and recommended TypeScript anyway. When it said "this project's
  fields change constantly", obedience was total. A reason that names a
  *condition* invites re-checking; a reason that states a *property* does not.

### What is not tested

**We have not measured whether this helps a developer in real use.** Every
experiment here is a controlled, single-turn task. The number that matters —
how often an agent re-proposes something you already rejected, over weeks of
real work — has not been measured, and this project does not claim it.

The claim we do make: *the mechanism works under test, and the scripts are here
so you can check.*

---

## Install

```bash
npx whynot-cli init
```

Then paste the block from [`AGENTS.snippet.md`](AGENTS.snippet.md) into your
`AGENTS.md` or `CLAUDE.md`, and register the MCP server.

Node 20+. Nothing else. No global install, no account, no telemetry.

### Register the MCP server

The same shape works for Claude Code, Claude Desktop, Cursor, and most other
MCP clients:

```json
{
  "mcpServers": {
    "whynot": {
      "command": "npx",
      "args": ["-y", "whynot-cli", "mcp"]
    }
  }
}
```

---

## Use

```bash
npx whynot-cli audit              # scan your existing rules for ones that will never expire
npx whynot-cli init               # create .decisions/
npx whynot-cli add --title "..." --why "..."
npx whynot-cli check redis        # is this already settled?
npx whynot-cli stale              # what needs a human decision
npx whynot-cli renew 0001         # it still holds — extend it
npx whynot-cli retire 0002        # it no longer holds — archive it
```

Most of the time you will not run these by hand. The agent calls
`decisions_record` when it discovers something does not work, and
`decisions_check` before proposing an approach.

### Start with `audit`

`audit` is read-only. It scans `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
`.cursor/rules/*`, and `.github/copilot-instructions.md` for absolute rules
that state no condition — the kind that get obeyed forever.

```
Scanned 2 agent config files:
  AGENTS.md  (last changed 412d ago)
  CLAUDE.md  (last changed 8d ago)

4 rules look like permanent constraints:

  AGENTS.md:3
    "Never use TypeScript in this repo."
    → absolute rule with no stated condition; unchanged for 412 days
```

It is a heuristic, not a verdict. If it finds nothing, that is useful too.

---

## The format

```
.decisions/
└── 0001-session-not-redis.md
```

```markdown
---
id: 0001
title: session 不存 Redis
type: rejected            # rejected | decision | constraint
status: live              # live | retired
created: 2026-10-14
expires_on: 2027-01-12
revisit_when: "Redis 支持跨区域强一致时"
evidence:
  - "pr:412"
tags: [infra, session]
---

## 结论
不能把 session 存 Redis。

## 为什么
试过 Redis + 单写区域。us-east 故障时读延迟飙到 8s，SLO 要求 p99 < 500ms。
```

`rejected` entries are the valuable ones. They are the only kind that cannot be
recovered from the code.

### Expiry

Every entry expires: 90 days for a rejection, 180 for a decision, 365 for a
constraint.

When an entry expires it **stops being shown to the agent**. It is not deleted.
`whynot stale` lists it, and you either renew it or retire it.

This is the whole safety mechanism. An expired entry is invisible, because
telling an agent "this is old, be skeptical" was tested and does not work.

If something genuinely never expires, write `expires_on: never`. It should be
rare, and it should be a deliberate decision.

---

## Why this shape

- **Markdown in git, not a database.** You can read it, diff it, review it,
  revert it. If this tool disappears tomorrow, `grep` still works.
- **No vector store, no embeddings, no model call when writing.** Each of those
  is a failure mode we saw in existing tools: index staleness, write-path cost,
  and results nobody can audit.
- **Expiry is the default.** This is the part that differs from every other
  memory tool. See [docs/validation.md](docs/validation.md) for the experiment.
- **The format works without the tool.** The agent can read `.decisions/`
  directly if MCP is unavailable. This was observed, not just designed.

---

## What this is not

- Not a vector database or a retrieval engine.
- Not a hosted service. Your reasoning about your own codebase stays on your
  machine.
- Not a replacement for `AGENTS.md`. That tells the agent how to behave; this
  records what has already been settled.
- Not automatic. If nobody records anything, it does nothing.

---

## Cross-platform notes

Tested on Windows, macOS, and Linux.

- `init` writes `*.md text eol=lf` to `.gitattributes`. Without it, Windows
  checkouts write CRLF and every diff shows the whole file as changed.
- Filenames are slugged to `[a-z0-9]` plus CJK. Windows forbids
  `\ / : * ? " < > |` and both Windows and macOS are case-insensitive, so
  filenames that work on Linux can break elsewhere.
- No daemon and no file watching. The tool runs when it is called.
- If you use non-ASCII filenames, run `git config core.quotepath false`.

---

## Verify it yourself

```bash
npm test                         # 29 tests, no dependencies
node experiments/e3/run.mjs      # the statistical-power experiment
node experiments/e4/run.mjs      # the age / expiry experiment
node experiments/e5/run.mjs      # a real agent across real sessions
```

See [`experiments/README.md`](experiments/README.md) for all six and for the
conventions they follow.

The experiments call models through an OpenAI-compatible endpoint. Set
`MAGPIE_URL` or edit the gateway constant at the top of each script. They are
not part of the tool; they are how we checked the claims.

---

## License

MIT. No account, no telemetry, no paid tier, no closed binary.
There is nothing to upsell you.

---

[中文说明](README.zh-CN.md) · [Design](docs/design.md) · [Validation](docs/validation.md)
