# Frozen manifests

One file per ticket, `<issue>.json`, written by the main session when the owner approves the ticket at gate 1 (ADR 0011). It lists the paths nobody but the test designer may edit until the ticket is closed: Gherkin features, step definitions, the test designer's red unit tests, contracts, and the hash of the ticket text. A PreToolUse hook (agent rules ticket) denies Edit and Write on these paths for every other agent; the Stop hook `stop-tests` compares each frozen file with its `sha256`, so frozen files committed on the task branch pass and any later change blocks. The manifest doubles as the "Belegt durch" table of the PR.

```json
{ "issue": 123, "approvedAt": "2026-10-18T12:00:00Z", "ticketSha256": "…", "paths": ["features/…", "tests/…", "packages/contracts/…"],
  "pyramidNote": "optional: why this ticket deviates from 80/15/5",
  "tasks": { "1": ["tests/…"], "2": ["features/…", "packages/contracts/…"] },
  "redRun": { "tests/…": { "command": "…", "base": "…", "exitCode": 1, "sha256": "…", "reason": "red for the right reason: …" } },
  "sha256": { "features/…": "<sha256 of the approved content>" } }
```

`tools/check_test_pyramid.py` (advisory) counts the test cases of the listed test files per stage from their paths: `*.test.ts(x)` is stage 1 (`it`/`test` calls), `.feature` files are stage 2a under `services/*/features/`, 2b under `apps/*/tests/`, 3 under `tests/api/`, 4 under `tests/e2e/` (`Scenario` and `Scenario Outline` lines); `tests/acceptance/` is not counted.

## Red before green

`tools/check_red_before_green.sh <base>` (CI job `red before green`, logic in `tools/check_red_before_green.py`) proves that the frozen tests a branch brings fail on the base for the right reason (`tools/classify_red_reason.py`). It checks the base out into a temporary directory (throwaway index, no write to `.git`), copies the HEAD content of the frozen files in scope onto it and runs each test file on its own.

- Merge base: scope, "deleted", "unchanged" and "changed manifest" are computed against `git merge-base <base> HEAD`, so a branch behind main is not blamed for what main merged since; the tests still run on the tip of the base.
- Manifests: every `.claude/frozen/*.json` at HEAD or at the merge base. When a manifest exists at the merge base, `paths` and `tasks` are the union of both versions, so a branch cannot shrink its own scope.
- Paths: git paths are read NUL-separated (`-z`, `core.quotePath=false`), so spaces and umlauts count. Every listed path must be relative ASCII, without `..`, `.` or empty segments, without a segment starting with `-` or a space or ending with a space. TypeScript, feature and other files allow `A-Z a-z 0-9 _ . @ + - ( ) [ ] { } $` and the space (router patterns such as `[id]`, `(group)`, `$param`); Python files the same without `( ) [ ] { } $`, because the name goes into `unittest -p`. A symlink (tracked, in the checkout, or as a parent) is refused. Any violation fails.
- Scope: every listed file of a manifest this branch changes; for a manifest it does not change, the listed files its diff touches. A file is unchanged only when its blob at the merge base equals its blob at HEAD; unchanged tests are named, not re-run. A listed file missing at HEAD that exists at the merge base fails as deleted. One absent from both is skipped and named when it belongs to another task; it fails when it belongs to a task this branch works on (one of its files changed or deleted; also under an unchanged manifest, every file of that task must exist), to no task, or to a manifest without `tasks`.
- `*.test.ts(x)`: `pnpm exec vitest run --root <workspace> <file>` after `pnpm install --frozen-lockfile` on the base (a failed install fails); the workspace is `apps/<x>`, `packages/<x>`, `services/<x>` or `tests/<x>`, the repository root for anything else (`scripts/`). Vitest runs with `NO_COLOR=1` and `FORCE_COLOR=0`; the classifier strips ANSI codes as well. A non-zero exit whose summary shows no failed test is unproven.
- `tools/tests/test*.py`: `python3 -I -m unittest discover -s tools/tests -p <file>`; `evals/tests/test*.py` the same from `evals/` with `-s tests`. Right reason: failing tests, the module or file under test missing on the base and present in the HEAD commit (relative paths resolve against the run directory); wrong: a SyntaxError while loading (not in an assertion text), a missing package, a missing file or module inside the test's own `tests/` directory (a helper or fixture that is not frozen), any other load error before a test ran.
- `*.feature`: named only; the stage 2a/3 run of the PR proves them. Other files that look like tests (`*.spec.*`, `*.test.mts`, `test_*.py` elsewhere, nested `tools/tests/**`) fail as "unproven, no runner"; helpers are copied, not run.
- Green on the base ("unproven") or red for the wrong reason fails and names the file.
- Bootstrap: a base without `pnpm-lock.yaml` cannot run TypeScript tests. The check then takes the manifest's `redRun.<file>` entry (HEAD), which needs a non-zero integer `exitCode` and a non-empty `reason`, and says so; a missing or incomplete entry fails. Python tests still run.
