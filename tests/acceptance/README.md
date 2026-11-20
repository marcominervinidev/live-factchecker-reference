# Acceptance cases (owner's view)

## Purpose
The owner's-view cases of every ticket, judged from evidence by the acceptance judge before gate 2. Not a test stage; never runs in CI. Decision: `docs/spec/testteam.md` in the planning repo (section 6), ADR 0011 with the amendment of 2026-10-18; rules in `.claude/rules/tests.md`.

## Boundaries
This package reaches the stack only through the edge (browser or API driver); it never imports service code and never runs against the owner's stack. Regression tests adopted from a case go to the lowest stage, never here.

## Pitfalls
- Nothing from `reports/` enters the repo or the PR raw (traces hold the run's token).
- Never read a canary inside the judge's run; a judge that passes it is discarded.
- An expectation changes only when the owner changes it; cases are never retired.

## Commands
`LFC_STACK_TEST=1 make acceptance ISSUE=<n>` runs the cases on `lfc-<issue>-acc`; `.claude/workflows/acceptance.js` judges the report.
`owner/<issue>/*.feature` holds the cases only the owner can run (his own stack, his secrets directory; hooks `owner-stack`, `guard-secrets`): `make acceptance` never loads them, they have no step definitions, the owner runs each step by hand at gate 2 and his pasted terminal output is their evidence.

## Runner (increment 1, API driver)
- `make acceptance` starts `lfc-<issue>-acc` with throwaway secrets, exports the edge's root CA, runs `runner/run.ts` (script `acceptance`) in the one-off client `stack-client` (the caller's uid, never root; repository read-only except `reports/<issue>/`, network `clients`: the edge only) and removes the stack and its secrets afterwards, also on failure. Every phase has a time limit and prints its time (`acceptance: … after N s`): images 300 s, stack 180 s, cases 300 s; a stalled phase fails with exit 124. Exit 0 when the report was written and `errors` is empty; failed cases are the judge's to read. No model is called.
- Cucumber (`cucumber.json`) loads `steps/`, the stage-3 step library `../api/steps/` and `support/evidence.ts`, which attaches every exchange with the edge (path, status, `X-Lfc-Edge`, body) to its case; `runner/report.ts` turns the run's messages into the report shape below (`stdout`: every exchange, each followed by the TLS check of the connection that request step opened, read at its handshake from `tls.connect` whatever agent the library uses (reset before every step, so a step without a connection shows `TLS not observed`; a failed handshake shows `authorized=false error=<code>`; the global agent keeps no connection alive in this run, so every request does its own handshake): `TLS rejectUnauthorized=true ca=/run/lfc/edge-root.crt authorized=true issuer="…" servername=edge`; `network`: status 400 and above or no answer; `steps[].screenshot`, `screenshot`, `aria`: null; `console`: empty). `steps` lists what the driver did and saw, built from the attachments only: the owner's expectation, then per request the request step and the runner's observation (`Then the edge answered with status …`); a scenario's own assertions are not steps of the report, a failed one shows in `status` and `errors`.
- The canary becomes a capture-only scenario written to the temporary directory, never to `reports/`: the expectation verbatim and one request per path its `expected` names (the API driver cannot do more; a canary naming no path breaks the run). Every case, the canary included, has the same keys, the same step structure and the same `stdout` format (`runner/report.test.ts` checks it), and Cucumber runs all cases in random order, so neither position nor timestamps single it out; the runner never prints which case it is.
- Run errors (an undefined or ambiguous step, a parse error, no case) go to the top-level `errors`.

## Contract

- **Cases before code.** The test designer writes one Cucumber scenario per case under `features/<issue>/`, the owner's expectation verbatim as a docstring, negative cases included; the owner approves them at gate 1 and they join the frozen manifest. Cases are never retired; an expectation changes only when the owner changes it.
- **Driver.** Playwright through the edge once a client exists; the API driver (HTTP, WebSocket) until then. Steps live in `steps/`, page objects in `pages/`.
- **Canary.** One per ticket in `canaries/<issue>.json`: `{ "title", "expected", "whyWrong" }`. The runner merges it into the report as an ordinary case; the judge is never told which one it is.
- **Runner.** `make acceptance ISSUE=<n>` (code, no model): Compose project `lfc-<issue>-acc`, throwaway secrets and token, mock providers; the runner container runs as the caller's uid, never root, sees the repo read-only except `reports/`, sits on a network that reaches only the edge, and refuses to start without `LFC_STACK_TEST=1`. Output: `reports/<issue>/report.json` plus screenshots and aria snapshots, token redacted; `reports/` is git-ignored and nothing from it enters the repo or the PR raw.
- **Evidence from the browser (contract now, effective from the first client, increment 2).** Playwright records trace and video per case; the runner extracts from them one screenshot per step with its timestamp, the console errors and the failed network requests (URLs and bodies with the token redacted) into the case in `report.json`. The judge also judges sequence and timing from the step timestamps. Raw video and trace never reach the judge (it has only Read and cannot open `.webm` or `.zip`; traces hold the run's token): CI uploads them as a GitHub Actions artifact for the owner, and the PR comment with the verdicts links that artifact.
- **Judge.** `.claude/workflows/acceptance.js` runs `acceptance-judge` (tier spitze, never the implementer's model) on the report; verdicts per case `passt`, `passt nicht`, `unklar` with evidence and the lowest regression stage. A judge that passes the canary is discarded and repeated once.
- **Gates.** The main session posts the verdicts (one quote, at most two images per case) as a PR comment before gate 2; the owner reads diff and verdicts and merges. After the merge the ticket closes by code when every real case is `passt` and the canary was caught.
- **Adoption.** The judge proposes the lowest stage per case; the owner picks; the adopted regression test goes into the same PR at that stage, never here.

## Report shape (`reports/<issue>/report.json`)

```json
{
  "issue": 123, "startedAt": "2026-11-02T10:00:00Z", "commit": "abc1234", "stack": "lfc-123-acc",
  "errors": [],
  "cases": [
    { "title": "Card for a Claim by Speaker Ruvw appears within 15 s", "expected": "…verbatim…",
      "status": "passed", "errors": [], "stdout": "…",
      "steps": [
        { "title": "Given a Session with Speaker Ruvw", "at": "2026-11-02T10:00:01.120Z", "screenshot": "reports/123/card-merz/step-01.png" },
        { "title": "Then a Card appears", "at": "2026-11-02T10:00:13.480Z", "screenshot": "reports/123/card-merz/step-02.png" }
      ],
      "console": [ { "type": "error", "text": "…", "at": "2026-11-02T10:00:05.002Z" } ],
      "network": [ { "method": "GET", "url": "https://edge.local/api/…?token=[redacted]", "status": 500, "at": "2026-11-02T10:00:04.910Z" } ],
      "screenshot": "reports/123/card-merz.png", "aria": "reports/123/card-merz.aria.txt", "harness": null }
  ]
}
```

A non-empty top-level `errors` means the run broke; every case is then `unklar`.

`steps[].screenshot` is null with the API driver (increment 1); `console` lists console errors only, `network` only failed requests (status 400 and above, or no response). Timestamps are ISO 8601 with milliseconds from the trace's clock.
