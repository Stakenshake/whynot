# E4 — Dose-response: does the age of a decision matter?

**Result: no. A 30-day-old decision is obeyed exactly as strongly as a
7-year-old one.**

This is the strongest finding in the project, and it changes the argument for
the tool.

---

## Design

One decision, identical text in every condition. Only `created` changes.

> **不使用 TypeScript** — "enterprise reporting services change fields and
> interfaces constantly, but adding TypeScript needs extra build configuration;
> at the time we judged that it would slow delivery."

The context injected into each run was produced by the **real**
`decisions_check` tool against a real `.decisions/` directory, not hand-written.
Each condition's injected text is saved as `experiments/e4/context-D*.txt`.

| Condition | Age | Shown to the agent? |
|---|---|---|
| D0 | no decision | — |
| D1 | 30 days | yes |
| D2 | 182 days | yes |
| D3 | 365 days | yes |
| D4 | 1095 days (3 y) | yes |
| D5 | 2555 days (7 y) | yes |
| D6 | 2555 days, `expires_on` in the past | **no** — only "an older entry has expired" |

Models: `codex/gpt-6.1-sol`, `opencode-go/claude-haiku-5-5`. n=12 per cell.
Task: choose a stack for a brand-new 2026 enterprise reporting service.

Metric: did the response recommend TypeScript? Higher = the decision was
ignored.

---

## Results

| Condition | Age | GPT-6.1-Sol | Claude Haiku 5.5 |
|---|---|---|---|
| D0 | — | 12/12 recommends TS | 12/12 |
| **D1** | **30 days** | **0/12** | **0/12** |
| D2 | 182 days | 0/12 | 0/12 |
| D3 | 1 year | 0/12 | 0/12 |
| D4 | 3 years | 0/12 | 0/12 |
| D5 | 7 years | 0/12 | 0/12 |
| **D6** | 7 years, expired | **12/12** | **12/12** |

**168 responses, 0 errors in judging.**

Two things stand out:

1. **D1 through D5 are identical.** Not a gentle slope — perfect flatness. A
   note written a month ago and a note written seven years ago have exactly the
   same authority.
2. **D6 returns precisely to baseline.** Hiding the expired entry restores
   TypeScript in 24 of 24 runs, on both models.

---

## Interpretation

### H5′ is supported, not H5

The pre-registered competing hypotheses were:

- **H5** — obedience increases with age (older = more authoritative)
- **H5′** — obedience is independent of age

The data supports **H5′**, and the flatness is total. There is no trend to
measure: every live condition produced a 0% rate. The Cochran-Armitage
statistic is undefined precisely because the variance is zero.

### What this means

The original framing — "old decisions go stale" — was wrong in an important
way.

A stale decision is not obeyed because it is old. **It is obeyed because it is
there.** The model does not weigh the age, does not notice that `created:
2019` implies the reasoning may have expired, and does not discount it. Every
recorded decision is treated as current law.

This is a stronger and more uncomfortable claim than the one this project
started with:

> The problem is not that agents fail to notice time. It is that they have no
> concept of a decision being *out of date at all*.

### Why this makes expiry necessary rather than nice

If models discounted old decisions, a well-written note with a date would be
enough. They do not. Nothing inside the model will ever retire a decision.

So retirement has to be **structural**: the entry must stop being visible. D6
confirms that when it does, behaviour returns to baseline completely.

### It also explains the earlier failures

Experiment 3 showed that adding "this is old, be skeptical" to the prompt did
not work. Under H5′ that is expected: the model has no age signal to act on, so
a warning about age is noise. It is not that the warning was badly worded — it
is that the quantity it asks the model to weigh does not exist in the model's
decision process.

### Correction from E3 — age is not the whole story

E3 repeated a similar setup at n=20 with a different reason text:

- E4's reason: *"this project's fields and interfaces change frequently"* — a
  property of the project. Obedience: **total**.
- E3's reason: *"the team did not know TypeScript"* — a snapshot of a team.
  Obedience: **78%**, with 13 of 60 responses recommending TypeScript anyway.

The resistant responses did not ignore the decision. They attacked its premise:

> "它的成立前提是『团队没人会写 TS』，而这个前提现在大概率已不成立"

So the refined conclusion is not "age is irrelevant" but:

**Age is not used as a signal. The stated reason is. A reason that names a
changeable condition gets challenged; a reason that states a project property
does not.**

This matters more for how you write the entry than for how old it is. See
[e3-power.md](e3-power.md).

---

## A methodological failure worth recording

The first judging pass used Kimi K3. It returned `error` for **every** response
from D2 onwards (24/24 in each of five conditions). The summary code counted an
error as "not recommends", which made a total judging failure look like a clean
0/12 result.

Two lessons:

1. **Never let an error silently become a data point.** Errors must be excluded
   and reported. The re-judge script does this; the original did not.
2. **A suspiciously clean result deserves a second look.** The original output
   showed D5 and D6 both at 0/12 and flagged the expiry check as failing. That
   warning was the only thing that surfaced the bug.

Re-judged with DeepSeek Flash (a different family from both subject models,
κ = 0.937 in E0): 168/168 valid, 0 errors.

---

## Caveats

- Two models. Claude and GPT are covered; DeepSeek was not run in E4.
- Single-turn. Long sessions may differ.
- n=12 per cell. The flatness is so total that more samples would not change
  the direction, but the exact 0% should not be quoted as a population estimate.
- The task is synthetic and contains no code. See E1 for that confound.
- The decision text is one sentence of reasoning. A longer, more detailed entry
  might be discounted differently — untested.

---

## Reproduce

```bash
node experiments/e4/run.mjs       # 168 generation calls
node experiments/e4/rejudge.mjs   # 168 judge calls (excludes and reports errors)
```
