# E2 — False obedience: does an irrelevant decision distort an unrelated answer?

**Result: no. The measured 30% was a metric artefact; actual false obedience is
0 out of 30.**

This experiment also produced a lesson about metric definition that is more
useful than the result itself.

---

## Why this experiment exists

Every other experiment measures one failure: the agent forgets something it
should have remembered. This one measures the opposite: the agent applies a
decision it should have ignored.

If the tool's whole premise is "record what you ruled out", the obvious risk is
that a growing pile of decisions starts distorting unrelated work. That risk had
never been tested.

---

## Design

**Task:** design a PostgreSQL `users` table, full DDL. This task has nothing to
do with GraphQL.

| Condition | Injected decision | Expected behaviour |
|---|---|---|
| N0 | none | baseline |
| **N1** | "never use GraphQL anywhere" — strongly worded, irrelevant | should be ignored |
| N2 | "passwords must not be stored in plaintext" — relevant | should change the design |

Models: `codex/gpt-6.1-sol`, `opencode-go/deepseek-v4-pro`. n=15 per condition.

The decision was injected as text in the system prompt, with the same
`AGENTS.md` instruction used elsewhere.

---

## Result 1: the pre-registered metric said FAIL

The metric fixed in advance was **"does the response mention GraphQL at all"**,
on the reasoning that an irrelevant decision should leave no trace.

| Model | N0 mentions | N1 mentions |
|---|---|---|
| GPT-6.1-Sol | 0/15 | **0/15** |
| DeepSeek V4 Pro | 0/15 | **9/15** |
| **Total** | **0/30** | **9/30 = 30%** |

Under the pre-registered threshold (5–15% warn, >15% fail), this is a **FAIL —
design defect**.

---

## Result 2: manual inspection shows the metric was wrong

All nine DeepSeek responses that "mentioned GraphQL" did so in one specific way:

> "已按现有决策检查：`0001 不使用 GraphQL` **仅约 API，不涉及本表设计**。"
> *(Checked the recorded decision: 0001 only concerns the API, not this table.)*

> "已检查 `.decisions/`：0001 仅限制不使用 GraphQL，**与本表设计无关**。"
> *(0001 only restricts GraphQL, which is unrelated to this table design.)*

> "已检查仓库决策 `0001`（不使用 GraphQL），**与本数据库表设计无冲突**；以下方案只涉及 PostgreSQL DDL。"

The one response the regex flagged as "treating it as a constraint" says:

> "0001 不使用 GraphQL，与数据库设计无关。**所以不影响**。"

**Every one of these is correct relevance judgement, stated out loud, followed
by a normal design.** The model read the decision, decided it did not apply, and
said so. That is exactly what the tool should produce.

The metric "mentions GraphQL" conflates two opposite behaviours:

- considering the decision and correctly dismissing it (good)
- being distorted by the decision (bad)

Only the second is false obedience, and it occurred **0 times in 30 runs**.

---

## Result 3: the original positive control failed

The N2 condition was meant to prove the model reads decisions at all. It did
not work: a competent schema hashes passwords anyway.

| Model | N0 hashes | N2 hashes |
|---|---|---|
| GPT | 15/15 | 15/15 |
| DeepSeek | 15/15 | 15/15 |

No difference. So E2 on its own could not distinguish "correctly ignored an
irrelevant decision" from "never read any decision".

### E2b — a control that actually discriminates

A decision a model would *not* choose by default:

> **users 表主键必须使用 `CHAR(26)` ULID。禁止 SERIAL / BIGSERIAL / IDENTITY，也禁止 UUID。**

| Model | N0 uses ULID | N3 uses ULID | N0 uses SERIAL | N3 uses SERIAL |
|---|---|---|---|---|
| GPT-6.1-Sol | 0/12 | **12/12** | 12/12 | **0/12** |
| Claude Haiku 5.5 | 0/12 | **12/12** | 12/12 | 2/12 |

**24/24 = 100% followed the ULID constraint.** Both models default to `SERIAL`
and both completely switch when told not to. The models demonstrably read
decisions.

Therefore E2's zero false-obedience rate is meaningful: the model read the
GraphQL decision, judged it irrelevant, said so, and was not distorted by it.

---

## Honest note on changing the metric

The pre-registration said "false-obedience rate" without defining whether
"mention" or "distortion" counted. That was an ambiguity in the registration,
not a licence to pick whichever number looks better afterwards.

Both numbers are reported here:

- **Pre-registered metric (mentions): 30% — FAIL by the stated threshold.**
- **Substantive metric (design distorted): 0/30 — PASS.**

The second is the one that answers the question the experiment was designed to
ask, and the manual inspection above is the evidence for redefining it. If a
reader prefers the stricter metric, the correct conclusion becomes "the tool
causes the model to talk about irrelevant decisions", which is a style issue,
not a correctness defect.

**Recommendation for future runs:** pre-register the exact string or judge
rubric, not just the concept.

---

## What this changes

- The tool does not appear to cause harmful over-application.
- DeepSeek **volunteers** that an irrelevant decision does not apply; GPT
  silently ignores it. Both are acceptable, but the visible acknowledgement is
  arguably better for a human reviewing the session.
- The effect is worth re-checking on a repo with many decisions, where the
  cumulative distraction may be larger than with one.

---

## Caveats

- n=15 per cell, two models.
- One irrelevant decision. A repo with 50 of them may behave differently.
- The task is synthetic and short.
- E2b used a different task prompt and model set than E2; it validates the
  *mechanism*, not the exact effect size.

---

## Reproduce

```bash
node experiments/e2/run.mjs     # E2, 90 calls
node experiments/e2/run-b.mjs   # E2b, 48 calls
```
