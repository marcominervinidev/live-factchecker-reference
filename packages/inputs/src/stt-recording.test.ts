// Stage 1, issue #27 (T2), Task 2: the STT-recording Input (docs/spec/inputs.md 4.2 and 5, ADR 0005 with its addendum
// of 2026-10-25), AC16 and AC17. Port of the Python harness `read_mitschnitt` and `deepgram_segments`
// (evals/src/harness/mitschnitt.py, format mitschnitt-1 of ticket #73). Expected values were computed by that harness
// on the same inputs (commit ed5223a of evals/audiomodus); finalizedAt is compared to 0.001 s, the precision the
// harness rounds it to; start and end are word times and compared exactly.
//
// Public interface these tests define (built in Task 2):
//   src/stt-recording.ts
//     export class RecordingError extends Error {}
//     export async function sttRecordingInput(options: {
//       recording: string;   // the mitschnitt-1 file as text (JSON Lines)
//       sessionId: string;
//       language: string;
//     }): Promise<{ segments: AsyncIterable<Segment>; diagnosis: Diagnosis }>
//   The promise rejects with a RecordingError for a recording the harness refuses; then no Segment exists.
//   Diagnosis counters, named after the harness (camelCase): resultsFinal, resultsInterim, resultsFinalEmpty,
//   splitFinals, clampedFinals, utteranceEnd, speechStarted, metadata, errors, other, wordsWithoutSpeaker.
//
// Word order (AC3; Owner decision gate 1 2026-10-29: variant (a), sorting): a final block is split at Speaker changes in
// provider order like the harness, then the words of each Segment are sorted stably by start (13 word pairs in the
// Golden Set Deepgram recordings start before their predecessor).
//
// Fixtures (references, never copies):
//   golden: synt-2026-10-06-a 01:10-01:55   45 s of a real Deepgram recording (realtime factor 1.0): 12 final blocks,
//     6 of them split at a Speaker change mid-block; the block arriving at 80.828 s splits into four Segments
//     (B A B A), the one at 94.458 s too. Chosen because it holds the densest run of mid-block changes in the Golden
//     Set with only two Speakers, no word out of time order and no clamped final (no Golden Set recording has one).
//   evals/tests/fixtures/audio_golden/mini-audio-a   the harness's synthetic format fixture, mechanics only: the
//     rejection cases of AC17 and the variants for the pacing factor, clamping and an empty final, each one change.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { RecordingError, sttRecordingInput } from './stt-recording.ts';
import {
  collect,
  goldenWindow,
  harnessFormatRecording,
  recordingLines,
  recordingText,
} from './testing/golden.ts';
// After the modules under test on purpose: their absence is the red reason (tools/classify_red_reason.py).
import { Segment } from '@lfc/contracts';

const SESSION = '27a0c0de-0000-4000-8000-000000000016';
const WINDOW = 'golden: synt-2026-10-06-a 01:10-01:55';

type Row = readonly [
  id: string,
  speaker: string,
  start: number,
  end: number,
  words: number,
  finalizedAt: number,
];

// Harness deepgram_segments on WINDOW (provider labels dg-0 -> A, dg-1 -> B).
const WINDOW_SEGMENTS: readonly Row[] = [
  ['s-0001', 'A', 65.05, 68.490005, 10, 70.131],
  ['s-0002', 'B', 68.93, 71.57, 10, 73.705],
  ['s-0003', 'B', 71.82001, 77.31, 16, 80.828],
  ['s-0004', 'A', 77.31, 77.55, 1, 80.828],
  ['s-0005', 'B', 77.55, 77.79, 1, 80.828],
  ['s-0006', 'A', 77.79, 78.91, 4, 80.828],
  ['s-0007', 'A', 79.14, 82.58, 9, 84.213],
  ['s-0008', 'A', 82.75, 85.549995, 10, 87.71],
  ['s-0009', 'A', 85.69, 86.33, 3, 90.734],
  ['s-0010', 'B', 86.33, 88.490005, 7, 90.734],
  ['s-0011', 'A', 88.57, 89.21, 4, 90.734],
  ['s-0012', 'A', 89.31, 90.509995, 3, 94.458],
  ['s-0013', 'B', 90.67, 92.909996, 9, 94.458],
  ['s-0014', 'A', 92.909996, 93.39, 3, 94.458],
  ['s-0015', 'B', 93.39, 93.63, 1, 94.458],
  ['s-0016', 'B', 93.9, 97.659996, 13, 98.818],
  ['s-0017', 'B', 97.93, 101.85, 11, 103.013],
  ['s-0018', 'B', 102.19, 104.43, 6, 107.121],
  ['s-0019', 'A', 104.43, 104.99, 3, 107.121],
  ['s-0020', 'A', 105.05, 105.770004, 2, 110.172],
  ['s-0021', 'B', 105.770004, 108.25, 6, 110.172],
  ['s-0022', 'A', 108.25, 108.73, 3, 110.172],
  ['s-0023', 'A', 108.91, 110.990005, 12, 114.053],
  ['s-0024', 'B', 111.79, 113.23, 3, 114.053],
];

// Harness deepgram_segments on mini-audio-a as it is (realtime factor 1.0).
const MINI_SEGMENTS: readonly Row[] = [
  ['s-0001', 'A', 0.0, 4.0, 8, 4.6],
  ['s-0002', 'B', 4.5, 9.0, 11, 9.6],
  ['s-0003', 'B', 9.2, 10.8, 4, 13.5],
  ['s-0004', 'A', 11.0, 13.0, 4, 13.5],
  ['s-0005', 'C', 13.6, 20.0, 11, 20.7],
  ['s-0006', 'B', 20.6, 27.0, 11, 27.6],
];

type Line = Record<string, unknown>;

async function run(recording: string) {
  const input = await sttRecordingInput({ recording, sessionId: SESSION, language: 'de' });
  return { segments: await collect(input.segments), diagnosis: input.diagnosis };
}

function expectRows(segments: readonly Segment[], expected: readonly Row[]): void {
  expect(segments.map((s) => [s.id, s.speaker, s.start, s.end, s.words.length])).toEqual(
    expected.map(([id, speaker, start, end, words]) => [id, speaker, start, end, words]),
  );
  segments.forEach((s, i) => {
    expect(s.finalizedAt).toBeCloseTo(expected[i]?.[5] ?? Number.NaN, 3);
  });
}

/** finalizedAt of every Segment, each to 0.001 s (the harness rounds to three decimals). */
function expectFinalizedAt(segments: readonly Segment[], expected: readonly number[]): void {
  expect(segments).toHaveLength(expected.length);
  segments.forEach((s, i) => {
    expect(s.finalizedAt).toBeCloseTo(expected[i] ?? Number.NaN, 3);
  });
}

/** mini-audio-a with one change applied to its parsed lines. */
function mini(change: (lines: Line[]) => Line[] = (lines) => lines): string {
  return recordingText(change(recordingLines(harnessFormatRecording())));
}

function eventAt(lines: Line[], t: number): Line {
  const event = lines.find((line) => line['kind'] === 'event' && line['t'] === t);
  if (event === undefined) throw new Error(`mini-audio-a has no event at t=${t}`);
  return event;
}

describe('sttRecordingInput on the Golden Set window (AC16)', () => {
  it('emits the Segments, boundaries and finalizedAt of the Python harness', async () => {
    expectRows((await run(goldenWindow('recording', WINDOW))).segments, WINDOW_SEGMENTS);
  });

  it('splits a final block at every Speaker change by word times and gives its parts one finalizedAt', async () => {
    const { segments } = await run(goldenWindow('recording', WINDOW));
    const block = segments.filter((s) => Math.abs(s.finalizedAt - 80.828) < 0.0005);
    expect(block.map((s) => s.speaker)).toEqual(['B', 'A', 'B', 'A']);
    for (let i = 1; i < block.length; i += 1) expect(block[i]?.start).toBe(block[i - 1]?.end);
  });

  it('counts finals, interim results, split finals and other events like the harness', async () => {
    const { diagnosis } = await run(goldenWindow('recording', WINDOW));
    expect(diagnosis).toMatchObject({
      resultsFinal: 12,
      resultsInterim: 47,
      resultsFinalEmpty: 0,
      splitFinals: 6,
      clampedFinals: 0,
      speechStarted: 13,
      utteranceEnd: 0,
      metadata: 0,
      errors: 0,
      other: 0,
      wordsWithoutSpeaker: 0,
    });
  });

  it('sets the given sessionId and language and builds no Segment from an interim result', async () => {
    const recording = goldenWindow('recording', WINDOW);
    const { segments } = await run(recording);
    expect(segments.every((s) => s.sessionId === SESSION && s.language === 'de')).toBe(true);
    const finalWords = recordingLines(recording)
      .filter((l) => l['kind'] === 'event')
      .map((l) => l['msg'] as Line)
      .filter((m) => m['type'] === 'Results' && m['is_final'] === true)
      .reduce(
        (n, m) =>
          n +
          (((m['channel'] as Line)['alternatives'] as Line[])[0]?.['words'] as unknown[]).length,
        0,
      );
    expect(segments.reduce((n, s) => n + s.words.length, 0)).toBe(finalWords);
  });
});

describe('sttRecordingInput mechanics on the harness format fixture (AC16)', () => {
  it('emits the harness Segments of mini-audio-a, with the block at 13.5 s split B, A', async () => {
    const { segments, diagnosis } = await run(mini());
    expectRows(segments, MINI_SEGMENTS);
    expect(diagnosis).toMatchObject({
      resultsFinal: 5,
      resultsInterim: 5,
      splitFinals: 1,
      utteranceEnd: 5,
      speechStarted: 1,
      metadata: 1,
    });
  });

  it('multiplies the arrival time by the pacing factor (realtime factor 1.25)', async () => {
    const recording = mini((lines) => {
      ((lines[0] as Line)['pacing'] as Line)['realtime_factor'] = 1.25;
      return lines;
    });
    const { segments } = await run(recording);
    expectFinalizedAt(segments, [5.75, 12.0, 16.875, 16.875, 25.875, 34.5]);
  });

  it('raises finalizedAt to the end of the block when the final arrives earlier, and counts it', async () => {
    const recording = mini((lines) => {
      eventAt(lines, 13.5)['t'] = 12.0; // the block's last word ends at 13.0 s
      return lines;
    });
    const { segments, diagnosis } = await run(recording);
    expectFinalizedAt(segments, [4.6, 9.6, 13.0, 13.0, 20.7, 27.6]);
    expect(diagnosis.clampedFinals).toBe(1);
  });

  it('builds no Segment from a final result without words, and counts it', async () => {
    const recording = mini((lines) => {
      const empty = {
        type: 'Results',
        is_final: true,
        channel: { alternatives: [{ transcript: '', words: [] }] },
      };
      lines.splice(4, 0, { kind: 'event', t: 5.0, audio_sent_s: 5.1, msg: empty });
      return lines;
    });
    const { segments, diagnosis } = await run(recording);
    expectRows(segments, MINI_SEGMENTS);
    expect(diagnosis.resultsFinalEmpty).toBe(1);
  });
});

describe('sttRecordingInput with words out of time order (AC3, AC16; owner decision gate 1 2026-10-29, variant a)', () => {
  it('sorts the words of a Segment by start; start is the smallest start, end the end of the last sorted word', async () => {
    const word = (w: string, start: number, end: number) => ({
      word: w.toLowerCase(),
      punctuated_word: w,
      start,
      end,
      speaker: 0,
    });
    const recording = recordingFromBlocks(1.0, [
      { t: 3.0, words: [word('Mieten', 1.5, 2.0), word('die', 1.0, 1.3), word('ja.', 1.2, 1.4)] },
    ]);
    const { segments } = await run(recording);
    expect(segments).toHaveLength(1);
    const [only] = segments;
    expect(only?.words.map((w) => w.w)).toEqual(['die', 'ja.', 'Mieten']);
    expect(only?.start).toBe(1.0);
    expect(only?.end).toBe(2.0);
    expect(only?.finalizedAt).toBeCloseTo(3.0, 3);
    expect(Segment.safeParse(only).success).toBe(true);
  });
});

describe('sttRecordingInput rejects a broken recording and emits no Segment (AC17)', () => {
  it.each([
    { invalid: 'no header (line 1 is an event)', recording: () => mini((lines) => lines.slice(1)) },
    {
      invalid: 'a header in another format (mitschnitt-2)',
      recording: () =>
        mini((lines) => {
          (lines[0] as Line)['format'] = 'mitschnitt-2';
          return lines;
        }),
    },
    { invalid: 'no footer', recording: () => mini((lines) => lines.slice(0, -1)) },
    {
      invalid: 'a footer with complete false',
      recording: () =>
        mini((lines) => {
          Object.assign(lines.at(-1) as Line, { complete: false, error: 'closed early' });
          return lines;
        }),
    },
    {
      invalid: 'a line that is no JSON',
      recording: () => {
        const lines = mini().split('\n');
        lines.splice(3, 0, '{not json');
        return lines.join('\n');
      },
    },
    {
      invalid: 'an arrival time going backwards (4.6 s becomes 2.0 s after 2.3 s)',
      recording: () =>
        mini((lines) => {
          eventAt(lines, 4.6)['t'] = 2.0;
          return lines;
        }),
    },
  ])('rejects $invalid with a RecordingError', async ({ recording }) => {
    const emitted: Segment[] = [];
    const failure = await (async () => {
      const input = await sttRecordingInput({
        recording: recording(),
        sessionId: SESSION,
        language: 'de',
      });
      for await (const segment of input.segments) emitted.push(segment);
      return undefined;
    })().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RecordingError);
    expect(emitted).toEqual([]);
  });
});

// ---- properties ------------------------------------------------------------------------------------------------

interface Block {
  readonly t: number;
  readonly words: readonly {
    word: string;
    punctuated_word: string;
    start: number;
    end: number;
    speaker: number;
  }[];
}

/** A complete mitschnitt-1 recording holding one final Results event per block, nothing else. */
function recordingFromBlocks(factor: number, blocks: readonly Block[]): string {
  const header = {
    kind: 'header',
    format: 'mitschnitt-1',
    provider: 'deepgram',
    pacing: { realtime_factor: factor, chunk_ms: 100 },
  };
  const events = blocks.map((b) => ({
    kind: 'event',
    t: b.t,
    audio_sent_s: b.t,
    msg: {
      type: 'Results',
      is_final: true,
      channel: { alternatives: [{ transcript: '', words: b.words }] },
    },
  }));
  const footer = {
    kind: 'footer',
    complete: true,
    events: events.length,
    finals: events.length,
    error: null,
  };
  return recordingText([header, ...events, footer]);
}

/** A complete mitschnitt-1 recording of final blocks; times in ms so the harness rounding stays exact. */
const recordingArb = fc
  .record({
    factor: fc.constantFrom(1.0, 1.25),
    blocks: fc.array(
      fc.record({
        lead: fc.integer({ min: 0, max: 800 }),
        delay: fc.integer({ min: -400, max: 3000 }),
        words: fc.array(
          fc.record({
            speaker: fc.integer({ min: 0, max: 3 }),
            step: fc.integer({ min: 0, max: 600 }),
            duration: fc.integer({ min: 0, max: 500 }),
            // every third non-zero value moves the word's start before its predecessor's (owner decision gate 1 2026-10-29, variant a)
            back: fc.integer({ min: 0, max: 300 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
      }),
      { minLength: 1, maxLength: 10 },
    ),
  })
  .map(({ factor, blocks }) => {
    let at = 0;
    let arrival = 0;
    const built: Block[] = blocks.map(({ lead, delay, words }) => {
      at += lead;
      let previousStart = 0;
      const list = words.map(({ speaker, step, duration, back }, i) => {
        if (i > 0) at += step;
        const startMs =
          i > 0 && back > 0 && back % 3 === 0 ? Math.max(0, previousStart - back) : at;
        const w = {
          word: 'wort',
          punctuated_word: 'Wort',
          start: startMs / 1000,
          end: Math.max(startMs, at + duration) / 1000,
          speaker,
        };
        previousStart = startMs;
        at += duration;
        return w;
      });
      // arrival on the recording clock: a multiple of 4 ms, so t x 1.25 keeps three decimals
      arrival = Math.max(arrival, Math.ceil(Math.max(0, (at + delay) / factor) / 4) * 4);
      return { t: arrival / 1000, words: list };
    });
    return { factor, blocks: built, text: recordingFromBlocks(factor, built) };
  });

function speakerRuns(block: Block): number {
  return block.words.reduce(
    (n, w, i) => (i === 0 || w.speaker !== block.words[i - 1]?.speaker ? n + 1 : n),
    0,
  );
}

describe('sttRecordingInput properties (fast-check)', () => {
  it('splits every block into one Segment per Speaker run, each contract-valid with one Speaker', async () => {
    await fc.assert(
      fc.asyncProperty(recordingArb, async ({ blocks, text }) => {
        const { segments, diagnosis } = await run(text);
        expect(segments.length).toBe(blocks.reduce((n, b) => n + speakerRuns(b), 0));
        expect(diagnosis.splitFinals).toBe(blocks.filter((b) => speakerRuns(b) > 1).length);
        for (const s of segments) {
          expect(Segment.safeParse(s).success).toBe(true);
          expect(s.start).toBe(s.words[0]?.start);
          expect(s.end).toBe(s.words.at(-1)?.end);
        }
      }),
    );
  });

  it('orders ids by finalizedAt, never finalizes a Segment before its end and counts every raised arrival', async () => {
    await fc.assert(
      fc.asyncProperty(recordingArb, async ({ factor, blocks, text }) => {
        const { segments, diagnosis } = await run(text);
        segments.forEach((s, i) => {
          expect(s.id).toBe(`s-${String(i + 1).padStart(4, '0')}`);
          expect(s.finalizedAt).toBeGreaterThanOrEqual(s.end);
          if (i > 0)
            expect(s.finalizedAt).toBeGreaterThanOrEqual(segments[i - 1]?.finalizedAt ?? 0);
        });
        const raised = blocks.filter(
          (b) => b.t * factor + 1e-9 < Math.max(...b.words.map((w) => w.end)),
        ).length;
        expect(diagnosis.clampedFinals).toBe(raised);
      }),
    );
  });

  it('labels Speakers A, B, … in order of first appearance in the id order', async () => {
    await fc.assert(
      fc.asyncProperty(recordingArb, async ({ text }) => {
        const { segments } = await run(text);
        const seen: string[] = [];
        for (const s of segments) if (!seen.includes(s.speaker)) seen.push(s.speaker);
        expect(seen).toEqual(['A', 'B', 'C', 'D'].slice(0, seen.length));
      }),
    );
  });
});
