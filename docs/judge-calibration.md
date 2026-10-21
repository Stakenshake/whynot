# E0 — Judge calibration

**Decision: PASS.** The judges are usable. One caveat below is important enough
that it should travel with every downstream number.

Run: 2026-10-20 · 62 blinded responses · 3 judges · 186 model calls

---

## Why this was the first experiment

Every claim in [validation.md](validation.md) rests on a model judging whether a
response recommends or excludes an option. If that judgement is unreliable, all
the numbers are unreliable. This was the cheapest experiment that could
invalidate everything else.

The pre-registered rule: if any judge's κ fell below 0.60, all further
experiments stop until the scoring is redesigned. See
[preregistration.md](preregistration.md).

---

## Method

1. All 62 existing responses were anonymised: condition stripped from the
   filename, IDs assigned (`E0-001` … `E0-062`), order shuffled with a fixed
   seed.
2. Labels were assigned blind — from response text only, with no knowledge of
   which experiment or model produced them.
3. Three judges from different families scored the same 62 items at
   `temperature: 0`.
4. Agreement measured with Cohen's κ against the human labels, and pairwise
   between judges.

| Judge | Family | Model |
|---|---|---|
| A | Anthropic | `opencode-go/claude-haiku-5-5` |
| B | Moonshot | `moonshot-cn/kimi-k3` |
| C | DeepSeek | `workbuddy-ai/deepseek-v4.1-flash` |

Judge C was chosen deliberately from the same family as some of the judged
outputs, to test for same-family leniency.

---

## Results

### All 62 items

| Judge | κ | Agreement | Errors |
|---|---|---|---|
| Claude Haiku 5.5 | 0.936 | 96.8% | 0 |
| Kimi K3 | 0.936 | 96.8% | 0 |
| DeepSeek Flash | 0.937 | 96.8% | 1 |
| Majority vote | 0.936 | 96.8% | — |

### Excluding the two malformed samples

Two responses (`E0-054`, `E0-061`) were `reasoning_content` dumps — the model
never produced a final answer. They were labelled `unclear`. The judges read
the reasoning and inferred a recommendation, which is defensible but not the
same thing as reading a conclusion.

On the 60 well-formed responses:

| Judge | κ | Agreement |
|---|---|---|
| Claude Haiku 5.5 | **1.000** | 60/60 |
| Kimi K3 | **1.000** | 60/60 |
| DeepSeek Flash | **1.000** | 60/60 |
| Majority vote | **1.000** | 60/60 |

### Pairwise

| Pair | κ | Agreement |
|---|---|---|
| Claude vs Kimi | 1.000 | 100% |
| Claude vs DeepSeek | 0.935 | 96.8% |
| Kimi vs DeepSeek | 0.935 | 96.8% |

### Same-family leniency: not detected

The DeepSeek judge scored DeepSeek-produced responses no differently from the
others. κ was 0.937 versus 0.936 for the other two. This was the specific thing
experiment design was checking for, and the null result is worth recording.

---

## The caveat that matters

**κ = 1.000 does not mean "the judges are excellent". It means "this labelling
task is easy".**

Almost every response states its conclusion explicitly — "建议采用 TypeScript"
or "不使用 TypeScript" — within the first few lines. The sample contains
essentially **no genuinely ambiguous cases**. So this experiment establishes:

- The judges do not systematically disagree on clear responses. ✅
- The downstream numbers are not an artefact of sloppy scoring on clear
  responses. ✅

It does **not** establish:

- That the judges handle hedged or ambiguous responses correctly. ❌
- That the labels are independent of the experimenter. ❌

A perfect κ is a warning sign as much as a result. It says the measurement is
not the hard part of this research; the experimental design is.

---

## Independence caveat — and the audit result

The "human" labels were produced by the same assistant that designed the
experiments. They were blind to condition, but they are not an independent
reference. A 20-item audit by the project owner was required.

**Audit result: 19/20 agreement, within the pre-registered threshold of 2.**

| | |
|---|---|
| Items reviewed | 20 |
| Agreement | 19 |
| Disagreements | 1 |
| Threshold | ≤ 2 |
| Result | **PASS** |

The single remaining disagreement (`E0-061`) is genuine: the response is a
truncated reasoning dump with no final conclusion, so `recommends` and
`unclear` are both defensible.

Two initial disagreements (`E0-013`, `E0-026`) were corrected by the reviewer
after reading the full response text; both responses state the conclusion
explicitly. This is a useful signal about the review process itself: **an
excerpt is not always enough for a human reviewer**, even when it is enough for
a model. The audit sheet truncates long responses, and that truncation caused
two of the three initial disagreements.

Files: `experiments/e0/audit-sample.md`, `answer-sheet.md`, `audit-key.json`,
`audit-result.json`.

**Treat the labels as an independent-enough reference, not as ground truth.**
The reviewer and the assistant agreed on 19 of 20 items, which is evidence that
the labels are not idiosyncratic. It is not evidence that either is correct on
the genuinely ambiguous cases.

---

## What this changes downstream

1. **Majority vote is safe to use** for E1–E5, with the `unclear` rate reported.
2. **Report the `unclear` count in every experiment.** Dropping unclear items
   inflates agreement; they stay in the denominator.
3. **Add a human spot-check to E3**, because E3's sample will contain more
   ambiguous cases than this one did.
4. **Do not claim the judges are validated on hard cases.** They are validated
   on easy ones.

---

## Reproduce

```bash
node experiments/e0/judge.mjs --dry   # print the plan
node experiments/e0/judge.mjs         # 186 calls
node experiments/e0/make-audit.mjs    # render the 20-item human audit
```

Files: `blind-sample.json`, `human-labels.json`, `judge-*.json`,
`calibration.json`, `audit-sample.md`, `audit-key.json`.
