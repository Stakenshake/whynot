# Pre-registration

Written before the supplementary experiments were run, so that the decision
rules cannot be adjusted after seeing the results.

Created: 2026-10-20
Status: active. Do not edit after data collection begins.

---

## Why this file exists

The original experiments reported numbers after the fact, with thresholds
chosen implicitly. That makes it impossible for a reader to tell whether a
result was predicted or fitted. This document fixes the hypotheses, sample
sizes, and decision rules in advance.

If a result contradicts what is written here, the honest move is to publish the
contradiction, not to rewrite the rule.

---

## Hypotheses

### H1 — stale decisions are obeyed
An agent given a decision that no longer holds will follow it rather than
question it.

**Prediction:** in the stale condition, ≥70% of responses avoid the rejected
option.

### H2 — expiry removes the effect
If an expired entry is not shown to the agent at all, H1's effect disappears.

**Prediction:** in the expired condition, the rate of avoiding the option falls
to within 15 percentage points of the no-record baseline.

### H3 — code context reduces it (the "information vacuum" hypothesis)
The original tasks contained no code, so the model had nothing to reason from
except the note. With a real codebase in context, the note's influence should
be weaker.

**Prediction:** with code context, the avoidance rate in the stale condition is
at least 20 points lower than without.

**This is the hypothesis most likely to be true and least flattering to the
project.** If it holds, the public claim must be rewritten from "agents blindly
obey stale decisions" to "agents obey given constraints when they have no other
information".

### H4 — decisions are over-applied (false obedience)
An agent given a strong but irrelevant decision will let it distort an unrelated
answer.

**Prediction:** false-obedience rate < 10%.

### H5 — obedience increases with age
Older decisions are obeyed more often.

**Prediction:** monotonic increase across 1 month → 7 years.

### H5' — obedience is age-independent
The competing hypothesis. Models have no sense of how old a note is.

**Prediction:** flat across 1 month → 7 years.

H5 and H5' are mutually exclusive. **Both are publishable.** H5' is the stronger
finding because it means the problem is structural, not a matter of degree.

### H6 — prompt warnings do not work
Adding "this is old, be skeptical" to the supplied context does not change
behaviour; removing the entry does.

**Status:** already tested once (experiment 3). Result: no reliable improvement.

---

## Experiments and decision rules

### E0 — judge calibration

**Design:** all 62 existing responses, blinded, scored by three judges from
different model families (Claude Haiku, Kimi K3, DeepSeek Flash). Compared
against human labels using Cohen's kappa.

**Decision rule (fixed before running):**

| worst judge κ | action |
|---|---|
| ≥ 0.80 | PASS — use majority vote downstream |
| 0.60 – 0.80 | WARN — proceed, but disclose and add human spot-checks |
| < 0.60 | **FAIL — stop all further experiments until scoring is redesigned** |

**Known limitation:** the "human" labels were produced by the same assistant
that designed the experiments, blind to condition but not independent. The user
must audit a random subset. If the audit disagrees on more than 10% of items,
the labels are not a valid reference and E0 is re-run with the user's labels.

---

### E1 — code context

**Design:** three fixture repositories (small/medium/large), each with a planted
decision. Conditions: no decision, decision injected, decision discovered by
reading the repo.

**Sample:** n=10 per condition per model, 2 models.

**Decision rule:** H3 is supported if the code-context condition shows an
avoidance rate at least 20 points lower than the injected condition, with a
confidence interval excluding zero.

---

### E2 — false obedience

**Design:** a strongly worded but irrelevant decision, plus a relevant-decision
control.

**Sample:** n=15 per condition, 2 models.

**Decision rule:**

| false-obedience rate | action |
|---|---|
| < 5% | acceptable |
| 5 – 15% | add a constraint to the AGENTS.md instruction and retest |
| > 15% | **design defect — do not ship until fixed** |

---

### E3 — statistical power

**Design:** the Redis and TypeScript experiments at n=20 per condition, three
model families.

**Primary analysis:** pooled effect across models, Wilson 95% intervals, Fisher
exact test, risk difference.

**Decision rule:**
- pooled p < 0.01 and risk difference ≥ 0.40 → main claim stands
- p < 0.05 with a smaller effect → downgrade the wording
- not significant → **publish the correction**

---

### E4 — dose-response

**Design:** one decision, six ages (1 month, 6 months, 1 year, 3 years, 7 years,
plus an expired 7-year control), n=12 per cell, 2 models.

**Analysis:** Cochran-Armitage trend test.

**Decision rule:**
- D1 < 30% and D5 > 70% → H5 (dose effect)
- D1..D5 all > 70% → H5' (age-independent). Rewrite the narrative accordingly.
- D6 not close to D0 → the expiry mechanism is faulty; stop and fix.

---

### E5 — multi-turn with a real agent

**Design:** Codex CLI against a fixture repo, 8–12 turns, three conditions.

**Decision rule:** report the turn at which the decision stops influencing
behaviour, and the token cost. No pass/fail threshold — this is descriptive.

---

### E6 — two-week field test

**Status: not run.**

**Consequence:** the project may claim that the mechanism works under test. It
may **not** claim that using the tool reduces repeated mistakes.

**Design (for anyone who wants to run it):** 14 days without the tool, 14 days
with it, on a real project.

**Primary metric:** repeated-mistake rate — how often the agent re-proposes
something already rejected.

**Decision rule:**
- ≥ 30% reduction → the tool helps
- < 10% reduction → it does not
- increase → it hurts

---

## Amendments

Amendments are recorded with the date and the reason. Changing a decision rule
after seeing data is exactly what pre-registration exists to prevent, so any
change is logged here and both the original and amended rules are reported.

### 2026-10-21 — E2 metric definition

**Original:** "false-obedience rate < 10%", without specifying what counted.

**Problem found during analysis:** the implementation used "response mentions
the irrelevant option at all". Manual inspection of the 9 flagged responses
showed they all said the decision *did not apply* — correct behaviour, not
obedience. The metric conflated "considered and dismissed" with "distorted by".

**Amendment:** report both metrics.

- mentions: 9/30 (30%) — the pre-registered reading, which is a FAIL
- design distorted: 0/30 (0%) — the substantive reading

Both are published in `e2-false-obedience.md`. The stricter number is not
hidden and the redefinition is argued from the raw text, not from preference.

**Future experiments:** pre-register the exact rubric or the exact string
matched, not just the concept.

### 2026-10-21 — E4 judge failure

Kimi K3 returned `error` for every response from D2 onward. The original
summary counted errors as non-events, turning a judging failure into a clean
0/12. All 168 responses were re-judged with DeepSeek Flash.

**Rule added:** an error is never a data point. Errors are excluded from
denominators and reported. This rule is now enforced in the E3 script, which
re-judges failures with a fallback judge.

### 2026-10-21 — E3 query bug (caught before analysis)

The first E3 run used the query `技术 选型 存储 语言` for a decision titled
`session 不存 Redis`. No query term matched, so `decisions_check` returned
"nothing found" and the treatment condition was identical to the control. The
run was stopped before any analysis.

**Rule added:** every experiment that injects a decision now asserts that the
returned context contains the decision's title, and aborts otherwise.

---

## Analysis conventions

- Report confidence intervals, never bare proportions.
- Report the number of excluded or errored samples.
- Report inter-rater reliability for any model-judged outcome.
- Judge calls use `temperature: 0`.
- Any response that is truncated or missing a conclusion is labelled `unclear`
  and included in the denominator. Dropping it would inflate agreement.

## What would make me abandon the project

Stated in advance so it cannot be rationalised later:

1. E0 fails (κ < 0.60) and the scoring cannot be redesigned.
2. E2 shows > 15% false obedience and the instruction cannot fix it.
3. E3 shows no significant effect at n=20.
4. E6 shows no reduction in repeated mistakes over two weeks.

Any one of these is sufficient. The project's value depends on the claims being
true, not on the claims being published.
