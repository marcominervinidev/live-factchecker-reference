# @lfc/inputs

## Purpose
The replay Inputs of the segment seam (ADR 0005; `docs/spec/inputs.md` 1, 4 and 5; ticket #27): each turns a
recorded source into contract-valid Segments (`@lfc/contracts`, `Segment`) for one Session and hands them out on a
simulated clock, with the semantics of the Python harness under `evals/src/harness/`.

- `src/reference-transcript.ts`: `referenceTranscriptInput({ transcript, sessionId, language })`, a port of
  `build_segments` (`turns.py`, defaults of `config.py`): cut each Turn at sentence-end punctuation (`.` `?` `!` `…`),
  at a pause of at least 1.0 s and before a Segment would span more than 10 s; ids in time order (start, then end);
  `finalizedAt` is `end`. Returns `speakers` (label → name from the transcript) beside the Segments, never inside
  them (`CONTEXT.md` Attribution, text mode of the measurement only). `TranscriptError` for a malformed transcript.
- `src/stt-recording.ts`: `sttRecordingInput({ recording, sessionId, language })`, a port of `read_mitschnitt` and
  `deepgram_segments` (`mitschnitt.py`, format `mitschnitt-1` of ticket #73): Segments only from final results with
  words, a final block split at every Speaker change, `finalizedAt` = arrival time × `realtime_factor`, raised to
  the end of the block's last word when the final arrives earlier (counted in `clampedFinals`), ids in order of
  finalization. Returns `diagnosis` (the harness's counters in camelCase). `RecordingError` for a recording the
  harness refuses (no header, other format, no footer, `complete` false, a line that is no JSON, arrival times going
  backwards); the promise rejects and no Segment exists.
- `src/replay.ts`: the simulated clock: one Segment per pull, in the order the Input gave, no timer, no wall clock.
- `src/segments.ts`: what both share: stable word sort by start, labels `A`, `B`, … `AA` by first appearance, ids
  `s-0001` upwards, the parse with the segment contract.
- `src/testing/golden.ts`: test helper (frozen, #27) that cuts Golden Set windows through
  `tests/fixtures/golden-window.mjs` in a child process; production code never imports it.

## Boundaries
Base layer: imports only `@lfc/contracts` and Node built-ins (`.dependency-cruiser.cjs`, `packages-only-packages`);
never `tests/` (the Golden Set window script runs as a child process for that reason). No I/O and no configuration:
a caller reads the file and passes its content. Source is run directly by Node's type stripping; no build step.
The Deepgram segment adapter lives here until the live STT connection arrives, then it moves to `packages/providers`.

## Pitfalls
- Decided deviations from the harness, which T8 and T9 report: the words of each Segment are sorted stably by start
  before `start`, `end` and the id order are taken (gate 1, 2026-10-29, variant (a)); the reference transcript's
  `overlap` mark never reaches a Segment (ADR 0005 addendum 2026-10-25).
- `finalizedAt` is rounded to 0.001 s like the harness and then never set below the end of the block's last word, so
  a clamped final stays contract-valid (the harness can round it below the word end).
- Decided deviation from AC18 ("in order of `finalizedAt`"), which T8 and T9 report: the replay hands out Segments in
  id order (owner decision 2026-11-05, review W1 variant (a): „Im Textmodus gilt die id-Reihenfolge, die Parität mit
  dem Harness bleibt“). For the STT-recording Input id order is `finalizedAt` order. For the reference transcript it
  is the harness's `(start, end)` order, and `finalizedAt` = `end` goes backwards where Turns overlap: in
  `synt-2026-10-06-a`, `s-0094` ends at 213.195 s and the next Segment `s-0095` at 212.635 s. A clock derived from
  `finalizedAt` is monotone only in audio mode.
- Never put a word, a line or a parser message into an error: a `JSON.parse` message quotes the line, which can
  hold transcript text. Errors name line numbers, Segment ids and contract fields only.
- Words are copied as `{ w, start, end }`; provider fields (confidence, speaker) never reach a Segment.

## Commands
- `scripts/tb pnpm --filter @lfc/inputs run test:unit` (stage 1; needs `evals/golden/` and
  `evals/tests/fixtures/audio_golden/`)
- `scripts/tb pnpm --filter @lfc/inputs run typecheck`
- `scripts/tb pnpm --filter @lfc/inputs run test:mutation` (Stryker, nightly only)
