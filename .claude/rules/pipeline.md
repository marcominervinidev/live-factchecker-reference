---
paths:
  - "services/**"
  - "packages/pipeline/**"
  - "packages/providers/**"
  - "packages/inputs/**"
---

# Pipeline

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Keep the sections, fill them as the code arrives; an empty section is a reminder, not a licence to invent.

## Responsibility
From the segment seam to the card: turn building, tick, claim extractor and topic extractor, resolver, speaker mapper, prefetch, check, privacy boundary. Decided in ADR 0002, 0004, 0005, 0007, 0008, 0009 of the planning repo; specs in `docs/spec/` there.

## File map
- `services/detection/` (`@lfc/detection`, ticket #25): the **reference sub-project** the skill `new-service` copies: wiring (configuration, Redis as its single dependency, `/health` and `/ready`, SIGTERM drain), stage 2a in `features/`, the multi-stage `Dockerfile` (esbuild bundle on distroless Node, ADR 0011 addendum 2026-10-28) and its Compose block behind the edge (`deploy/edge/Caddyfile`).
- `services/detection/src/session/` (ticket #27): the store is the only owner of a Session's Redis keys (`sessionKeys`); the routes are internal, never routed by the edge; a Segment is validated at the segment contract (`@lfc/contracts`) before any write. `session-turns.ts` (ticket #28 task 3) holds a Session's Turn builder, Tick plan and Tick scheduler in process memory, derived from the Segment stream, never written to Redis; it catches a rejection of tick() and logs `tick.failed` with Session and Turn id (#29 AC22). `session-pipelines.ts` (#29 task 3) gives each Session created with a model adapter its Claim Extractor and Turn building and drops them once the lifetime passes without a Segment; the Segment route hands a Segment over without awaiting (only a replay run awaits `accept()`), `POST /sessions/{id}/end` awaits `end()`. `session-start.ts` checks the optional body of `POST /sessions` (Setting, label -> name mapping; process memory only, never logged). The store also writes the detection stream `session:<id>:detection` and the Candidate list `session:<id>:candidates` (`createSessionRecords`), only while the Session lives.
- `services/detection/src/turns/` (ticket #28): Turn building is pure (no I/O, timers or clock); `turn-builder.ts` mirrors `evals/src/harness/turns.py` `build_turns` in membership and end reasons, with end times knowable from the Segments (`finalizedAt`), not the harness's foresight; a held-back run of more than `maxHeldSegments` (default 200) is no interjection but a speaker change (owner decision 1 of 2026-11-03); Turns are derived in-process state, never stored (the Segment stream in Redis stays the only owner; no rebuild by replay exists yet, so after a restart a Session's Segments are stored but not analysed, service README Pitfalls). `tick-plan.ts` and `tick-scheduler.ts` port `tick_plan` and the skip rule of `evals/src/harness/pipeline.py`; the Tick of a held-back run falls due at its release, not at the Segment's finalizedAt (owner decision F2 of 2026-11-03); the scheduler runs on Session audio time: a Tick at its finalizedAt, a return at at + latencySeconds as the extractor reports it (measured live, scripted in tests); the lane order needs no await, a Session awaits tick() only in a replay run; extractor failures are logged as `extractor.failed`, and tick() rejects with the first original error of a rejecting or throwing extractor once every lane of the Tick has settled, so the Session catches it; drain() never rejects (owner decision 3 of 2026-11-03).
- `services/detection/src/claim-extractor/` (ticket #29): `prompt.ts`, `output-schema.ts` and `claims.ts` are pure, no I/O; `claim-extractor.ts` (task 3) implements the extractor port with I/O through injected ports only (model adapter, detection stream, Candidate port, logger); its state (a Session's Claim list, duplicate keys and counters, a Turn's prompt blocks) lives in process memory, derived, the detection stream owns the Claims. `prompt.ts` builds the append-only blocks (Claim list and context fixed at a Turn's first call, one Turn block per call; delta = every Claim not in the Claim list block, owner decision on gate 1 question 9 of 2026-11-03), `output-schema.ts` holds schema 4.1 without `discarded` (Zod and the harness's JSON Schema) and the per-element contract checks (wording tied to the named Segments as `check_claim_contract_in_segments`, #48 rule), `claims.ts` the Session's ids, repeats, duplicates and Candidates, and the outcome `invalid` (event would break the Claim event contract: no id, no Claim list entry); exact strings are the harness's (`prompt.py`, `schemas.py`, `util.py`, `pipeline.py`), deviations in the service README.
- `services/detection/src/topic-extractor/` (ticket #32): `tag-list.ts` and `prompt.ts` are pure; `topic-extractor.ts` implements the extractor port with the tag list in process memory, "new since the last analysis" Session-wide as the harness's `call_topic_extractor`, Topic events on the detection stream (envelope schemaVersion 2). It runs only with `TOPIC_EXTRACTOR_PROMPT_FILE` (gate 1 of #32, O2).
- `packages/inputs/` (`@lfc/inputs`, ticket #27): the replay Inputs (reference transcript, STT recording `mitschnitt-1` with the Deepgram segment adapter) on a simulated clock, ports of `evals/src/harness/turns.py` and `mitschnitt.py`; deviations from the harness in its README.
- `packages/providers/` (`@lfc/providers`, ticket #29): the model adapter port the four roles of increment 1 (Claim Extractor, Verifier, Resolver, Topic Extractor) call through (`src/model-adapter.ts`), `callValidated` (validation, element drops, one repeat, deadline) and the adapters, here the mocks of the Claim Extractor and the Topic Extractor in `src/mock/`; model id and thinking are passed in, never chosen here.
- `packages/service-kit/` (`@lfc/service-kit`): the JSON logging module and service kit every Node service starts through; its modules and rules are in `.claude/rules/platform.md` (file map, Logging and health).

## Pitfalls
- The pipeline never knows where segments come from (two seams, ADR 0005). No input-specific branches behind the seam.
- Prompts are append-only blocks for caching (ADR 0004); schema enforcement is the adapter's job; nothing is silently dropped, uncertain cases become candidates for the resolver.
- Only the masked claim sentence, search queries and topic keywords leave the backend (ADR 0009); never transcript, labels, session, account, time or setting. Private matters never become a claim.
- Providers only through adapters; model ids and endpoints from configuration, never hard-coded.
- Audio is never written to disk; session data lives in the no-disk Redis for 15 minutes.

## Configuration
Environment only, validated at startup; secrets as `<NAME>_FILE`; the consent dialog's provider list comes from configuration.

## Tests
Unit tests per module; integration through the segment seam with recorded STT events (replay with simulated clock); quality only through the eval harness.
