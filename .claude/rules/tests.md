---
paths:
  - "tests/**"
  - "**/*.test.ts"
  - "**/*.feature"
  - "**/steps/**"
  - "**/step-definitions/**"
  - "**/stryker.config.*"
  - "**/vitest.config.*"
---

# Tests

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Strategy and stage table: `docs/process/test-strategy.md` (decision: planning repo, `docs/spec/testteam.md`, ADR 0011).

## Responsibility
Tests define done. The test designer writes them before the code; after gate 1 they are frozen (`.claude/frozen/<issue>.json`). The implementer makes them green and may add new unit test files for internals, never edit existing tests. Whoever writes code does not write its tests. There is never a healer.

## Stages and where a case goes
Pick the **lowest** stage that can show the behaviour; before adding a case, check that no lower stage covers it.

| Stage | Question | Tool | Where |
|---|---|---|---|
| 0 static | does it build, does it obey the mechanical rules | tsc, ESLint, Prettier, dependency-cruiser, gitleaks | CI, every push |
| 1 unit | does the module compute correctly | Vitest `describe`/`it` next to the module; fast-check for pure logic | every push |
| 2a backend integration | do a service's modules work together | Cucumber in-process, containers only for infrastructure | every push |
| 2b frontend integration | does the client behave against a mocked backend | Cucumber + Playwright against the preview server **with the edge's CSP** | every push touching `apps/web` |
| 3 API | does the path run through the real stack | Cucumber over HTTP and WebSocket against the Compose stack; never imports service code | PR |
| 4 end-to-end | does the user see the right thing | Cucumber + Playwright through the edge (Caddy, TLS); critical journeys only | PR (Chromium desktop and mobile); nightly one more browser in rotation |
| 5 nightly | what costs minutes or money | Stryker (changed packages; all on Sundays), E2E `--repeat-each=3`, Lighthouse, Trivy full, Golden Set mock run, Fallow, Knip, Deepgram probe | 02:23 |

Acceptance cases (`tests/acceptance/`) are **not** a stage and never run in CI; see below.

**Pyramid** (owner, 2026-10-25): per ticket and overall about 80 % of the test cases on stage 1, 15 % on stages 2a–3, at most 5 % on stage 4; acceptance cases are not counted. The test designer plans to it and explains a deviation in the manifest (`pyramidNote`); `tools/check_test_pyramid.py` warns (advisory, from 20 tests: stage 1 below 60 % or stage 4 above 10 %).

## File map
`services/<name>/features/` (2a, next to the service it tests: `*.feature`, `steps/`, script `test:integration`; owner 2026-10-27, because `tests/` must not import service code; `WS=@lfc/<name> make test-integration` runs it in-process in a one-off toolbox against a throwaway Redis, locally and in CI), `apps/web/tests/` (2b), `tests/api/` (3: `features/`, `steps/`; `make test-api` through the edge only, from the one-off client `stack-client`), `tests/e2e/` (4: `features/`, `steps/`, `pages/`), `tests/acceptance/` (owner's-view cases, `canaries/`, `runner/` and `support/` of `make acceptance`, git-ignored `reports/`), `tests/fixtures/` (cut script, licence notes; Golden Set references, no copies). Unit tests live next to their module as `*.test.ts`.

## Gherkin
- English keywords; glossary terms untranslated (Segment, Turn, Claim, Speaker, Setting); German strings only where the user sees them.
- One feature per group of acceptance criteria; every scenario carries `@issue-<n>` and `@ac-<k>`. The tags are the traceability; there is no hand-written table.
- `Scenario Outline` with separate `Examples` blocks for valid classes, boundaries and invalid classes; each invalid class exactly once and as the only invalid input.
- Negative cases assert the rejection **and** the missing side effect ("and no card is created").
- Steps assert behaviour, never mock calls.

## Step libraries and fixtures
- One step library per stage: `services/<name>/features/steps/` for 2a, `tests/<stage>/steps/` for 3 and 4; domain steps in glossary language ("a Turn by Speaker Ruvw containing …"); no UI steps in 2a, no steps that know internals in 4. Extend the library, never copy it: inventory the existing steps first (`cucumber-js --dry-run --format usage`), reuse their exact wording, generalise with parameters instead of adding variants, and add a step only for a real gap (procedure in `.claude/agents/test-designer.md`, "Step reuse"). Page objects by `data-testid` or role only.
- Audio fixtures are references to a Golden Set excerpt with a time window (`golden: synt-2026-10-06-a 00:12-00:41`); `tests/fixtures/` holds the deterministic cut script and licence notes, not copies. Speech in fixtures is a real human voice; the synthetic TTS set (ADR 0003) checks mechanics only and stays under `evals/`. A fixture never contradicts the Golden Set labels.

## Unit tests
`*.test.ts` next to the module; one `describe` per public function or behaviour; `it` is an English behaviour sentence ("drops a duplicate claim within 60 s"); no snapshot tests; fake timers whenever time is involved; own ids and key prefixes per test; no network, no real keys. Property-based tests with fast-check for pure logic (turn building, dedup, tick plan, name mask, contract validation).

## Pitfalls
- Behaviour, not mocks: mocks only at system boundaries (STT, LLM, web search, the backend in frontend tests). A test that asserts a mock call without an outcome tests nothing.
- No tautologies, no reading of source files, no pinning of internals; tests go through the public interface. Expectations come from the acceptance criterion, the contract or the glossary, never from the code.
- Every expectation has a source; when the source is missing, write an open question, never an invented value.
- Reproduce a bug with a test on the lowest stage that shows it before fixing it.
- Never skip, quarantine, loosen or `only` a test to get green; report it. `skip`, `only`, `fixme`, `todo` and `@quarantine` are set only by the owner (`QUARANTINE_BY_OWNER=1`); the hook `test-integrity` denies everything else. A quarantined test carries an issue and an expiry date (14 days).
- Red before green: a frozen test must fail on the PR base for the right reason: missing behaviour, or a missing module under test (relative import or `@lfc/` alias); a missing package (vitest, fast-check), a syntax error or a type error while loading the file is the wrong reason (`tools/classify_red_reason.py`). The manifest holds the `redRun` per file; CI re-checks it.
- Flaky: no retries locally, at most one retry in CI; new stage 3 and 4 scenarios are not repeated in the PR. A test that fails and passes on its retry is flaky: CI opens an issue (labels `flaky`, `needs-triage`) for the root-cause analysis; `@quarantine` stays the owner's decision. The nightly `--repeat-each=3` is the flake finder. A wait is never the fix.
- Mutation: Stryker runs nightly until the first retro sets `break` per package; then incrementally on changed files in the PR with surviving mutants in the diff; thresholds are measured by the retro, never wished.

## Acceptance cases (owner's view)
Written by the test designer before the code, one Cucumber scenario per case with the expectation verbatim as a docstring, negative cases included; approved at gate 1, part of the manifest; never retired. One sealed canary per ticket in `tests/acceptance/canaries/<issue>.json`. `make acceptance ISSUE=<n>` runs them as code on the throwaway stack `lfc-<issue>-acc` and writes `tests/acceptance/reports/<issue>/report.json` (git-ignored, token redacted). The judge reads only that report; its verdicts go into the PR before gate 2; the ticket closes by code after the merge when every real case is `passt` and the canary was caught (`.claude/workflows/acceptance.js`). An adopted regression test goes into the same PR at the lowest stage, never into `tests/acceptance`.

## Configuration
Test stacks run as `lfc-<issue>-<task>` (CI: `lfc-ci-<run>`, acceptance: `lfc-<issue>-acc`) with throwaway secrets; never the owner's stack. Stryker: command runner, `coverageAnalysis: off`, `timeoutMS: 60000`, thresholds in the package's `stryker.config.mjs`.

## Tests
This file is about them; the hooks have their own regression test (`.claude/hooks/test-hooks.sh`).
