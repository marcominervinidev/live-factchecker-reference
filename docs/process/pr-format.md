# PR format, size, commits and gates

Short form for readers in the repo. Decision: ticket "PR-Format, Größe, Commits und Gates" of the process map, `docs/spec/process/pr-format.md` in the planning repo (2026-10-19). Files: `.github/pull_request_template.md`, `.github/CODEOWNERS`, `.github/workflows/*.yml`, `lefthook.yml`, `commitlint.config.mjs`, `sonar-project.properties`, `tools/check_*.py`, skill `open-pr`, rule `.claude/rules/ci.md`.

## Size and shape

- One task of a ticket per PR. `tools/check_pr_size.py` counts production lines (tests, fixtures, lockfiles, docs, CI config and the eval harness under `evals/` excluded): warning over 400, block over 800.
- No stacked PRs: the next task waits for the merge; independent tasks run in parallel worktrees on disjoint files. Repository setting "Automatically delete head branches" is on.
- Every PR opens as a **draft** and becomes ready only when the review chain, the acceptance run and both aggregate checks are green; "ready" means the owner's turn. Every commit on an open PR is pushed immediately.
- **Squash merge**: one commit per task on `main`, title = the PR title as a Conventional Commit, body lists the squashed commits. The review-order commits live in the PR. Linear history.

## Commits

Conventional Commits with a mandatory scope: types and scopes in `commitlint.config.mjs` (scopes = workspace names plus `ci`, `process`, `docs`, `platform`, `deps`, `release`). Enforced by `tools/check_commits.py` in the `commit-msg` hook (lefthook) and in CI over every commit of the PR and over the PR title. `wip:` only on task branches, never in a PR. Commits in review order: contract → red tests → logic → wiring → docs. Release notes come from the squash titles with git-cliff at the first release; no CHANGELOG file before.

## The PR body (`.github/pull_request_template.md`)

German review guide first: merge-danger block (risk, revertibility, blast radius, value, review depth), ticket and task, the judge's verdict line, optional link to a private visual guide (UI change or risk medium and above only), "Was und warum" with the smallest sketch that shows the core, "Hier genau hinschauen" (at most five places with the three questions: what changes in the domain, what would you build differently, what must you know later), skip list, decisions, deviations. Collapsed: "Belegt durch" from the frozen manifest, surviving mutants, how it was verified, agent balance, English details.

**References are quoted, never bare** (owner decision 2026-11-03, `CLAUDE.md` "Language"): wherever the body or a comment names an acceptance criterion, a gate-1 decision or addendum, a review finding (`B1`, `W7`, `L2`), an owner decision, an ADR or a rule, the sentence it refers to stands next to it, quoted or spelled out, with a link to the source where one exists. The owner reads the PR without opening the ticket, the addendum or the review.

The judge's verdicts are a **PR comment** per run (one quote, at most two images per case, plus a link to the Actions artifact with the raw Playwright video and trace, which the judge never reads); the body carries only the count line. A repeat run is a new comment.

## Gates

| Check | Where | Blocks |
|---|---|---|
| repository checks: hook tests, model sync, docs coverage, context budget, tool tests, limit watcher tests, commit messages, gitleaks | `ci.yml` | yes |
| stage 0 (tsc, ESLint, Prettier, dependency-cruiser), stages 1, 2a, 2b for affected workspaces | `ci.yml` | yes |
| red before green: the frozen tests a PR brings (changed manifest or listed file) fail on the base (`tools/check_red_before_green.sh`) | `ci.yml` | yes |
| Golden Set stage 1 (harness tests, mock run) | `ci.yml`, nightly | yes |
| SonarQube Cloud (Frankfurt) | `ci.yml` | advisory until 2026-11-16, then Quality Gate on new code without the coverage condition (activation coupled to the first service: owner decision pending, #122) |
| PR size, commits, PR title, eval report present (`tools/check_eval_report.py`) | `pr.yml` | yes |
| contract check, hadolint, Semgrep, image build + Trivy (fixable CRITICAL, secrets); no image build for a docs-only PR | `pr.yml` | yes |
| Fallow `audit --gate new-only` with PR comment | `pr.yml` | yes (new findings only) |
| Stryker incremental on changed packages; survivors listed in the PR | `pr.yml` from the first retro (nightly only until then, #122, v2 issue #4) | advisory until the first retro sets `break` per package |
| stages 3 and 4 against the stack (`lfc-ci-<run>`), at most one retry, a pass on retry opens a `flaky` issue; one E2E shard in increment 1; skipped for a docs-only PR | `pr.yml` via `stack-tests.yml` | yes |
| after the merge: images to GHCR, stages 3 and 4 against the pushed images | `main.yml` | `main passed` |
| nightly: Stryker changed packages (all on Sundays), E2E in one extra browser ×3, Lighthouse, Trivy full, Fallow, Knip, Golden mock, Deepgram probe; trend comment on the issue labelled `nightly`; a weekday night without a change to main since the last green nightly runs only the Trivy full scan | `nightly.yml` | report |

Required checks in the ruleset: `ci passed` and `pr passed`. Advisory results never fail an aggregate check; the set of advisory jobs is named in the aggregate step and changes only by owner decision.

Docs-only PR (ticket #68): `docsOnly` in `scripts/ci/affected.ts` decides (docs/, `.claude/` without hooks and the code of skills and workflows, Markdown outside what an image ships or a model reads); the jobs skip by job condition, never by `on.paths`, and both required checks still report green because a skipped job counts as green. A new push cancels the running runs of its PR. On main, `ci.yml` and the stack tests are never cancelled; `main.yml` keeps its running run, but GitHub drops a waiting one when a newer push queues behind it (that commit gets no `main passed`). `make ci-local` runs the required checks locally before a push; it does not replace CI.

Cloud and LLM tools: the repo's own reviewer roles (with the `fallow-review` skill as a deterministic pre-stage) plus SonarQube Cloud Free from day one. The owner accepted the Free terms (no DPA, training clause) as a known risk tracked by the security ticket; Greptile and CodeScene are not used.

## Supply chain

Actions are pinned by commit SHA, tool images (hadolint, Semgrep, Trivy) by digest; `.github/dependabot.yml` opens one grouped PR per week for actions and for `container.image` pins. `npm` is covered as well: one grouped weekly PR for the pnpm workspace, read from the root `pnpm-lock.yaml`; `pip` is not needed while `evals/` uses the Python standard library only. `main.yml` pushes every image with a SLSA provenance and an SPDX SBOM attestation; both live next to the image in GHCR as part of the pushed index (`docker buildx imagetools inspect ghcr.io/<repo>/<image>:<tag> --format '{{json .SBOM}}'`, likewise `.Provenance`). Dependabot alerts and security updates are repository settings the owner switches on (checklist below); Cosign signing and verification at deploy come with the operating model (#56).

## lefthook (pre-commit, under 30 s)

gitleaks on staged files, Prettier and ESLint on staged files, typecheck, unit tests of affected packages, dependency-cruiser, docs coverage, context budget, model sync, hook regression test; `commit-msg` runs the commit check. No pre-push hook: CI repeats everything because `--no-verify` can skip the hook.

## Gate 2: how the owner reads

Once a day in the owner hour (`docs/process/wayfinder.md`, "Daily owner hour": 45 minutes review and merge from 16:00, then 15 minutes Wayfinder); by then every PR meant for the day is green and up to date with `main`. In GitHub, commit by commit in review order, with the guide's "Hier genau hinschauen" as the map; no local staging. CODEOWNERS lists the paths the guide must name under "Hier genau hinschauen" (`packages/contracts`, `.github`, `.claude`, `deploy`, `scripts/ci`, `Makefile`, hook and lint configuration); it is not a required review (checklist below). Auto-merge at low risk, owner decision 2026-11-05 (the rule "after twenty PRs the retro decides with the metrics whether low blast radius may auto-merge" is fulfilled: 23 PRs merged by then), see below.

## Auto-merge at low risk

The main session merges a PR itself when all of this holds, otherwise the owner reads it at gate 2:

1. The guide says risk **niedrig**, derived as the template defines it ("Risiko niedrig = revertibel + örtlich"), and the reviewer did not raise it in the full review.
2. The review chain ended APPROVED after the fix round, the acceptance comment shows every real case "passt" and the canary caught (or the ticket has no acceptance features and the PR says so), `ci passed` and `pr passed` are green and the branch is up to date with `main`.
3. "Deine Entscheidungen" is empty, every reviewer finding in the collapsed section is handled, and no owner unlock of a frozen file is pending.
4. The diff touches no CODEOWNERS path (`packages/contracts`, `.github`, `.claude`, `deploy`, `scripts/ci`, `Makefile`, hook and lint configuration) and no file under `docs/adr`, `docs/spec` or `CLAUDE.md`; a Dependabot PR counts as low risk only for non-major bumps with green CI.
5. The merge is a squash with the checked title; the PR gets a comment "Auto-merge (Risiko niedrig, Regel pr-format.md)" with the quoted guide line, and the Abendpaket lists every auto-merged PR under "Gemergt ohne dich" with link and one line of content, so the owner can read it afterwards and revert it.

The owner can take a PR out of auto-merge with the label `owner-reads`; the retro reviews the auto-merged PRs with the metrics.

## Agent balance

`tools/agent_balance.py --issue <n>` renders the section from the workflow results and implementer reports the main session drops under `.claude/scratch/balance/<issue>/` (`test-design-r*.json`, `review-chain.json`, `acceptance.json`, `implementer-<task>.md`, optional `usage.json` with tokens and cost per role, optional `hand-<task>.json` with the owner's minutes and sessions for a hand task, rendered as a "Hand" line instead of tokens; `docs/process/lernpfad.md`). The owner ticks "berechtigt" per reviewer finding while reading; the retro sums loops, tokens, finding precision, judge quota and gate-1 returns. `tools/usage_from_logs.py` writes `usage.json` from the Claude Code session logs.

## Owner checklist (once, repository settings)

1. Rulesets on a private repo need GitHub Pro (the API answers 403 on Free; cost research #117). On Pro: ruleset on `main` with require a pull request (0 required approvals: the owner is the PR author because agents push under his account, and GitHub never lets an author approve his own PR), required checks `ci passed` and `pr passed`, linear history, block force pushes; squash merge only, default squash title = PR title. CODEOWNERS stays as the list of paths the review guide must name under "Hier genau hinschauen"; it is not a required review.
2. "Automatically delete head branches" on.
3. Secrets: `SONAR_TOKEN` (SonarQube Cloud project `marcominervinidev_live-factcheck_2`, organisation `marcominervinidev`, new-code definition "previous version"), later `DEEPGRAM_API_KEY` for the nightly probe.
4. SonarQube Cloud: create the project bound to the repo, disable "Automatic Analysis" (CI-based analysis is configured), after 2026-11-16 set the Quality Gate as required (reminder: v2 issue #3).
5. Create one issue labelled `nightly` for the trend comments.
6. `make hooks-install` on the host after the first platform ticket provides the toolbox shim.
7. Settings → Code security: Dependabot alerts and Dependabot security updates on (#126); version updates come from `.github/dependabot.yml`.

## Not a gate: the periodic architecture review

The plugin skill `improve-codebase-architecture` (mattpocock-skills) is an LLM judgement, not a check: it explores the codebase, writes an HTML report with deepening candidates and grills the owner over the chosen one. It runs in the main session before every increment milestone and at every retro, never in CI. In the sandbox the report is published as a private artifact instead of opened; the skill reads `GLOSSARY.md`, which here points at the planning repo's `CONTEXT.md`. Accepted candidates become tickets; rejected ones an ADR.

## Release

A release is a tag `v0.x` on `main` (`v0.1` with the first increment, a further minor per increment, a patch for a fix in between). `main passed` means: the squash commit is on `main`, its images are in GHCR and stages 3 and 4 passed against those pushed images; only such a commit is deployable, and the deployable image tag is `:sha` (the squash commit's SHA), never `:latest` or a branch tag. A deploy rolls out one `:sha`; a rollback rolls out the previous `:sha` again, without a rebuild and before any revert commit. Release notes come from the squash titles with git-cliff, set up with the first tag and not before; no CHANGELOG file until then. Where and how the images run (log sink, metrics stack, alerting) is the operating model's decision (#56).
