# @lfc/providers

## Purpose
The model calls of the four roles of increment 1 (Claim Extractor, Verifier, Resolver, Topic Extractor) go through
this package (`.claude/rules/pipeline.md`: "Providers only through adapters"): the model adapter port,
`callValidated` and the adapters. Built in #29 (T4) for the Claim Extractor; the Verifier, Resolver and Topic
Extractor (T4b, T5, T6) use the port and `callValidated` unchanged, T7 adds the Anthropic adapter. The Speaker
Mapper and the model call of a Prefetch (`CONTEXT.md`, "Model call") are not roles yet: they extend `ModelRole`
when they come.

- `src/model-adapter.ts`: the port (#29 AC18). `ModelRequest` carries role, Session id, model id, thinking (`off`
  or `low`), the ordered `ContentBlock`s with cache and system marks, the strict JSON Schema and its name, the
  maximum output tokens, a deadline in epoch milliseconds and an abort signal. `AdapterResult` is the raw text with
  usage (input, cache write, cache read, output, thinking), latency, model and adapter name, or an error of kind
  `fatal`, `retryable` or `timeout`.
- `src/call-validated.ts`: `callValidated(adapter, request, { schema, contract?, elementLists?, retries? })` runs
  one call, parses the JSON, validates it with the Zod schema and the optional contract check, and repeats an
  unusable answer once with one `retry` block appended (#29 AC9, AC10; reference
  `evals/src/harness/adapters/base.py` `call_validated`). Outcome: `valid` (with the dropped elements), or
  `schema_failure`, `adapter_error`, `timeout`, `fatal`.
- `src/mock/mock-claim-extractor.ts`: `createMockClaimExtractor({ expectations, latencySeconds, invalidCalls? })`
  and `parseExpectations(jsonl)`: the deterministic oracle of the harness mock without random rates (#29 AC19).
- `src/mock/mock-topic-extractor.ts`: `createMockTopicExtractor({ latencySeconds, newRate, seed?, invalidCalls? })`
  (#32): the harness mock `topic_extractor`; it reads the tag list from the block of kind `context` in the text form
  pinned in `services/detection/src/topic-extractor/topic-extractor.test.ts` and draws its rate from the seed and the
  request's blocks.

## Boundaries
Base layer: imports only `zod`, Node built-ins and `packages/*`, never `apps/`, `services/` or `tests/`
(`.dependency-cruiser.cjs`, `packages-only-packages`). No configuration of its own: model id, thinking, deadline
and `retries` come from the calling service's configuration and are passed through, never hard-coded. Source runs
through Node's type stripping; there is no build step.

## Pitfalls
- A repeat only for an answer unusable as a whole: no JSON, a schema violation (an unknown field such as
  `discarded` included), a contract violation outside `elementLists`, or a `retryable` or `timeout` adapter error. A
  contract violation of one element of a listed list (path `$.<list>[<i>]…`) drops only that element, never
  repeated, also when every element is dropped (ADR 0004, addendum 2026-10-26: „Ein Verstoß verwirft nur die
  betroffene Behauptung oder den betroffenen Candidate“). A violation naming an index the list does not have
  belongs to no single element and is repeated (AC9: „a contract violation that belongs to no single Claim or
  Candidate“); the harness's `split_elements` ignores it, a deviation T9 names. A `fatal` error is never repeated.
- The deadline bounds both attempts together: the attempt running at the deadline is aborted through its signal and
  the call reports `timeout` with the time from its start to the deadline as latency (gate 1 of #29, question 11:
  „15 s bis zur Frist, wie im Harness“). `latencySeconds` otherwise is the sum the adapter reported per attempt,
  the time the simulated clock of a replay advances by; a sum above the time to the deadline is a `timeout` as well
  (AC10: „the 15 s deadline for both attempts together passes, the call is lost“), so a replay loses the call on
  its simulated clock as the harness does (`pipeline.py`: `timed_out = outcome.latency > timeout`).
- `callValidated` never rejects for an answer or an adapter error; an adapter that throws is a programming error and
  its rejection passes through. No attempt starts once the deadline has passed (`timeout`, no adapter call) or the
  caller has aborted (`fatal` before the first attempt, else the kind of the last attempt): an aborted call is never
  repeated and never billed.
- The `retry` block and the violations hold the model's answer and Transcript text: never log them. Log ids, kinds
  and counts only (`docs/spec/datenschutz.md` 2).
- The mock reads only the request's blocks in the text form of the Claim Extractor prompt (pinned in
  `services/detection/src/claim-extractor/prompt.test.ts`); a change of that form changes the mock too. It answers
  an expectation at most once per Session, maps `repeatOf` and `refersTo` by sentence to the listed Claim ids, turns
  an unmapped `refersTo` into a Candidate `bezug_unklar`, and reports no tokens. An invalid call leaves its state
  as it was. Expectations due in the same call are answered in the order given; `parseExpectations` orders a labels
  file by `start` as the harness mock does (`sorted(labels, key=lambda l: l["start"])`), so the Claim ids match it.

## Commands
- `scripts/tb pnpm --filter @lfc/providers run test:unit` (stage 1)
- `scripts/tb pnpm --filter @lfc/providers run typecheck`
