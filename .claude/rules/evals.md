---
paths:
  - "evals/**"
---

# Evals

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Keep the sections, fill them as the code arrives; an empty section is a reminder, not a licence to invent.

## Responsibility
The Golden Set, the harness, the measurement reports (ADR 0003, `docs/spec/messaufbau-erkennung.md`), the second-label tools and the judge calibration.

## File map
`evals/golden/<slug>/` one excerpt (audio, reference transcript, labels, review export); `evals/src/harness/`; `evals/configs/` (baseline, arms, prompts, pricing); `evals/reports/` committed measurement reports (Markdown); `evals/tools/` corpus and review tooling; `evals/PROGRESS.md` when a long run is in flight.

## Pitfalls
- Golden Set files are reference data: never edit audio, transcripts or labels to make a run look better; corrections go through the review page and `apply_review.py`.
- Python under `evals/` is stdlib only and runs with `python3 -I`; downloads are untrusted and never executed.
- Real runs cost money: budget cap per run in the config and per month in `evals/budget.json`; the owner starts every paid run himself, CI never does; mock runs are free and run in CI.
- Golden Set regression in three stages (`docs/process/test-strategy.md`): stage 1 (harness tests plus mock run) on every PR; stage 2 (one real run per changed arm) when prompts, model fields or pipeline parameters change, with a report whose metadata names the PR commit, compared with `evals/reports/baseline.json` (recall and precision at most 0.02 worse, attribution 0.01, cost 10 %, p95 1 s); stage 3 (full run against the absolute thresholds of ADR 0003) before a release.
- Reports are committed with the config and commit they measured; a changed prompt, model or parameter is a new report, never an overwritten one. Only the Markdown evaluations are committed (owner, 2026-10-25); raw run JSON stays local or becomes an Actions artifact (`evals/.gitignore`), the JSON files already in git stay. A stage-2 report names the measured commit in a head line `Commit: <sha>` (`tools/check_eval_report.py`).
- Keys come from the owner's shell per run; never printed, never in the repo.

## Configuration
`evals/configs/*.json`; thresholds are data, not code.

## Tests
`cd evals && python3 -I -m unittest discover -s tests`; mock run before every commit that touches the harness.
