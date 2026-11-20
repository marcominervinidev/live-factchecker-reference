# Test strategy

Short form for readers in the repo. Decision: ticket "Testteam und Testpyramide" of the process map, `docs/spec/process/testteam.md` and ADR 0011 (amendment 2026-10-18) in the planning repo. Rules that bind agents: `.claude/rules/tests.md`. Roles: `.claude/agents/test-designer.md`, `critic.md`, `acceptance-judge.md`; method: `.claude/skills/test-design`.

Fixed before this strategy: TDD; whoever writes code does not write its tests; cases before code with the owner's approval at gate 1 (frozen manifest); the runner is code; the judge runs on a model that did not write the change, with a canary; there is never a healer.

## Six stages

| Stage | Question | Tool | Runs | Mocks | Gate |
|---|---|---|---|---|---|
| 0 static | does it build, does it obey the mechanical rules | tsc strict, ESLint, Prettier, dependency-cruiser, gitleaks (history), `test-hooks.sh`, `sync_agent_models.py --check`, `check_docs_coverage.py`, `check_context_budget.py` | every push | – | required |
| 1 unit | does the module compute correctly | Vitest, describe/it next to the module; fast-check for pure logic | every push, affected workspaces | everything but the module | required |
| 2a backend integration | do a service's modules work together | Cucumber in-process; containers only for infrastructure | every push, affected workspaces | providers (STT, LLM, web search) | required |
| 2b frontend integration | does the client behave against a mocked backend | Cucumber + Playwright against the preview server with the edge's CSP | every push touching `apps/web`; from increment 2 (no client in increment 1) | backend | required |
| 3 API | does the path run through the real stack | Cucumber over HTTP and WebSocket against the Compose stack `lfc-ci-<run>`; never imports service code | PR | providers | required |
| 4 end-to-end | does the user see the right thing | Cucumber + Playwright through the edge (Caddy, TLS); critical journeys only | PR: Chromium desktop and mobile, one shard (two from increment 2); from increment 2 (no client in increment 1) | providers | required |
| 5 nightly | what costs minutes or money | see below | 02:23 | – | report, trend |

Lowest stage that can show the behaviour; no duplicates across stages. Error and edge cases belong on 1 or 2a; stage 3 proves the path plus spot checks; stage 4 stays small.

**Pyramid** (owner, 2026-10-25): per ticket and overall about 80 % of the test cases on stage 1, 15 % on stages 2a–3, at most 5 % on stage 4; acceptance cases are not counted. The test designer plans to it and explains a deviation in the manifest (`pyramidNote`); the reviewer flags a gross unexplained one. `tools/check_test_pyramid.py` counts per ticket from the frozen manifest (stage from the path) and warns from 20 tests when stage 1 is below 60 % or stage 4 above 10 %; it is advisory, always exits 0 and is not wired into CI (the main session runs it for the review packet; `--all` gives the whole repository for the retro).

## Gates that follow from the tests

- **Red before green.** The test designer's file list carries a `redRun` per test file (command, exit code, sha256 of the output); the main session writes it into `.claude/frozen/<issue>.json`. A CI job (`tools/check_red_before_green.sh`) checks out the PR base, applies only the frozen files this PR brings (every manifest counts, changed or not; with a `tasks` block: the files of its task; absent files of other tasks are skipped and named) and expects red for the right reason: unit tests per workspace root (`vitest run --root <dir>`), frozen Python tests with `python3 -I -m unittest`. Green on the base means "unproven" and blocks, so does red for the wrong reason. On a base without `pnpm-lock.yaml` the manifest's `redRun` entry (non-zero exit code, reason) stands in for the TypeScript run. Rules in `.claude/frozen/README.md`.
- **Mutation.** StrykerJS from the first package: nightly for packages changed since the last green nightly run, all packages on Sundays. Report only until the first retro, which sets `break` per package to the measured score minus five points; with that decision the PR job returns (`--incremental` on changed files, surviving mutants in the diff listed in the PR), until then the PR has no Stryker job (#122). Risk acceptance for survivors is the owner's. Command runner (Vitest 5 incompatibility of the vitest runner, lesson from live-factcheck).
- **Flaky.** No retries locally, at most one retry in CI. New stage 3 and 4 scenarios are no longer run three times in the PR (owner, 2026-10-25). A test that fails and passes on its retry is flaky: `pr.yml` (job `flaky-issues`) opens an issue (labels `flaky`, `needs-triage`) for the root-cause analysis from the runner's list `tests/<stage>/reports/flaky.txt`, which `stack-tests.yml` uploads. `@quarantine` with an expiry (14 days) stays the owner's decision (`QUARANTINE_BY_OWNER=1`; hook `test-integrity` denies everything else). The nightly `--repeat-each=3` is the flake finder. A wait is never the fix.
- **Hooks.** `stop-tests` (unit tests of changed workspaces green, no frozen file in the diff before an agent finishes), `frozen-manifest`, `test-integrity`.

## Acceptance from the owner's view (before gate 2)

1. The test designer writes the acceptance cases in `tests/acceptance/` before the code (expectation verbatim, negative cases included) plus one sealed canary in `tests/acceptance/canaries/<issue>.json`. The critic checks them; the owner approves at gate 1; both join the manifest.
2. When the implementer reports DONE and the review chain is through, `make acceptance ISSUE=<n>` runs the cases as code on `lfc-<issue>-acc` (throwaway secrets, mock providers, contained runner) and writes `tests/acceptance/reports/<issue>/report.json` (git-ignored, token redacted). From the first client it extracts per case from the Playwright trace and video one screenshot per step with timestamp, console errors and failed requests into the report; video and trace stay an Actions artifact for the owner (`tests/acceptance/README.md`).
3. `.claude/workflows/acceptance.js` runs the judge (always tier spitze, fallback only to stark, never the implementer's model) on the report only; it also judges sequence and timing from the step timestamps. Verdict per case: `passt`, `passt nicht`, `unklar`, with evidence and the lowest regression stage. A judge that passes the canary is discarded and repeated once; twice means the owner reads the report without a verdict.
4. The main session posts the verdicts as a PR comment (one quote, at most two images per case). The owner reads diff and verdicts and merges (gate 2); a PR with risk "niedrig" merges by the main session under `docs/process/pr-format.md` ("Auto-merge at low risk").
5. After the merge the ticket closes by code when every real case is `passt` and the canary was caught; otherwise it stays open with the report as a comment.
6. Per case the judge proposes the lowest stage for a regression test; the owner picks; the adopted test goes into the same PR at that stage, never into `tests/acceptance`.

Real providers only when the owner starts the run himself.

## Golden Set regression (three stages)

| Stage | When | What | Cost | Gate |
|---|---|---|---|---|
| 1 | every PR, nightly | harness unit tests; mock run over all approved excerpts (turns, tick, dedup, attribution, report) | 0 | required |
| 2 | on demand | one real text-mode run per changed arm, report under `evals/reports/`, compared with the baseline | about 11 USD per arm | check "eval report missing" |
| 3 | before a release | full run, three repetitions, median, audio mode, judge from the other model family | by budget | absolute thresholds of ADR 0003 |

- Trigger for stage 2: a CI check detects changes to `evals/configs/prompts/**`, model fields and pipeline parameters (later: the product pipeline behind the adapters) and requires an eval report whose metadata names the PR head commit or an earlier commit at which the changed files already read as at head (run on the code commit, report committed after; survives squash and rebase). The owner starts the run with his keys; CI never does.
- Regression thresholds relative to the last accepted baseline (`evals/reports/baseline.json` points to the report): recall and precision at most 0.02 worse, attribution at most 0.01 worse, cost per minute at most 10 % higher, p95 at most 1 s longer. A breach blocks; the owner may overrule with a reason in the PR and accept a new baseline.
- Budget cap 200 USD per Anthropic billing month (anchor day 8) in `evals/budget.json` (month, cap, spend per run); the runner refuses a run that would exceed it. `budget_usd` per run stays (baseline 15 USD).
- Until the product pipeline exists, stage 1 runs against the Python harness; afterwards against the pipeline behind the same adapters.

## Nightly (stage 5)

Workflow `nightly` at 02:23; result as a comment on the running nightly issue with a trend (mutation score per package, flake rate, eval mechanics, scanner findings, the metrics of ADR 0011).

- Stryker for packages changed since the last green nightly; all packages on Sundays.
- End-to-end with `--repeat-each=3` in **one** additional browser in rotation (Monday WebKit iPhone, Tuesday Firefox, Wednesday Chromium desktop, then again); the PR covers Chromium desktop and mobile. From increment 2 (no client in increment 1).
- Lighthouse CI against the edge. From increment 2 (no client in increment 1).
- Trivy full image scan (HIGH and CRITICAL including unfixed, report only; the PR blocks on fixable CRITICAL).
- Golden Set mock run over all excerpts plus harness tests; Fallow audit and Knip (dead code, cycles, unused exports; set up in "Review-Werkzeuge einrichten"); Deepgram probe on the three latency excerpts with a budget cap (ADR 0005); from T7 on a probe of the model adapter against the Anthropic API with its own repository secret and a cap of 0.25 USD per night (owner, 2026-10-27).

## Mapping to CI workflows (built by the PR-format ticket)

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | push | static, affected workspaces, unit per workspace, 2a per service, 2b when `apps/web` changed (from increment 2), hooks and model sync checks, Golden Set stage 1, red-before-green for the frozen files a push brings (changed manifest or listed file) |
| `pr.yml` | pull_request | contract check, Dockerfile lint, Semgrep, image build + Trivy (fixable CRITICAL), stage 3 and 4 via the stack workflow (at most one retry, a pass on retry opens a flaky issue; one E2E shard, two from increment 2), eval-report-missing check, single required check `pr passed`; Stryker incremental with survivor list returns after the first retro |
| `nightly.yml` | cron 02:23 | the list above, trend comment |

Workflow files, required checks and PR sections: `docs/process/pr-format.md`, `.github/workflows/`.

## Team

| Role | File | Model tier | New with this strategy |
|---|---|---|---|
| test designer | `.claude/agents/test-designer.md` | stark | skill `test-design`, acceptance cases, canary, `redRun` |
| critic | `.claude/agents/critic.md` | spitze | specification mutants, canary check, negative-share warning |
| acceptance judge | `.claude/agents/acceptance-judge.md` | spitze | runs before gate 2; report path |
| reviewer | `.claude/agents/reviewer.md` | stark | checklist for implementer-added unit tests, pyramid deviation |
| runner, red-before-green, ticket close | make targets, CI, `acceptance.js` | code | – |

No new agent role; triage stays in the fog of the map; there is never a healer.

## Metrics added

Mutation score per package (nightly), red-before-green rate (manifests with complete `redRun`), flake rate per test and number of quarantines, canary rate of the judge (discarded runs), gate-1 acceptance rate of test designs without return, eval runs and spend per month.
