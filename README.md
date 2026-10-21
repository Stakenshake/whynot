<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/icon-dark.svg">
    <img src="assets/icon-light.svg" alt="whynot" width="88">
  </picture>
</p>

<h1 align="center">whynot</h1>

<p align="center">
  <b>Your agent keeps re-suggesting what you already rejected.</b><br>
  Record the rejection once. It expires. Your agent stops bringing it up.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/whynot-cli"><img src="https://img.shields.io/npm/v/whynot-cli?style=flat-square&color=111111&label=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT">
  <img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen?style=flat-square" alt="node 20+">
  <img src="https://img.shields.io/badge/tests-29%20passing-brightgreen?style=flat-square" alt="29 tests passing">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square" alt="zero dependencies">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square" alt="platforms">
  <img src="https://img.shields.io/badge/MCP-compatible-8A2BE2?style=flat-square" alt="MCP compatible">
  <img src="https://img.shields.io/badge/Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor%20%C2%B7%20Gemini%20CLI-supported-informational?style=flat-square" alt="agent support">
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

<p align="center">
  <a href="#the-problem">The problem</a> ·
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#what-the-evidence-says">Evidence</a> ·
  <a href="#docs">Docs</a> ·
  <a href="#license">License</a>
</p>

---

## The problem

You tried Redis for session storage. It failed at 8 seconds during a regional
outage, so you moved to Postgres.

Three weeks later, in a new session, your agent suggests Redis.

You explain again. A month after that you switch from Claude Code to Codex, and
explain a third time. Six months later you no longer remember why Redis was
rejected — and neither does anyone else on the team.

**Code remembers what you chose. Nothing remembers what you rejected.**

Memory tools record what happened. That is already in your commits, your pull
requests, and the code itself. `whynot` records the other half: the options you
ruled out, and the reason, in a file your agent reads before it proposes
anything.

---

## Install

```bash
npx whynot-cli init
```

Nothing to install globally, no account, no telemetry. Node 20+ is the only
requirement.

---

## Quick start

### 1. See what will never expire

`audit` is read-only. It scans your existing `AGENTS.md`, `CLAUDE.md`, and
`.cursor/rules` for absolute rules that state no condition — the ones that will
be obeyed forever.

```bash
npx whynot-cli audit
```

```
Scanned 2 agent config files:
  AGENTS.md  (last changed 412d ago)
  CLAUDE.md  (last changed 8d ago)

3 rules look like permanent constraints:

  AGENTS.md:3
    "Never use TypeScript in this repo."
    → absolute rule with no stated condition; unchanged for 412 days
```

### 2. Create the store

```bash
npx whynot-cli init
```

This creates `.decisions/` and adds `*.md text eol=lf` to `.gitattributes`.

### 3. Record a rejection

```bash
npx whynot-cli add \
  --title "session 不存 Redis" \
  --why "us-east 故障时读延迟 8s，SLO 要求 p99 < 500ms" \
  --type rejected \
  --revisit "Redis 支持跨区域强一致时" \
  --evidence pr:412 \
  --tags infra,session
```

```markdown
---
id: 0001
title: session 不存 Redis
type: rejected
status: live
created: 2026-09-21
expires_on: 2026-12-20
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

### 4. Give it to your agent

Add the MCP server:

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

Then paste the block from [`AGENTS.snippet.md`](AGENTS.snippet.md) into your
`AGENTS.md` or `CLAUDE.md`. The MCP server gives the agent the tools; the
snippet is what makes it actually use them.

> **If MCP is unavailable, the format still works.** `.decisions/` is plain
> Markdown, so the agent can read and grep it directly. This was observed in the
> real-agent test, not assumed.

---

## How it works

### Every entry expires

| Type | Default lifetime |
|---|---|
| `rejected` | 90 days |
| `decision` | 180 days |
| `constraint` | 365 days |

When an entry lapses it **stops reaching your agent**. Not annotated, not
warned about — absent. `whynot stale` lists it, and you either renew it or
retire it.

This is the core of the design. Telling an agent "this note is old, be
skeptical" was tested and does not work. Removing the note from view does.

### Three entry types

| Type | Use it for |
|---|---|
| **`rejected`** | An approach you tried and abandoned. The most valuable kind — nothing else in the repository remembers it. |
| `decision` | A choice between viable options, with the reason |
| `constraint` | A hard requirement the project must satisfy |

### Written for humans, by design

- **Markdown in git.** Read it, diff it, review it, revert it. If this tool
  disappears, `grep` still works.
- **No vector store, no embeddings, no model call on write.** Each of those is
  a failure mode: index staleness, write-path cost, and results nobody can
  audit.
- **No daemon, no telemetry, no hosted service.** Your reasoning about your own
  codebase stays on your machine.

---

## What the evidence says

Six experiments, three model families, mostly n=20 per cell.

| Question | Result |
|---|---|
| Does the age of a decision matter? | **No.** 30 days and 7 years were obeyed at the same rate (0/12 each). Expired → 12/12. |
| Does recording a rejection change the answer? | **Yes.** 78–87 percentage points, p < 0.0001. |
| Does an irrelevant record distort unrelated work? | **No.** 0/30. |
| Does a real agent use it across sessions? | **Yes.** Codex respected the decision in 9/9 sessions. |

Two qualifications worth knowing before you install:

- **About one in five responses resisted a stale record** — by attacking its
  stated reason. A reason that names a *condition* ("the team did not know
  TypeScript") invites re-checking; one that states a *property* ("this project
  changes constantly") does not.
- **With real code in context, some agents infer the answer from the repository**
  and ignore the record. Records matter most for what code cannot express: the
  option you rejected.

Full results, methods, and reproduction scripts: [`docs/findings.md`](docs/findings.md).

---

## Docs

| | |
|---|---|
| [Design](docs/design.md) | Why the tool looks like this |
| [Findings](docs/findings.md) | Every experiment, what it found, what it did not |
| [Validation](docs/validation.md) | Index of the detailed write-ups |
| [Pre-registration](docs/preregistration.md) | Decision rules fixed before the data |
| [Contributing](CONTRIBUTING.md) | The four design constraints that are not negotiable |
| [AGENTS snippet](AGENTS.snippet.md) | The block that makes your agent use this |

---

## CLI reference

```
whynot init                     Create .decisions/ and the .gitattributes rule
whynot add --title T --why W    Record an entry
      [--type rejected|decision|constraint]
      [--revisit "condition"]   When to reconsider
      [--ttl N]                 Days until it expires
      [--expires never]         Explicitly permanent
      [--evidence pr:412]       Repeatable
      [--tags infra,session]
whynot list [--all]             List live entries
whynot check "<query>"          Show live entries matching a query
whynot stale                    Entries needing a human decision
whynot renew <id> [--days N]    Extend an entry's life
whynot retire <id>              Archive an entry (never deletes)
whynot audit [--days N]         Scan agent config files (read-only)
whynot doctor                   Validate the store
whynot mcp                      Run the MCP server on stdio
```

---

## License

MIT. No account, no telemetry, no paid tier, no closed binary.
There is nothing to upsell you.

---

<p align="center">
  <sub><a href="README.zh-CN.md">简体中文</a> · <a href="https://github.com/Stakenshake/whynot">GitHub</a> · <a href="https://www.npmjs.com/package/whynot-cli">npm</a></sub>
</p>
