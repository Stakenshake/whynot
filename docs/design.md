# Design

Why the tool looks like this.

## The problem

A coding agent has no memory of last week. Every session starts from nothing.
That is mostly fine: the code is the state, and the agent can read it. What it
cannot read is **why you rejected an approach**.

That knowledge has three properties that make it hard:

- It does not exist in the repository. It exists in someone's head.
- It decays. Six months later, the person remembers "we tried something" but
  not what broke.
- It is expensive to rediscover. The agent will happily spend tokens walking
  the same dead end again.

## The finding that shaped the design

We recorded a 2019 decision — "do not use TypeScript, the team does not know
it" — and asked two model families to choose a stack for a brand-new 2026
service. Every response followed the seven-year-old note. Adding a warning to
the prompt ("this is old, be skeptical") did not fix it. Making the entry
expire did.

The full numbers are in [validation.md](validation.md).

The conclusion: **an agent cannot be relied on to weigh a stale instruction
correctly.** So the design does not ask it to. An expired entry is not shown to
the agent at all.

This one decision explains most of the rest of the design.

## Four decisions

### 1. Data is Markdown in git

Everything else follows from this.

- A human can read and edit it without the tool.
- `git diff` gives review for free.
- `git revert` gives an undo for free.
- If the project is abandoned, the data is still usable with `grep`.

Most tools in this space store decisions in a database or a vector index. When
those projects die, users lose the data along with the tool. This project is
designed so that cannot happen.

### 2. Expiry is the default

Every entry carries an expiry date. `rejected` entries last 90 days, `decision`
180, `constraint` 365. When it lapses, the entry stops reaching the agent.

An expired entry is not deleted. `whynot stale` surfaces it, and a human either
renews it or retires it. Both are explicit actions.

`expires_on: never` exists for genuinely permanent constraints, but it must be
written deliberately. Permanence should be a decision, not a default.

### 3. No embeddings, no model calls on write

Retrieval is deliberately simple: case-insensitive keyword matching over titles,
tags, and bodies, scored by how many query terms hit.

Two reasons:

- **Auditability.** When an entry appears in the agent's context, it is obvious
  why: the words matched. With embeddings, nobody can explain it.
- **Cost and failure modes.** Vector indexing goes stale. LLM extraction is
  expensive and is the main source of corrupted memories in the tools that use
  it. Both are avoidable here, so they are avoided.

The trade-off is real: keyword matching misses paraphrases. That is why
`decisions_check` with no query returns a compact index of everything live, so
the agent can see the full list cheaply before narrowing down.

### 4. The format works without the tool

The agent gets `decisions_check` through MCP. If MCP is unavailable, it can
still read `.decisions/` directly — that is just Markdown.

This was not a theoretical property. In the Codex integration test, the MCP
call was blocked by an approval policy, and the agent fell back to reading the
files and still respected the decision.

## Form factor: four layers, not one

A common mistake in this category is picking one form and forcing everything
through it. Each concern here belongs to a different layer:

| Layer | Form | Why it has to be this |
|---|---|---|
| Data | `.decisions/*.md` in git | Works with zero tooling. The durable asset. |
| Behaviour | A block in `AGENTS.md` | Making an agent *proactively record* a rejection is an instruction, not an API. |
| Capability | MCP server | Pull-based, structured, works across agents. |
| Human loop | CLI | Renewing and retiring are human decisions. |
| Distribution | npm and agent plugins | Zero-install; meets people where they already are. |
| **Not** | Hosted API | Decisions about a codebase are the most sensitive artifact in the repo. Hosting them defeats the purpose. |

## Cross-platform

The project targets Windows, macOS, and Linux, because the failure modes are
different on each.

- **Line endings.** `init` writes `*.md text eol=lf` to `.gitattributes`.
  Without it, Windows checkouts write CRLF and every diff shows the whole file.
- **Filenames.** Windows forbids `\ / : * ? " < > |`, and Windows and macOS are
  case-insensitive. Filenames are slugged to `[a-z0-9]` plus CJK, which
  eliminates a class of "works on Linux" bugs.
- **No background process.** Windows file watching is unreliable and needs
  native dependencies. The tool is invoked, never resident.
- **No git hooks.** Cross-platform shell in hooks is a minefield. Not used.

## Deliberately not built

- Vector search or embeddings.
- Any model call in the write path.
- A daemon or file watcher.
- A web UI.
- Automatic detection of rejections (a hook is possible later, but it is not
  required for the core loop).
- Team sync. `git` already does this.
- Multi-repo aggregation.

Each one is a real feature someone has asked for. Each one also makes the tool
heavier, and this category has a graveyard full of heavier tools.

## Open questions

- **Does the repeated-mistake rate actually drop in real use?** The experiments
  measure single-turn behaviour. The claim that matters is longitudinal and has
  not been measured yet.
- **How often does expiry lose knowledge people still need?** The trade is
  deliberate, but the ratio is unknown. `whynot stale` is where that shows up.
- **Does this survive being used by a team?** The design assumes one person
  curating. With five people, who renews what?
- **Is 90 days right for a rejection?** It is a guess. Different codebases move
  at different speeds.
