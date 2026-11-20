---
paths:
  - ".github/**"
  - "lefthook.yml"
  - "commitlint.config.mjs"
  - "sonar-project.properties"
  - "tools/**"
---

# CI, hooks and repository tools

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Decision: `docs/process/pr-format.md` (planning repo `docs/spec/pr-format.md`).

## Responsibility
`ci.yml` (push: repository checks, stages 0 to 2b, red-before-green, Golden Set mock, Sonar), `pr.yml` (pull request: size, commits, eval report, contracts, hadolint, Semgrep, Fallow, images and Trivy, stages 3 and 4; Stryker returns after the first retro), `main.yml` (after merge: images to GHCR, stack tests), `nightly.yml` (stage 5), `stack-tests.yml` (reusable). `lefthook.yml` is the pre-commit net; `tools/` holds the stdlib checks with their tests. `make ci-local` runs the required checks of `ci.yml` and `pr.yml` before a push.

## File map
`.github/workflows/`, `.github/pull_request_template.md`, `.github/CODEOWNERS`, `lefthook.yml`, `commitlint.config.mjs`, `sonar-project.properties`, `tools/check_*.py`, `tools/check_red_before_green.sh` (with `tools/check_red_before_green.py` and `tools/classify_red_reason.py`), `tools/agent_balance.py`, `tools/usage_from_logs.py`, `tools/nightly_trend.py`, `tools/limit-waechter/`, `tools/templates/`, `tools/tests/`.
`scripts/ci/affected.ts` (test matrices, and `docsOnly`: the one source of the CI path rules), `scripts/ci/docs-only.ts` (`docs_only` for `pr.yml`), `scripts/ci/images.ts`; `scripts/ci/local.sh` behind `make ci-local`.

## Pitfalls
- Actions are pinned by commit SHA with the version as a comment; never `@main`, never `@v3`. Tool configs: `.fallowrc.json`, `knip.json`, `.dependency-cruiser.cjs`, `tools/templates/` (`docs/process/review-tools.md`).
- Minimal `permissions` per workflow and job; `concurrency` per ref; every job has a `timeout-minutes`.
- One aggregate check per workflow (`ci passed`, `pr passed`, `main passed`) is the required check; matrix job names move, never require them individually.
- Until `pnpm-lock.yaml` exists, code jobs are skipped through `has_code`; the repository checks must stay green on their own.
- A changed gate (threshold, advisory set, new required check) is an owner decision named in the PR; never relax a check to get green.
- Secrets only from the repository secrets (`SONAR_TOKEN`, `DEEPGRAM_API_KEY`); never in workflow files, never echoed.
- Python under `tools/` is stdlib only, runs with `python3 -I`, every check has a test in `tools/tests/`.
- Python versions differ: the toolbox has 3.11 (Debian bookworm), the runner 3.12 (ubuntu-24.04). `make ci-local` runs the tool tests in the toolbox, the Golden Set harness in the pinned `python:3.12.3-slim`: under 3.11 its mock-run regression hash differs (follow-up in the evals ticket).
- Updates: Dependabot (`.github/dependabot.yml`) bumps actions and `container.image` pins weekly; tool images in `docker run` steps are pinned `name:tag@sha256:…` and bumped by hand with that PR, together with the same pins in `scripts/ci/local.sh` (`ci-local`; `tools/check_ci_pins.py` fails on two pins of one image); `main.yml` publishes with `provenance: true` and `sbom: true`.
- Path rules live in `scripts/ci/affected.ts` only: a job skips by a job condition on its output, never by `on.paths` or a second list in YAML, else a required check goes missing.

## Minutes
- Private repo, 2-vCPU runners, 3,000 included minutes a month (used up on 2026-10-28, ticket #68). Every job is billed rounded up to the whole minute: a new job costs at least one minute, however little it does.
- A push cancels the running run of its branch or PR (`concurrency`). On main, `ci.yml` and the stack tests get one group per run and are never cancelled; `main.yml` (group `main`, `cancel-in-progress: false`) keeps its running run but GitHub drops a waiting one when a newer push queues behind it, so with three quick merges the middle commit gets no `main passed`. A docs-only PR skips the image build and stages 3 and 4; the toolbox comes from the Buildx cache in GitHub Actions (scope `toolbox-<ISO week>`); a weekday nightly without a change to main since the last green one runs only the Trivy full scan.
- Timeouts: at most 15 minutes for a PR or push job, set to two to four times the expected run; raise one only with the reason in a comment.
- Before every push: `make ci-local` (throwaway `COMPOSE_PROJECT_NAME`); it saves failed runs, it does not replace CI.

## Configuration
Scopes and types in `commitlint.config.mjs` (add a scope with the workspace, same PR); PR size limits in `tools/check_pr_size.py`; Sonar project in `sonar-project.properties`.

## Tests
`python3 -I -m unittest discover -s tools/tests`; `sh .claude/hooks/test-hooks.sh`. Workflow changes are proven by a run on a branch, linked in the PR.
