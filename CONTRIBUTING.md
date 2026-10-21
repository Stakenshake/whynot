# Contributing

Thanks for looking. This project is small on purpose, and a few design
decisions are not open for negotiation. Read this before opening a PR.

## The four constraints

These are the reason the tool exists. A PR that breaks one will be declined,
even if it is well written and useful in isolation.

1. **The data stays plain Markdown in git.** No database, no binary format, no
   schema that requires the tool to read. If this project dies, users must be
   able to `grep` their own files.

2. **No vector store, no embeddings, no model call on the write path.**
   Retrieval quality is not the bottleneck; auditability is. Vector stores and
   LLM-extracted memories are the failure modes this project is a response to.

3. **No daemon, no background process, no file watching.** The tool runs when
   it is called. Background processes are how these tools become unreliable and
   then abandoned.

4. **No hosted service, no telemetry, no account.** Decisions about someone's
   codebase are the most sensitive thing in their repository. They stay on the
   user's machine.

If you think one of these should change, open an issue and make the argument
with evidence. The constraints are load-bearing, not aesthetic.

## What is welcome

- Bug fixes, especially cross-platform ones.
- Better heuristics for `whynot audit`, with tests.
- Documentation that is shorter or clearer than what it replaces.
- Additional agent integrations that reuse the existing file format.
- Reproductions of the validation experiments on other models. If a model
  behaves differently from what `docs/validation.md` reports, that is a useful
  finding — please share it.

## What will be declined

- Anything that makes the tool heavier without removing a reported problem.
- New configuration surface. Every option is a thing someone has to understand.
- "Make it work for teams" features that require a server.
- PRs that rewrite the README into marketing copy.

## Before you send a PR

```bash
node --test "test/*.test.js"
```

There are no dependencies to install. If a test fails on your machine but not
in CI, that is a bug worth reporting — the project claims to work on Windows,
macOS, and Linux.

Keep commits focused. One change per PR. Explain *what problem it removes*, not
what feature it adds.

## Style

- Plain language in docs. Short sentences. No superlatives.
- Comments explain *why*, not *what*. If the code needs a comment to say what it
  does, rename something instead.
- No emoji in source files.
- Chinese and English docs are kept in sync. If you change one, change both or
  flag it in the PR.

## Security and privacy

Do not include personal paths, usernames, API keys, or the contents of anyone's
`~/.codex` or `~/.claude` directory in a PR or an issue. `experiments/out/` is
gitignored for this reason; keep it that way.

If you find a leak, open an issue without pasting the leaked value.
