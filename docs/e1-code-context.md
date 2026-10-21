# E1 — Does real code context change the effect?

**Result: it depends on the model, and the pooled number hides that. GPT
replaces the decision with the code; DeepSeek does not.**

This is the experiment that most threatens the project's claim, and the result
is genuinely mixed. It also produces the sharpest statement of what the tool is
actually for.

---

## Why this experiment exists

Every earlier experiment gave the model a task with no code. That leaves an
obvious alternative explanation:

> The model obeyed the decision only because it had nothing else to reason from.

If true, the public claim would have to change from "agents blindly obey stale
decisions" to "agents obey any given constraint when starved of context".

---

## Design

A real Node/Express project (`experiments/e1/fixture/`, 19 files, ~410 lines)
with conventions that matter: Postgres for all app data, service layer takes
`tenantId` first, `REDIS_URL` declared in config but unused, README notes that
Redis was being evaluated.

Four conditions, n=12 per model per cell:

| | Code context | Decision |
|---|---|---|
| C0 | no | no |
| C1 | no | yes |
| C2 | yes | no |
| C3 | yes | yes |

Task: add session storage to this project, 100k DAU, two regions.

Models: GPT-6.1-Sol, DeepSeek V4.1 Flash. Judge: Claude Haiku (third family).
**96 responses, 0 judging errors.**

The decision was injected through the real `decisions_check` tool; the script
aborts if the returned context does not contain the entry.

---

## Results

| Condition | GPT | DeepSeek | Pooled |
|---|---|---|---|
| C0 no code, no decision | 10/12 | 12/12 | **22/24 (92%)** |
| C1 no code + decision | 0/12 | 0/12 | **0/24 (0%)** |
| C2 code, no decision | **0/12** | **10/12** | **10/24 (42%)** |
| C3 code + decision | 0/12 | 0/12 | **0/24 (0%)** |

Derived effects:

| Effect | Size |
|---|---|
| Decision, without code (C1 − C0) | −92 pts |
| Decision, with code (C3 − C2) | −42 pts |
| Code alone, no decision (C2 − C0) | −50 pts |

The pooled H3 test — "does the decision still work with code?" — reads as
**0 pts change** and the automated verdict said "H3 not supported".

**That verdict is wrong, because the two models do opposite things.**

---

## The split

### GPT: the code replaces the decision

With code and no decision, GPT already refuses Redis in 12 of 12 runs. It says
so explicitly:

> "现有 `REDIS_URL` 只是历史配置，不应成为选用 Redis 的理由。"
> *(The existing REDIS_URL is just historical config; it is not a reason to pick Redis.)*

> "现有项目的数据已经全部放在 PostgreSQL，增加 session 表能直接复用连接池、备份和运维体系。暂时不引入 Redis。"

Adding the recorded decision changes nothing (0/12 → 0/12). For GPT, **the code
is sufficient**; the decision is redundant in this case.

### DeepSeek: the code is not enough

DeepSeek reads the same code and still recommends Redis in 10 of 12 runs. Only
when the decision is present does it stop (0/12).

For DeepSeek, the decision remains **decisive even with the code in front of it**.

---

## What this actually says

The pooled framing ("the effect survives code context") is technically what the
numbers say and substantively wrong. The honest statement:

> Whether a recorded decision matters depends on whether the model uses the code.
> For a model that reads the repository and infers its conventions, a decision
> that the code already implies is redundant. For a model that does not, the
> decision is the only thing that stops it.

### And it sharpens the product thesis

The fixture's code makes "use Postgres" obvious — that is what code does, it
encodes the choices that were made. **What code cannot encode is the
alternative that was rejected.** Nothing in the repository says "we tried Redis
and it failed at 8 seconds", because a rejected option leaves no artifact.

That is exactly the gap the tool fills, and E1 shows it concretely:

- GPT inferred the chosen option from the code, so the decision added nothing.
- Neither model could infer the **rejection** from the code, and for DeepSeek
  that mattered at 10/12.

So the correct positioning is narrower and stronger than the original:

> Don't record decisions the code already implies. Record the alternatives that
> were rejected, because nothing else in the repository remembers them.

---

## What to change in the public claim

The README should not say "agents blindly obey stale decisions" without
qualification. The defensible version:

> A recorded rejection changes what an agent proposes by 42–92 percentage
> points, depending on the model and on whether the repository already implies
> the answer. Models that read the code can infer what was chosen; none of them
> can infer what was rejected.

---

## Caveats

- Two models. The split may look different on Claude or on a larger DeepSeek.
- One fixture, written by us, with deliberately strong conventions. A messier
  repo might not substitute for the decision as cleanly.
- n=12 per cell. The GPT/DeepSeek split is stark (0/12 vs 10/12), but the exact
  rates should not be treated as population estimates.
- The task is still synthetic. E5 (multi-turn with a real agent) is the next
  step for external validity.

---

## A reporting lesson

The script printed "H3 NOT SUPPORTED — the effect survives code context" based
on pooled rates. The per-model table shows the opposite pattern for one model.
**Pooling across models hid a sign flip in the mechanism.**

Rule for the remaining experiments: when the per-model cells disagree in
direction, the pooled number is not a summary — it is a fiction. Report the
split and say so.

---

## Reproduce

```bash
node experiments/e1/build-fixture.mjs
node experiments/e1/run.mjs
```
