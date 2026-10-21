# Findings

One page. Every experiment, what it asked, what it found, and how much to
believe it.

Experiment scripts and raw outputs are in [`experiments/`](../experiments/).
Detailed write-ups are linked per row.

---

## The summary table

| # | Question | Design | Result | Confidence |
|---|---|---|---|---|
| **E0** | Can a model judge "recommends vs excludes" reliably? | 62 responses, 3 judge families, human audit of 20 | **κ = 1.000** on the 60 well-formed; 19/20 human agreement | High for clear responses; **not** tested on ambiguous ones |
| **E2** | Does an irrelevant decision distort an unrelated answer? | Schema task + "never use GraphQL", n=15 × 2 models | **0/30** actual distortion | Medium — metric had to be redefined after inspection |
| **E2b** | Do models read decisions at all? | Same task + a non-default ULID constraint, n=12 × 2 | **24/24 followed it** | High |
| **E4** | Does the age of a decision change obedience? | Same text, ages 30d → 7y, n=12 × 2 | **Flat: 0% at every age.** Expired → 100% | High (the flatness is total) |
| **E3** | Are the effects statistically real? | Redis + TypeScript decisions, n=20 × 3 families | **−87 and −78 pts, p < 0.0001** | High |
| **E1** | Does real code context weaken the effect? | 4 conditions: code × decision, n=12 × 2 | **Split:** GPT replaced the decision with the code; DeepSeek did not | Medium — n small, one fixture |
| **E5** | Does a real agent use it across sessions? | Codex CLI, 3 session structures, n=3 | **9/9 respected the decision**; file fallback used every time | Low–medium — one model, n=3 |
| **E6** | Does it help a developer in real use? | 14+14 days, real project | **Not run.** Owner declined the daily logging | — |

---

## Three findings that survived

### 1. The model does not use age as a signal

A decision written 30 days ago and one written 7 years ago were obeyed at
exactly the same rate — zero deviation across 60 runs on two models. Hiding the
expired one restored the baseline completely.

**Implication:** prompting an agent to "be skeptical of old notes" asks it to
weigh a quantity it does not have. Expiry has to be structural.

→ [e4-dose-response.md](e4-dose-response.md)

### 2. Recording a rejection changes the answer, substantially

Pooled across three model families at n=20: 52/60 → 0/60 for the Redis
decision, and 60/60 → 13/60 for the TypeScript decision. Both p < 0.0001.

**Implication:** the core mechanism is real and large.

→ [e3-power.md](e3-power.md)

### 3. The stated reason matters more than the date

Same title, same age, two different reasons:

| Reason in the record | Reads as | Resistance |
|---|---|---|
| "the team did not know TypeScript" | a changeable condition | **13/60 (22%)** |
| "this project's fields change constantly" | a project property | **0/60** |

The resistant responses attacked the premise directly: *"that condition very
likely no longer holds."*

**Implication — and it is counter-intuitive:** a reason that names a
*condition* is safer than one that states a *property*, because it invites the
model to re-check it. The usual advice to write timeless rationales is wrong
for this tool.

→ [e3-power.md](e3-power.md), [e4-dose-response.md](e4-dose-response.md)

---

## The qualification that matters most

**E1 showed the effect is not universal.**

With real code in context and no recorded decision, GPT already chose the
repository's existing technology in 12 of 12 runs; adding the decision changed
nothing. DeepSeek, given the same code, still preferred the rejected option in
10 of 12 runs until the decision stopped it.

So the honest claim is not "agents blindly obey stale decisions". It is:

> Whether a record matters depends on whether the model uses the code. Code
> encodes what was **chosen**; nothing in a repository encodes what was
> **rejected**. Records matter most for the second kind.

→ [e1-code-context.md](e1-code-context.md)

---

## What has not been tested

| Gap | Why it matters |
|---|---|
| **Real-world usefulness (E6)** | The only number a user cares about. Not measured. This project does not claim it. |
| Ambiguous responses (E0) | The judge calibration used almost exclusively clear-cut cases. |
| Long sessions with compaction | E5 used at most 2 turns. |
| Claude / Gemini / larger DeepSeek | E3 used Haiku and DeepSeek Flash. |
| A repo with many decisions | All experiments used one or two. Cumulative distraction is untested. |
| False obedience at scale | E2 tested one irrelevant decision. |

---

## Version note

These results describe the implementation as of 2026-10-21. Experiments are
scripts, not conclusions — if a later change contradicts a number here, the
script wins and this page gets corrected.

Full amendment history, including two experiments whose first pass was wrong:
[preregistration.md](preregistration.md).
