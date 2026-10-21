# whynot — paste this block into your AGENTS.md / CLAUDE.md

The block below is the *behavioral* half of whynot. The MCP server gives the
agent the ability to read and write decisions; this text is what makes it
actually do so. Copy it verbatim.

---

## Recorded decisions (`.decisions/`)

This repository keeps a record of settled decisions — especially approaches
that were **tried and rejected** — in `.decisions/`.

**At the start of a session**, call `decisions_check` with no arguments. You get
a compact index (id, type, title, tags) of everything already settled. It is
short by design — read it once.

**Before proposing a technical approach**, call `decisions_check` with keywords
for what you are about to suggest, and read the full entries that come back. If
the topic is covered, do not re-propose the rejected option. You may propose it
again only if you can point to concrete evidence that the stated `revisit_when`
condition has now been met.

Matching is keyword-based, so **query with the nouns the entry would use**, and
try more than one phrasing before concluding nothing is recorded. An empty
result means "nothing found", not "nothing decided".

**When the user rejects one of your suggestions**, or when you discover that an
approach does not work, call `decisions_record` with:
- `title` — what was ruled out
- `why` — the specific reason it failed (not "it didn't work"; say what broke)
- `type: rejected`
- `evidence` — a commit sha, PR number, or URL a human can check later
- `revisit_when` — strongly preferred: the condition that would change the answer

Every entry expires (90 days for a rejection by default) and then stops being
shown to you. If a decision is genuinely permanent, say so to the user and let
them decide — do not set a long TTL yourself to work around this.

**When you are asked to plan or design**, call `decisions_stale` first and
surface anything that needs re-confirmation. Do not silently follow a stale
entry; ask. A stale entry is a question for the user, not an instruction.

Never invent an entry, and never record something the user did not actually
decide. A wrong entry is worse than a missing one, because it will be trusted
for months.

---

## Registering the MCP server

`decisions_check` / `decisions_record` / `decisions_stale` come from the whynot
MCP server. Add it to your agent's MCP config:

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

If your agent reads `AGENTS.md` but not MCP, the fallback still works: the
entries are plain Markdown in `.decisions/`, so the agent can read and grep them
directly. That is intentional — the format is the product, and it keeps working
without the tool.
