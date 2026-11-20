# @lfc/contracts

## Purpose
The schemas every seam speaks (`.claude/rules/contracts.md`). Zod is the only source; JSON Schema is generated from
it for readers without Zod, above all the Python harness under `evals/` (ADR 0012).

| Schema | File | schemaVersion | Decision | Artefact |
|---|---|---|---|---|
| `Segment` | `src/segment.ts` | 1 | ADR 0005 (addenda 2026-10-25, 2026-10-27, 2026-10-29), `docs/spec/inputs.md` 4.1, 4.2 | `json-schema/segment.schema.json` |
| `ClaimEvent` | `src/claim-event.ts` | 1 | ADR 0005, addendum 2026-11-05 (field list, rules, bounds) and addendum 2026-10-25 („Claim- und Topic-Ereignisse der Erkennung gehen je Session in einen Redis-Stream … ihr Schema liegt in `packages/contracts`“), #29 decision 1 (Marco 2026-10-27, „alles ja“) and gate 1 question 8 (2026-11-03, „Angenommen“). Rule „`emittedAt` nicht vor `lastWordEnd`“: holds while the Session clock is the audio time (replay); live with a wall clock (T7) it may break (gate 1 of #29, question 13, 2026-11-03). Bounds: `speaker` at most 200, `sentence` and `verbatim` at most 1000 characters (Marco 2026-11-05, „genauso wie empfohlen“; Golden Set version 1 reaches 41, 232 and 332) | `json-schema/claim-event.schema.json` |
| `DetectionEvent` | `src/detection-event.ts` | 2 | ADR 0005, addenda 2026-10-25, 2026-11-05 and 2026-11-18; #29 decision 1: envelope `{ schemaVersion, type: "claim", sessionId, claim }`; #32 decision 1: `{ schemaVersion, type: "topic", sessionId, topic }`. Versioning (Marco 2026-11-05, „genauso wie empfohlen“; gate 1 of #32, O1, 2026-11-18): with `topic` the envelope is at schemaVersion 2 (every member, `claim` included; the writer writes the current version) and the Claim event stays at 1 | `json-schema/detection-event.schema.json` |
| `TopicEvent` | `src/topic-event.ts` | 1 | ADR 0005, addenda 2026-10-25 and 2026-11-18; #32 decision 1 (Marco 2026-10-27, „alles ja“): `{ schemaVersion, tickAt, current, new: { tag, parent }[], returned, ended }`, lists „as applied“, no `sessionId` (the envelope names the Session). Bounds (gate 1 of #32, O3, 2026-11-18): every tag 1 to 200 characters in code points, no list bound | `json-schema/topic-event.schema.json` |

- `src/common.ts`: building blocks (`AudioSeconds`, `Word`, `unknownFieldsNamed`).
- `src/testing/fixtures.ts` (export `@lfc/contracts/testing`): one valid example per schema for tests; production
  code never imports it.
- `scripts/generate-json-schema.ts`: `generateJsonSchemas()` and the script that writes `json-schema/`: one
  `<kebab-name>.schema.json` per Zod schema exported from `src/index.ts`; the export is the only registration.

## Boundaries
Base layer: imports only `zod` and Node built-ins, never `apps/`, `services/` or `tests/`
(`.dependency-cruiser.cjs`, `packages-only-packages`). No runtime configuration, no I/O in `src/`. Source is run
directly by Node's type stripping; there is no build step.

## Pitfalls
- A change to a schema or to `src/common.ts` is a contract change: owner's word, ADR, higher `schemaVersion`,
  contract tests, its own commit touching nothing outside this package (skill `new-contract`,
  `scripts/check-contract-change.sh`). The version is read from the text `schemaVersion: z.literal(N)`; keep it.
- Every object is strict and carries `.check(unknownFieldsNamed)`: Zod reports unknown fields in one issue with an
  empty path, the check adds one issue per field with the field as its path.
- `speaker` secures only the form of a label (`^[A-Z]+$`). That no name arrives is the job of the label
  assignment in the Inputs (A, B, ... by first appearance), not of the contract.
- Never combine contracts with `z.intersection` or `.and`: each strict side rejects the other side's fields.
- Python readers of `json-schema/`: match `pattern` with `re.fullmatch`, load with `json.loads(...,
  parse_constant=...)` that refuses `NaN` and `Infinity`, and exclude `bool` where `const` is a number
  (`True == 1` in Python).
- The JSON Schema artefact carries types, patterns, bounds and closed objects; rules across fields (`start` and
  `end` from the words, word order, `finalizedAt >= end`; in the Claim event `start <= end`,
  `start <= lastWordEnd <= end`, `emittedAt >= lastWordEnd`, `refersTo` set for `widerspruch` and `zustimmung`)
  exist only in Zod. A reader of the artefact must not take it for the whole contract.
- The Claim event never carries `repeatOf` (a repeat gets no event, #29 AC12) nor a `sessionId` (the envelope names
  the Session).
- One place for the rules the detection stream shares with the segment contract: `speakerLabel`, `segmentIds` and
  the envelope's `sessionId` take `Segment.shape.speaker`, `.id` and `.sessionId` from `src/segment.ts`, never a
  copy. A change of one of them in `Segment` changes `ClaimEvent` and `DetectionEvent` too: bump all three, although
  the contract check asks only for the bump of `Segment` (their files stay unchanged). They stay in `segment.ts`
  rather than `common.ts`, because moving them would change `segment.ts` and force `Segment` to schemaVersion 2.
- Never edit `json-schema/` by hand and keep nothing else there; after a schema change run `generate:json-schema`
  and commit the artefact with the schema (`src/json-schema.test.ts` fails while it is stale). Prettier skips it.

## For consumers
- Limit the body size before parsing; after `safeParse` use only `result.data`, never the input, and never
  `reportInput`.
- Never log issue messages or unknown field names (they can carry transcript text); cap the fields an error answer names.

## Commands
- `scripts/tb pnpm --filter @lfc/contracts run test:unit` (stage 1)
- `scripts/tb pnpm --filter @lfc/contracts run typecheck`
- `scripts/tb pnpm --filter @lfc/contracts run generate:json-schema` (writes `json-schema/`)
- `scripts/tb pnpm --filter @lfc/contracts run test:mutation` (Stryker, nightly only)
- `scripts/check-contract-change.sh origin/main` (the contract check of `pr.yml`)
