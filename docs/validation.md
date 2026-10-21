# Validation

This page is now an index. The consolidated results are in
[findings.md](findings.md); the detailed write-ups are below.

| Experiment | Question | Write-up |
|---|---|---|
| E0 | Can a model reliably judge "recommends vs excludes"? | [judge-calibration.md](judge-calibration.md) |
| E1 | Does real code context weaken the effect? | [e1-code-context.md](e1-code-context.md) |
| E2 / E2b | Does an irrelevant decision distort unrelated work? | [e2-false-obedience.md](e2-false-obedience.md) |
| E3 | Are the effects statistically real? | [e3-power.md](e3-power.md) |
| E4 | Does the age of a decision matter? | [e4-dose-response.md](e4-dose-response.md) |
| E5 | Does a real agent use it across sessions? | [e5-real-agent.md](e5-real-agent.md) |
| E6 | Does it help in real use? | **Not run** — see [preregistration.md](preregistration.md) |

## A note on the earlier version of this page

The first version of this document reported results from a single small
experiment (n=3 per condition, two models). Those numbers appeared in the
README and in the launch material.

Several of them were misleading, and one was simply wrong:

- The "6 of 6 obeyed" framing understated the variance; at n=20 the same
  decision was resisted in 13 of 60 responses.
- The first judging pass for the dose-response experiment silently counted
  judge errors as data, producing a clean-looking result that did not exist.

Both are documented in [preregistration.md](preregistration.md). The numbers
that appear throughout the project now come from the experiments linked above.
