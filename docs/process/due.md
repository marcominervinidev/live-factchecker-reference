# Dated commitments

What was decided "by a date" and has no natural file of its own. `tools/check_due_dates.py` (stage 0, pre-commit and CI) fails when a marker `DUE <date>` anywhere in the repository lies in the past; a commitment is closed by doing it and deleting its row, or by a new owner decision with a new date. Exceptions in tool files carry the marker in place (a comment next to the suppression, Trivy's own `exp:` in `.trivyignore`).

The dates below were set on 2026-11-20, when the stock review found every one of these commitments past its date or without one; each needs the owner's decision before it arrives.

| Commitment | Due | Decided by, where |
|---|---|---|
| First retro (skill `retro`): "zum ersten Mal nach drei gemergten Tickets" | DUE 2026-12-18 | `docs/process/rollen.md` |
| First synthesis note under `docs/synthesis/`: "die erste nach T1" | DUE 2026-12-18 | ADR 0011, addendum 2026-10-25 |
| Mutation threshold `break` per package (measured score minus five points); `break: null` today | DUE 2026-12-18 | `docs/process/test-strategy.md` |
| SonarQube Quality Gate on new code becomes a required check, or stays advisory by decision | DUE 2026-12-18 | `docs/process/pr-format.md`, `sonar-project.properties` |
| Dependabot version updates resume (all five ecosystems are paused) | DUE 2026-12-18 | `.github/dependabot.yml` |
| Whole-file Semgrep exceptions become line-level `nosemgrep` comments or go | DUE 2026-12-18 | `.semgrepignore` |
