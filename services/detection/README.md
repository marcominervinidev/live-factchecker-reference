# @lfc/detection

## Purpose
The detection service of increment 1. Wiring (ticket #25): it reads its configuration, holds one connection to Redis,
answers `/health` and `/ready` through `@lfc/service-kit` and stops cleanly on SIGTERM; it is the reference workspace
the skill `new-service` copies. Sessions (ticket #27, `src/session/`): it accepts final Segments that satisfy the
segment contract (`@lfc/contracts`) into a Session in the no-disk Redis. Turn building (ticket #28 task 1,
`src/turns/`): final Segments of a Session are built into Turns with end reasons and knowable end times, wired into
the Session by #29. Tick plan and Tick scheduler (ticket #28 task 2, `src/turns/tick-plan.ts`, `tick-scheduler.ts`): a
Turn gets a Tick every `tickSeconds` of speech plus its final analysis, one lane per extractor and Turn, and a
non-final Tick is skipped while that lane's call is in flight. Claim Extractor (ticket #29, `src/claim-extractor/`):
with a model adapter every Session runs it on its Ticks and writes each new Claim as a Claim event to its detection
stream in Redis. Topic Extractor (ticket #32, `src/topic-extractor/`): with a model adapter and
`TOPIC_EXTRACTOR_PROMPT_FILE` every Session also runs it on its Ticks, keeps its tag list from the Setting's Topic on
and writes each change as a Topic event to the same stream. The workspace name is not a domain term (`CONTEXT.md`).

Configuration (environment only, validated at startup; any error exits non-zero before the port opens):

| Variable | Meaning |
|---|---|
| `PORT` | port of `/health` and `/ready`, 1 to 65535 |
| `REDIS_URL` | `redis[s]://host[:port][/db]`; no credentials, no query, no fragment (main.ts connects with the parsed parts, so nothing in the URL overrides its options) |
| `REDIS_PASSWORD_FILE` | regular file (at most 4 KiB) holding the Redis password of the default user; one trailing newline is dropped |
| `SESSION_LIFETIME_SECONDS` | optional, whole seconds from 1, default 900 (ADR 0009: 15 minutes); every key of a Session expires this long after its creation or its last Segment; logged once at startup (`session.lifetime`, in `durationMs`) |
| `SESSION_BYTE_BUDGET` | optional, whole bytes from 1, default 3 MiB: the Segments of one Session add up to at most this much, counted in JSON bytes; in Redis they take up to about 1.3 times that (stream entry overhead, allocator rounding) |
| `MAX_SESSIONS` | optional, whole number from 1, default 20: at most this many Sessions live at once (20 x 3 MiB x 1.3 is about 78 MB, below the Redis cap of 96 MB) |
| `TICK_SECONDS` | optional, whole seconds from 1, default 5 (`docs/spec/erkennung-modellrollen.md` 8, like the three below): a Tick falls due each time a Turn's summed speech reaches the next multiple of `TICK_SECONDS` |
| `TURN_PAUSE_END_SECONDS` | optional, whole seconds from 1, default 3: a gap this long or longer between the end of the Turn so far and the next Segment of the same Speaker ends the Turn (`pause`) |
| `TURN_MAX_SECONDS` | optional, whole seconds from 1, default 180: a further Segment of the same Speaker that would make the Turn longer ends it (`max_length`); a Turn's first Segment always joins it, so a single Segment may be longer |
| `MODEL_ADAPTER` | optional: unset or empty runs the service without Claim Extractor, as before #29; `mock` the mock adapter of `@lfc/providers` (T7 adds `anthropic`); anything else is refused (gate 1 of #29, question 3) |
| `CLAIM_EXTRACTOR_PROMPT_FILE` | with an adapter: required, read at startup, its text is the instruction (never compiled in, AC17); the image holds `/app/prompts/claim_extractor.v2.de.txt` |
| `CLAIM_EXTRACTOR_MODEL`, `CLAIM_EXTRACTOR_THINKING` | default `claude-haiku-5-5` and `off` (`off` or `low`), passed through to the adapter (AC18) |
| `CLAIM_EXTRACTOR_MAX_TOKENS`, `CLAIM_EXTRACTOR_DEADLINE_SECONDS`, `CLAIM_EXTRACTOR_TOKENS_PER_WORD` | defaults 2048 (whole, from 1), 15 and 2.1 (above 0); the deadline bounds both attempts of a call |
| `CONTEXT_TURNS`, `CONTEXT_TOKEN_CAP`, `CLAIM_LIST_CAP`, `CACHE_BLOCK_BREAKPOINT`, `SCHEMA_RETRIES` | spec 8 start values 2, 600, 100, 20 (whole, from 1) and 1 (whole, from 0) |
| `MOCK_EXPECTATIONS_FILE`, `MOCK_LATENCY_SECONDS`, `MOCK_INVALID_CALLS` | with `mock`: a Golden Set `labels.jsonl` (required; a line that does not parse stops the start), the latency every call reports (from 0, default 0) and the adapter's call numbers that answer no JSON (comma-separated, from 1) |
| `TOPIC_EXTRACTOR_PROMPT_FILE` | with an adapter: optional; unset or empty runs the Sessions without Topic Extractor (gate 1 of #32, O2); set, it is read at startup like the Claim Extractor's; the image holds `/app/prompts/topic_extractor.de.txt` |
| `TOPIC_EXTRACTOR_MODEL`, `TOPIC_EXTRACTOR_THINKING`, `TOPIC_EXTRACTOR_MAX_TOKENS`, `TOPIC_EXTRACTOR_DEADLINE_SECONDS`, `TOPIC_WINDOW_SECONDS` | defaults `claude-haiku-5-5`, `off`, 1024 (whole, from 1), 15 (above 0) and 60 (spec 8 `topic_window_seconds`, whole seconds from 1); `SCHEMA_RETRIES` is shared |
| `MOCK_TOPIC_NEW_RATE`, `MOCK_TOPIC_LATENCY_SECONDS`, `MOCK_TOPIC_INVALID_CALLS` | with `mock` and a Topic Extractor: the share of calls that open a sub-topic (0 to 1, default 0.05 as the harness baseline), the latency every call reports (from 0, default 0) and the call numbers that answer no JSON |
| `INTERJECTION_MAX_SECONDS` | optional, whole seconds from 1, default 2: speech of another Speaker that starts before the end of the ongoing Turn (overlap from Segment start and end), lasts less than this and is followed by the first Speaker again within `TURN_PAUSE_END_SECONDS` of that end is an interjection, a Turn of its own; the ongoing Turn goes on (ticket #28 AC4) |

`DEBUG` and `NODE_DEBUG` must not be set: ioredis debug output would print the AUTH password.

Session routes (internal: the edge does not route them, AC13; no schema in `packages/contracts` until a Client or
Device Mode speaks to them). Accepted means 2xx, rejected 4xx; a rejection is `{ error, fields }` and names at most 10
fields, or says `Session unknown`:

| Route | Answer |
|---|---|
| `POST /sessions` | 201 `{ id, segments: 0, lastSegmentId: null, lastFinalizedAt: null, remainingSeconds }`; the id is a random UUID. 409 `no room for another Session` when `MAX_SESSIONS` live |
| `POST /sessions/{id}/segments` | body: one Segment, `content-type: application/json` (else 415). 204 accepted; 400 contract violated (the fields named) or body incomplete (the client went away; not logged); 413 body over 512 KiB, derived from the contract's bounds (refused before `JSON.parse`); 422 its `sessionId` is not `{id}`; 404 `Session unknown` (never created or expired, none is created); 409 its `id` is not after the last accepted `id`, or `Session full` (the Segment would pass `SESSION_BYTE_BUDGET`; the text names no number) |
| `GET /sessions/{id}` | 200 `{ id, segments, lastSegmentId, lastFinalizedAt, remainingSeconds }` (no words, no Speaker); 404 `Session unknown` |
| `POST /sessions/{id}/end` | the end of the Input (#29, gate 1 question 2): 204 once every call of the Session has returned; a second end answers 204 again and starts no call; 404 `Session unknown` |

`POST /sessions` takes an optional JSON body `{ setting?: { mode, speakers?: [{ name, role, public }], topic? },
speakerNames?: { <label>: <name> } }` (`src/session/session-start.ts`): `mode` `broadcast` or `conversation`, `role`
`moderator`, `host`, `guest` or `private`, names up to 200 and the Topic up to 1000 characters, at most 20 Speakers and
20 labels; an invalid body answers 400 `Setting invalid` with the fields, a body not sent as JSON 415. Without a body
the Session runs in mode „Gespräch“ without Speakers and Topic (gate 1 question 6). Setting and mapping stay in process
memory, never in a log line.

Segment ids compare as numbers after `s-` (`s-0412` equals `s-412`, `s-10000` comes after `s-9999`). In Redis a Session
is the hash `session:<id>:state` (that it exists, when it was created, the bytes of its Segments) and the stream
`session:<id>:segments` (one entry per accepted Segment: its id, its `finalizedAt`, the Segment as JSON); count and last
Segment are read from the stream. With the Claim Extractor a Session also has the stream `session:<id>:detection` (one
entry per detection event, field `event`, the envelope of `@lfc/contracts` as JSON) and the list
`session:<id>:candidates` (one Candidate record as JSON per entry); `createSessionRecords` writes them only while the
Session lives, with the remaining lifetime of its state hash (AC16). Key names carry the Session id only. Rule: every
key of a Session is registered in `sessionKeys` (`src/session/store.ts`) and nowhere else, so every script sets its
lifetime. The
one key outside a Session is the index `sessions:live` (Session ids with their expiry), which counts the live Sessions
for `MAX_SESSIONS` and expires with the latest of them. Creating a Session and accepting a Segment set the lifetime on
every key of the Session in one Lua script; the checks of a Segment (Session known, id after the last one, room left in
the byte budget) and its writes are that same atomic step, and a rejected Segment touches no key. The stream is not
trimmed: it stays whole until the lifetime after the last Segment runs out (owner decision 2026-10-29, addendum to
`docs/spec/datenschutz.md` section 2; T3 and T4 need a Session's complete stream). The lifetime runs on the server's
wall clock, also in replay. One log event per accepted Segment, written after the store took it: `segment.accepted`
with `sessionId` and `segmentId`; a failing Redis answers 503 and logs `session.request_failed` without the error text.
The port's server limits (10 s per request, 5 s for its headers, 256 sockets) come from `@lfc/service-kit`.

Turns (ticket #28, `src/turns/`): `createTurnBuilder(parameters)` turns final Segments in seam order into Turns
(`push(segment)`, `end()` at the end of the Input), each ended with `pause`, `max_length`, `speaker_change`,
`interjection` or `stream_end`. Membership and end reasons follow `evals/src/harness/turns.py` `build_turns`; a Turn's
end is known (`endKnownAt`) at the latest `finalizedAt` when the Segment that proves it arrives, or at the end of the
Input. A run of another Speaker that may still be an interjection is held back until it is decided; a run of more than
`maxHeldSegments` Segments (optional builder parameter, an integer of at least 1, default 200; owner decision 1
of 2026-11-03) is decided at once as no interjection, a named deviation from AC4 for hostile Input that bounds what
one `push()` returns. Pure: no I/O, no timers, no clock. Turns are derived in-process state, never stored: the Segment stream in Redis stays
their only owner. A builder could be rebuilt by replaying that stream, but no such rebuild exists yet (see Pitfalls:
Segments after a restart are stored, not analysed).

Ticks (ticket #28, `src/turns/`): `createTickPlan(parameters).next(event)` turns the Turn events into Ticks: one at
the `finalizedAt` of the Segment with which a Turn's summed speech reaches the next multiple of `tickSeconds`, never
before the latest time the Turn events have shown, and exactly one final analysis per Turn at its `endKnownAt` (port of
`tick_plan`). So the Tick of a held-back run falls due when the run is released, an interjection's with its final
analysis (owner decision F2 of 2026-11-03; the harness says the Segment's `finalizedAt`). `createTickScheduler({ sessionId,
extractors, logger })` sends each Tick to the Claim Extractor and the Topic Extractor (the `Extractor` port of T4 and
T6): per extractor and Turn one call at a time. It runs on Session audio time: a Tick at its finalizedAt, a return at
`at + latencySeconds` as the extractor reports it (measured live, scripted in tests). A non-final Tick during a call is
skipped, counted in `skippedTicks` and logged as `tick.skipped` (`sessionId`, `modelRole`, `turnId`), the next call
carries every Segment not yet sent; the final analysis waits for the call in flight, never skipped (port of `on_tick`,
`on_return` and the `sent` cursor of `evals/src/harness/pipeline.py`). The lane order needs no await; a Session awaits
`tick()` only in a replay run. The port resolves on every outcome; a rejection or an unusable latency is a lost Tick:
logged as `extractor.failed` (same three fields, never the error), the call counts as returned at its start, the next
call carries its Segments again. A rejection or throw is a programming error in an extractor: once every lane of the
Tick has settled, `tick()` rejects with the first original error in the order of `ExtractorName`, and the lanes stay
usable; the Session catches that rejection, never leaves it unhandled (owner decisions 3 and F6 of
2026-11-03). An unusable latency has no error and never makes `tick()` reject; `drain()` never rejects.

Session Turns (ticket #28 task 3, `src/session/session-turns.ts`): `createSessionTurns({ sessionId, parameters,
extractors, logger })` gives one Session its Turn builder, Tick plan and Tick scheduler, with `parameters` from
`loadConfig(env).turnParameters`. `accept(segment)` takes one finalized Segment in seam order, `end()` the end of the
Input; both hand every Tick to the scheduler and resolve once all have settled (`end()` also drains every call). A
Tick whose `tick()` rejects is caught and logged once as `tick.failed` with `sessionId` and `turnId`, never the error
(#29 AC22, gate 1 question 7: „Angenommen, mit Log-Ereignis `tick.failed`“), so later Segments and Ticks go on. `turns`,
`seen` (every Turn so far, open or ended, in its latest state), `ticks` and `skippedTicks` stay in process memory.
Wired by #29 task 3 (`src/session/session-pipelines.ts`): a Session created with a model adapter gets its Claim
Extractor and Turn building; the Segment route hands an accepted Segment over without awaiting it, so the answer to a
Segment never waits for an extractor (the seam order holds, because `accept()` pushes the Segment and hands its Ticks
to the scheduler synchronously); `POST /sessions/{id}/end` awaits `end()`. The Topic Extractor's lane answers at once
until T6. The state is dropped once the Session's lifetime passes without a Segment, as its Redis keys are. Stage 2a replays the recording fixture `golden: synt-2026-10-06-a 01:10-01:55` through
`sttRecordingInput` of `@lfc/inputs` (a dev dependency) into it (`features/turn-building.feature`).

Claim Extractor (ticket #29 task 2, `src/claim-extractor/`; pure, no I/O, wired by task 3):
- `prompt.ts`: `prefixBlock(instruction, setting)` (instruction trimmed, gate 1 question 14: „Getrimmt wie der
  Harness“; schema as `json.dumps(..., sort_keys=True)`; `renderSetting` in German words, `public` is the bool of
  `docs/spec/sprecher.md` 1), `attributionBlock(labels, names)`, `selectContext(turns, current, at, count)` (orders
  the Turns itself, by start and id) and `createClaimPrompt(...)`, the prompt state of one Turn: `next(call, claims)`
  appends one Turn block and returns the request's blocks with at most four cache breakpoints (prefix, context, last
  Turn block, latest earlier 20th); the delta Claims are every Claim not in the Claim list block, the ones the cap of
  100 displaced included (gate 1 question 9: „Harness-Regel: zusätzlich die vom Deckel verdrängten listen“).
- `output-schema.ts`: `ClaimExtractorOutput` (Zod, strict), `claimExtractorJsonSchema` (the harness's
  `claim_extractor_schema(False)`), `normTokens` (the harness's `norm_tokens`; its two character classes, Python's
  `isspace` for splitting and `isalnum` for filtering, were compared per code point: equal on every code point
  assigned in Unicode 15; lower-casing only on samples, review of 2026-11-05: 40,000 random strings and 15,081
  Golden Set texts without a difference) and `claimExtractorContract({ sentSegments,
  knownClaimIds })`: one violation per broken rule with an element path (`$.claims[<i>].<field>`) and reason
  `wortlaut`, `segment_ids`, `id_unbekannt` or `refersTo_fehlt`, so `callValidated` drops only that element (gate 1
  question 1). Wording and Segment ids fit together as `pipeline.py` checks them
  (`check_claim_contract_in_segments`, #48 question 13: „jede genannte Id muss Wörter des Wortlauts enthalten“): one
  occurrence of `verbatim` in the sent Segments covers exactly the named ones; a misfit is one `segment_ids`
  violation, checked only when wording and ids pass on their own, and named first. Candidates keep only the check that
  their ids were sent, as `check_candidate_contract`. Log only `path` and `reason` of a violation, never `message`: it repeats what the model wrote.
- `claims.ts`: `createSessionClaims()` numbers Claims `c-01`… and Candidates `k-01`…, counts a Claim with `repeatOf`
  as a repeat and one with the Turn's label and normalised sentence of an earlier Claim as a duplicate (no id, no
  event); a Claim whose event would break the Claim event contract (bounds of `speaker`, `sentence`, `verbatim`, time
  order) is the outcome `invalid` with the contract field names only: no id, no Claim list entry, no event (AC11:
  „the event validates against its contract schema“). `lastWordEnd` as the harness's `last_word_end`. `emittedAt` is
  the time the caller passes; the contract's rule „`emittedAt` nicht vor `lastWordEnd`“ holds while the Session clock
  is the audio time (gate 1 question 13).

Claim Extractor wiring (ticket #29 task 3, `src/claim-extractor/claim-extractor.ts`): `createClaimExtractor(...)`
implements T3's `Extractor` port for one Session. Per call it builds the request (role `claim_extractor`, model,
thinking and `maxTokens` of the configuration, schema `claim_extractor_output`, deadline now + `deadlineSeconds`),
calls `callValidated` with the contract check and the element lists `claims` and `candidates`, and returns the latency
`callValidated` reports; a call returns at `at` plus that latency (replay clock), which is the Claims' `emittedAt`.
A Turn's prompt state and the Segments sent in its blocks (one list for prompt, contract check and Claim times) are
kept until its final analysis returns; a call sees only Claims returned by its start on the Session clock (AC3, AC4).
Outcomes and log events (ids, reasons and outcomes only, AC15):
- every call: `claim_extractor.call` with `sessionId`, `modelRole`, `turnId`, `attempts`, `outcome`; a call whose outcome
  is not `valid` is lost: no Claim, no Candidate, `counters.schemaErrors` + 1 (AC10).
- a new Claim: the next id and one envelope `{ schemaVersion: 2, type: 'claim', sessionId, claim }` on the detection
  stream (AC11); a repeat: `claim.repeat` with the referenced `claimId` (AC12); a duplicate: `claim.duplicate` (AC13).
- a Candidate: the next `k-` id, the record to the Candidate port (until T5 the Session's Candidate list in Redis) and
  `candidate.created` with `candidateId` and `reason` (AC14).
- dropped, `counters.dropped` + 1 and `claim_extractor.dropped` with `turnId` and `reason`: an element with a contract
  violation (the first violation's reason, AC9), a Claim whose event would break the Claim event contract and a
  Candidate whose `speaker` exceeds 200 or `verbatim` or `note` 1000 code points, both before any id with the fixed
  reason `ungueltig` (owner decisions A7 and A8 of 2026-11-06). Contract field names stay out of the line.

Topic Extractor (ticket #32, `src/topic-extractor/`): `tag-list.ts` (pure) seeds the tag list from the Setting's
Topic, active, as its current Topic (AC1; the harness starts empty), merges a validated result (`new`, then
`returned`, then `ended`; an existing tag keeps its parent and status on `new`; unknown tags in `returned` and `ended`
are counted, AC7, AC8) and reports a change when a tag was added, a status changed or the current Topics differ as a
set (AC9). `prompt.ts` (pure) renders the blocks of the harness's `call_topic_extractor`: `prefix` (instruction
trimmed plus the schema `TOPIC`), `context` (the tag list, `aktiv`/`beendet`, `unter <parent>`), `window` (finalized
Segments ending within `TOPIC_WINDOW_SECONDS`) and `new`, each Segment with its Speaker name or label; breakpoints on
`prefix` and `context`. The validating schema adds the tag bounds of the Topic event (1 to 200 code points, O3), so an
unusable tag is repeated like any schema violation (AC10). `topic-extractor.ts` implements the `Extractor` port:
"new since the last analysis" is Session-wide (every finalized Segment not shown to a valid call and not carried by a
running one), a lost call leaves its Segments new; a changed result is one envelope
`{ schemaVersion: 2, type: 'topic', sessionId, topic }` with `tickAt` = the call's `at`. Every call logs
`topic_extractor.call` with `sessionId`, `modelRole`, `turnId`, `final`, `outcome`, `attempts`, `durationMs`, the
token fields summed over the attempts, `costUsd` and `unknownTags`; never a tag. `costUsd` is 0 until T7: the
adapter port carries no prices. `counters.schemaErrors` counts only calls lost with `schema_failure` (AC10); unlike
the Claim Extractor, whose counter takes every outcome other than `valid`, an adapter error, timeout or fatal outcome
shows only in the line's `outcome`. The mock (`createMockTopicExtractor`) deviates from the harness in one point: when
every tag of a non-empty list has ended it answers `[]` as current, not the Setting's `[topic]`, and a sub-topic it
opens then has parent `null`. The Session keeps its Segments for the Topic Extractor only while one is configured.

Known limits: the wording search is linear in the Turn's and the wording's words (Knuth-Morris-Pratt), one search
per Claim; it stops at the first occurrence that fits the named ids and keeps no text and no set entry per
occurrence. Measured 2026-11-06 (Node 24.22.1 in the toolbox, first run, one process per case, three runs, host load
9 to 14 on 8 cores) against one Turn of 110,000 equal words in 220 Segments: five Claims of 1,500 words with fitting
ids 3 ms, four Claims of 500 words 1 to 3 ms (peak RSS 106 to 108 MB, the Turn alone 107 to 108 MB), five Claims of
30 words under 1 ms, five Claims of 1,501 words not in the Turn 13 to 15 ms, five misfits of 500 words 34 to 49 ms,
50 Claims of 2 words fitting only the last occurrence 259 to 414 ms; five misfits of 700 words against 20,000 one-word
Segments 14 to 17 ms; 50 misfits of 2 words against 22,000 one-word Segments 64 to 100 ms, peak RSS about 12 MB above
the Segments alone. `lastWordEnd` splits the whole Turn into tokens twice per Claim (`owners` and `tokens` in
`claims.ts`): five calls against the Turn of 110,000 words took 549 ms in the review of 2026-11-06 (913 to 1,067 ms
under the load above); left as it is, open owner question A10.

Known limits of the wiring (#29 task 3):
- Replay clock: the ticket's assumption „the Session releases the next Segment only when every call due before it
  has returned“ holds for a replay through the Session routes only while the adapter answers at once in wall time (the
  mock). The Segment route does not wait for the calls (the live pattern), and the lanes of different Turns run side
  by side in wall time, so with T7's real adapter a fast replay through the routes can build Claim lists the harness
  would not build. T8 needs a replay pace for measurement runs (owner question, review M5).

Deviations from the harness (`evals/src/harness/`), one per line, with who set them:
- Turn block header, context Turn header and Block 1a name the Session label, not the reference transcript's name:
  frozen tests (`prompt.test.ts`: „a Turn's Speaker is its Session label“).
- Role words from a fixed table (`moderator` → Moderation, …) instead of the Setting's free text: frozen test.
- No line `Anfangs-Topic:` without a Topic: frozen test; no header `Sprecher:` without Speakers: my reading of AC2
  („without Speakers and without Topic“), owner question.
- A private Speaker who is no public figure reads „(private Person)“ once, the harness writes it twice: my choice,
  owner question.
- Block 1a always names the source „Referenz-Transkript“ and writes a label without a name as
  `- C -> nicht zugeordnet · keine Quelle · none`: my choice (ticket: „any other label stays a label with `none`“),
  owner question.
- `selectContext` compares `finalizedAt <= at` without the harness's tolerance of `1e-9`: my choice, the time of a
  Turn's first call is a `finalizedAt` itself, never a sum. The Claims a call sees are compared with the tolerance
  (`emittedAt <= at + TIME_TOLERANCE`, the harness's `cards_until`), because `emittedAt` is a sum (review M4).
- A Claim's `start`, `end` and the fallback of `lastWordEnd` come from the named Segments of the Turn only, not from
  every Segment of the excerpt: frozen test header (`accept` gets `turnSegments`).
- `emittedAt` is not rounded (the harness writes `round(t, 3)`): my choice, rounding could put it before
  `lastWordEnd` and break the contract.
- A repeat is `repeatOf !== null` (the harness tests truthiness): my choice; an empty `repeatOf` fails the contract
  check before as `id_unbekannt`.
- A Claim whose event breaks the Claim event contract gets no id (the harness has no such bound): AC11 and the
  contract's bounds of 2026-11-05.
- A wording said twice with its later Segment named passes the contract check as in the harness, but `lastWordEnd`
  takes the first occurrence (`last_word_end`), so the event breaks `lastWordEnd >= start` and the Claim is `invalid`;
  the harness emits a card with `last_word_end` before `start`. Open owner question: take the named occurrence?
- A misfit lists at most 20 covers in its message, more are counted („Vorkommen in 21 Segmentfolgen“); the harness
  lists all, which a hostile Turn of many one-word Segments grows without bound: my choice, owner question. The 20
  bound the number of covers listed, not the message: a cover lists as many ids as the wording has words, so a message
  reaches 20 x words x id length (reviews of 2026-11-06: 218,446 characters for 1,500 words, 570,085 with ids of 15
  digits); a bound in ids is open owner question A11.
- Two sent Segments with the same id make the port stricter than the harness, never laxer: it may reject a Claim the
  harness accepts, or name an id twice in a message (reviews of 2026-11-06: 160 and 17,142 such rejections, none the
  other way). The contract rules the input out (`packages/contracts/src/segment.ts:12`: „Unique per Session, ascending
  in order of finalization.“): consequence of the rank ranges, no code of its own.
- When `refersTo` or `repeatOf` holds the text „.segmentIds“ or „.verbatim“, the harness skips the misfit
  (`schemas.py`: `if any(".verbatim" in e or ".segmentIds" in e for e in errors)` reads the messages); the port
  reports the misfit too, so two violations instead of one; the Claim is dropped either way.
- A Turn without Segments is skipped by `selectContext` (the harness has no such Turn): my choice.
- `contextTokenCap` 0, a context count of 0, `claimListCap` 0 and `cacheBlockBreakpoint` 0 behave as in the harness
  (no cap, no context Turn, whole list, no intermediate breakpoint); whether 0 is a valid configuration is task 3's
  question.

## Boundaries
Single dependency: Redis. Its only model adapter is the mock of `@lfc/providers`, which reports no tokens; token and
cost records per call come with T7's real adapter (`createModelCallRecorder` of #26 is not used here). It imports
`packages/*` only, never another service (`.dependency-cruiser.cjs`). `src/main.ts` starts nothing on import;
`startDetection({ env, write?, exit?, signals? })` is the entry the tests use; `node src/main.ts` runs it locally by
type stripping. The container runs the bundle: `Dockerfile` (build stage: `pnpm run build`, esbuild bundles
`src/main.ts` with `@lfc/service-kit` and `@lfc/contracts` (Zod included) into `dist/main.mjs`; stage `runtime`:
distroless Node, uid 65532, that file and the prompts `claim_extractor.v2.de.txt` and `topic_extractor.de.txt` under
`/app/prompts/`; ADR 0011
addendum 2026-10-28). Stage `dev` (only `make dev` through
`compose.dev.yml`, never CI): node on the build stage's install runs `src/main.ts` with `--watch`, the sources of this
service, of `@lfc/service-kit` and of `@lfc/contracts` mounted read-only. In the stack it is reachable only through the edge:
`/detection/health` and `/detection/ready` (`deploy/edge/Caddyfile`), no host port; the edge does not route the
Session routes, so no client of the stack reaches them yet (stage 2a calls them in-process).

## Pitfalls

- Stop of the process: `close` first ends the Sessions' analysis (`createSessionPipelines().close()`: one abort signal for every model call, wait until the calls in flight have returned, no final analysis, timers dropped), then closes Redis. A failed request logs the class of its error as `reason`; a programming error answers 500, the store being away 503.
- A Segment the store accepts (204) is not analysed when the Session's Input has ended (`POST /sessions/{id}/end`) or
  when this process has no analysis for the Session (it was created before a restart of the service, or its lifetime
  passed): it is stored, but reaches no extractor, and today no log line shows it. There is no rebuild from the
  Segment stream yet. Open owner question (review M6): log it once per Session and cause, which needs a new event
  name.
- Only `result.data` of the segment contract is stored; never log a rejected body, Zod's issue messages or an unknown
  field name (each can carry transcript text). A rejection repeats only field names that are identifiers.
- Memory is bounded by the Redis cap (`maxmemory` 96 MB with `noeviction`, `compose.yml`), not by the Session
  limits: at the cap a write fails and the route answers 503. `noeviction` is decided: an LRU policy could evict one
  key of a Session and keep the others. `SESSION_BYTE_BUDGET` x `MAX_SESSIONS` must stay below the cap; stage 2a runs
  all its scenarios against one Redis, so with the default of 20 its Sessions of 15 minutes count against that limit.
- The Redis ACL in `compose.yml` denies `@admin` and `@dangerous` (so INFO; the ready check of ioredis is off) and
  allows `client|list`, which stage 2a reads.
- Stage 2a runs in-process in a one-off toolbox (compose service `toolbox-it`) on the internal `data` network of a
  throwaway project; Redis publishes no host port, not even in CI. `test:integration` needs `REDIS_URL` and
  `REDIS_PASSWORD_FILE`; `make test-integration` passes both.
- The image has no shell and no curl: the Compose healthcheck asks `/health` with `node -e`, and debugging happens
  through the logs (`docker compose logs detection`), never with `exec`.

## Commands
- `scripts/tb pnpm --filter @lfc/detection run test:unit` (stage 1)
- `WS=@lfc/detection COMPOSE_PROJECT_NAME=lfc-<issue>-<task> make test-integration` (stage 2a, Cucumber in
  `features/`: throwaway secrets and Redis, the tests, then `ci-stack-down`; CI runs the same target)
- `scripts/tb pnpm --filter @lfc/detection run test:mutation` (Stryker, nightly only)
- `docker build -f services/detection/Dockerfile --target runtime .` (the image; `make ci-stack-up` builds it when
  `LFC_REGISTRY` is `lfc`), hadolint and Trivy as in `pr.yml`
- `COMPOSE_PROJECT_NAME=lfc-<issue>-<task> make ci-secrets ci-stack-up test-api ci-stack-down` (stage 3 through the
  edge)
