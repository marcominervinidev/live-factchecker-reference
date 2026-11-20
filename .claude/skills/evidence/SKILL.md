---
name: evidence
description: "Collect the proof that a task is done in a fixed format: real command output with exit code, requests and responses, report rows, screenshots. Use before reporting any task, PR or ticket as done."
---

# Collect evidence

"Done" and "tests pass" are claims. A finished task leaves artifacts the owner can check without rerunning anything.

## Format of a text artifact

```
$ <exact command>   # one line: what situation this shows
<real output, ANSI colours stripped>
exit code: <n>
```

- Capture real output; never retype or shorten by hand (`sed -E 's/\x1b\[[0-9;]*m//g'` strips colours). Replace machine-specific paths with `<repo>` or `<tmp>`.
- Negative cases show the failing output and the non-zero exit code. Skipped tests are named with the reason.

## What to capture

| Area | Evidence |
|---|---|
| Tests, lint, scanners | the command output per stage |
| Pipeline | the harness or acceptance report row (claim found, verdict, latency), log lines with counters |
| API | real request and response against the agent's own stack (`lfc-<issue>-<task>`) |
| Frontend | acceptance screenshots and aria snapshots, console errors |
| Platform | `docker compose config`, a real start with health check, `hadolint`/`actionlint` output |
| CI | `gh pr checks` output, run link |

## Where it goes

Into the PR as the table "Belegt durch" (one row per acceptance criterion: criterion, proving test or command, stage) with the artifacts in collapsed `<details>` blocks; the frozen manifest lists the criteria. Long outputs live as CI artifacts, not in the repository.

## Never

No secrets, tokens, `.env` contents, keys; no transcript text from real conversations beyond what the Golden Set already publishes; grep the artifact before pasting.
