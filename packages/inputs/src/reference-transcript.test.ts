// Stage 1, issue #27 (T2), Task 2: the reference-transcript Input (docs/spec/inputs.md 1 and 4, messaufbau 2.3),
// AC14 and AC15. Parity with the Python harness `build_segments` (evals/src/harness/turns.py, defaults of config.py:
// sentence-end punctuation on, gap 1.0 s, maximum 10 s). Expected values were computed by that harness on the same
// windows, cut by tests/fixtures/golden-window.mjs (harness commit ed5223a of evals/audiomodus).
//
// Public interface these tests define (built in Task 2):
//   src/reference-transcript.ts
//     export async function referenceTranscriptInput(options: {
//       transcript: unknown;   // parsed transcript.json: a list of Turns { speaker, start, end, overlap?, words }
//       sessionId: string;
//       language: string;      // a parameter of the Input (inputs 4.1 "Sprache als Parameter")
//     }): Promise<{ segments: AsyncIterable<Segment>; speakers: Readonly<Record<string, string>> }>
//   speakers: label -> Speaker name from the reference transcript (CONTEXT.md Attribution, text mode only).
// "First appearance" is the order of the Segment ids (the harness sorts by start, then end).
// Word order (AC3; Owner decision gate 1 2026-10-29: variant (a), sorting): a Turn whose words do not start in time order
// (15 word pairs in the Golden Set reference transcripts) is cut like the harness, then the words of each Segment
// are sorted stably by start; start is the first, end the last sorted word.
//
// Fixtures (references, never copies):
//   golden: synt-2026-10-06-a 01:10-01:55   parity window, the same one the STT-recording test uses
//   golden: synt-2026-10-06-b 03:40-04:10   the only Haqy window with Turns marked overlap (224.5 s and 238.7 s)
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { referenceTranscriptInput } from './reference-transcript.ts';
import { collect, goldenWindow } from './testing/golden.ts';
// After the modules under test on purpose: their absence is the red reason (tools/classify_red_reason.py).
import { Segment } from '@lfc/contracts';

const SESSION = '27a0c0de-0000-4000-8000-000000000014';
const PARITY = 'golden: synt-2026-10-06-a 01:10-01:55';
const OVERLAP = 'golden: synt-2026-10-06-b 03:40-04:10';

type Row = readonly [id: string, speaker: string, start: number, end: number, words: number];

// Harness build_segments on PARITY, Speaker names replaced by labels in order of first appearance.
const PARITY_SEGMENTS: readonly Row[] = [
  ['s-0001', 'A', 70.08, 70.72, 2],
  ['s-0002', 'A', 70.72, 71.04, 1],
  ['s-0003', 'A', 71.04, 74.115, 9],
  ['s-0004', 'A', 73.955, 75.715, 6],
  ['s-0005', 'A', 75.715, 77.315, 5],
  ['s-0006', 'B', 77.315, 81.315, 13],
  ['s-0007', 'B', 81.875, 86.72, 15],
  ['s-0008', 'A', 86.72, 88.16, 4],
  ['s-0009', 'A', 88.16, 88.4, 1],
  ['s-0010', 'B', 88.56, 89.36, 4],
  ['s-0011', 'B', 89.36, 90.56, 3],
  ['s-0012', 'A', 90.64, 92.72, 8],
  ['s-0013', 'B', 92.72, 93.84, 4],
  ['s-0014', 'A', 93.84, 97.6, 13],
  ['s-0015', 'A', 97.905, 98.065, 1],
  ['s-0016', 'A', 98.065, 100.625, 6],
  ['s-0017', 'A', 100.625, 102.225, 5],
  ['s-0018', 'A', 102.305, 103.105, 3],
  ['s-0019', 'A', 103.105, 103.905, 2],
  ['s-0020', 'B', 103.905, 106.225, 11],
  ['s-0021', 'A', 105.665, 107.905, 6],
  ['s-0022', 'B', 108.065, 108.945, 3],
  ['s-0023', 'B', 109.025, 110.945, 11],
  ['s-0024', 'A', 111.345, 112.385, 2],
  ['s-0025', 'A', 112.385, 112.705, 1],
  ['s-0026', 'A', 112.705, 114.26, 4],
  ['s-0027', 'B', 114.02, 115.3, 5],
];

// Harness build_segments on OVERLAP; s-0003 and s-0008 come from Turns marked overlap.
const OVERLAP_SEGMENTS: readonly Row[] = [
  ['s-0001', 'A', 220.135, 221.735, 5],
  ['s-0002', 'B', 221.735, 224.375, 7],
  ['s-0003', 'A', 224.455, 227.095, 11],
  ['s-0004', 'B', 227.095, 228.535, 6],
  ['s-0005', 'B', 228.535, 237.14, 27],
  ['s-0006', 'B', 237.14, 238.66, 5],
  ['s-0007', 'A', 238.58, 242.82, 15],
  ['s-0008', 'A', 238.66, 239.38, 4],
  ['s-0009', 'A', 242.74, 243.46, 3],
  ['s-0010', 'B', 243.46, 243.54, 1],
  ['s-0011', 'A', 243.585, 244.545, 4],
  ['s-0012', 'B', 244.545, 245.825, 6],
  ['s-0013', 'B', 245.825, 247.345, 9],
  ['s-0014', 'A', 247.025, 248.545, 6],
  ['s-0015', 'A', 248.545, 248.865, 1],
  ['s-0016', 'A', 248.865, 249.185, 1],
  ['s-0017', 'A', 249.185, 250.225, 5],
];

interface Word {
  readonly w: string;
  readonly start: number;
  readonly end: number;
}
interface Turn {
  readonly speaker: string;
  readonly start: number;
  readonly end: number;
  readonly overlap?: boolean;
  readonly words: readonly Word[];
}

function transcript(reference: string): unknown {
  return JSON.parse(goldenWindow('transcript', reference));
}

async function run(source: unknown, sessionId = SESSION, language = 'de') {
  const input = await referenceTranscriptInput({ transcript: source, sessionId, language });
  return { segments: await collect(input.segments), speakers: input.speakers };
}

function rows(segments: readonly Segment[]): Row[] {
  return segments.map((s) => [s.id, s.speaker, s.start, s.end, s.words.length] as const);
}

function oneTurn(
  words: readonly (readonly [string, number, number])[],
  speaker = 'Kallac Haqy',
): Turn[] {
  const list = words.map(([w, start, end]) => ({ w, start, end }));
  return [{ speaker, start: list[0]?.start ?? 0, end: list.at(-1)?.end ?? 0, words: list }];
}

async function cuts(words: readonly (readonly [string, number, number])[]): Promise<number[]> {
  return (await run(oneTurn(words))).segments.map((s) => s.words.length);
}

describe('referenceTranscriptInput on the parity window (AC14)', () => {
  it('cuts the same Segment boundaries as the Python harness', async () => {
    expect(rows((await run(transcript(PARITY))).segments)).toEqual(PARITY_SEGMENTS);
  });

  it('sets finalizedAt to end, the given sessionId and language, and schemaVersion 1 on every Segment', async () => {
    const { segments } = await run(transcript(PARITY), SESSION, 'de');
    for (const s of segments) {
      expect(s.finalizedAt).toBe(s.end);
      expect(s.sessionId).toBe(SESSION);
      expect(s.language).toBe('de');
      expect(s.schemaVersion).toBe(1);
    }
  });

  it('keeps the words of the reference transcript, in order and unchanged', async () => {
    const turns = transcript(PARITY) as Turn[];
    const { segments } = await run(turns);
    const fromSegments = segments
      .flatMap((s) => s.words.map((w) => `${w.w}@${w.start}-${w.end}`))
      .sort();
    const fromTurns = turns.flatMap((t) => t.words.map((w) => `${w.w}@${w.start}-${w.end}`)).sort();
    expect(fromSegments).toEqual(fromTurns);
  });
});

describe('referenceTranscriptInput cutting rules at their boundaries (AC14)', () => {
  it.each([
    { mark: '.', cut: true },
    { mark: '?', cut: true },
    { mark: '!', cut: true },
    { mark: '…', cut: true },
    { mark: ',', cut: false },
    { mark: ':', cut: false },
    { mark: ';', cut: false },
  ])('cuts after a word ending in "$mark": $cut', async ({ mark, cut }) => {
    expect(
      await cuts([
        [`Mieten${mark}`, 0, 0.5],
        ['steigen', 0.5, 1.0],
      ]),
    ).toEqual(cut ? [1, 1] : [2]);
  });

  it.each([
    { gap: '1.000 s (boundary, cuts)', next: 1.5, expected: [1, 1] },
    { gap: '0.999 s (keeps)', next: 1.499, expected: [2] },
  ])('cuts at a pause of $gap', async ({ next, expected }) => {
    expect(
      await cuts([
        ['die', 0, 0.5],
        ['Mieten', next, 2.0],
      ]),
    ).toEqual(expected);
  });

  const nineSeconds = Array.from({ length: 9 }, (_, i) => [`w${i}`, i, i + 1] as const);
  it.each([
    { span: '10.000 s (boundary, keeps)', end: 10.0, expected: [10] },
    { span: '10.001 s (cuts before the word)', end: 10.001, expected: [9, 1] },
  ])('cuts at a Segment span of $span', async ({ end, expected }) => {
    expect(await cuts([...nineSeconds, ['w9', 9, end]])).toEqual(expected);
  });

  it('keeps a single word longer than 10 s as its own Segment', async () => {
    expect(
      await cuts([
        ['lang', 0, 12],
        ['kurz', 12, 12.5],
      ]),
    ).toEqual([1, 1]);
  });

  it('numbers Segments in time order across Turns, not in Turn order', async () => {
    const turns: Turn[] = [
      { speaker: 'Hukgl Suubayy', start: 5, end: 6, words: [{ w: 'später', start: 5, end: 6 }] },
      { speaker: 'Kallac Haqy', start: 1, end: 2, words: [{ w: 'früher', start: 1, end: 2 }] },
    ];
    const { segments } = await run(turns);
    expect(segments.map((s) => [s.id, s.words[0]?.w])).toEqual([
      ['s-0001', 'früher'],
      ['s-0002', 'später'],
    ]);
  });
});

describe('referenceTranscriptInput with words out of time order (AC3, AC14; owner decision gate 1 2026-10-29, variant a)', () => {
  it('sorts the words of a Segment by start; start is the smallest start, end the end of the last sorted word', async () => {
    const { segments } = await run(
      oneTurn([
        ['Mieten', 1.5, 2.0],
        ['Die', 1.0, 1.3],
        ['ja.', 1.2, 1.4],
      ]),
    );
    expect(segments).toHaveLength(1);
    const [only] = segments;
    expect(only?.words.map((w) => w.w)).toEqual(['Die', 'ja.', 'Mieten']);
    expect(only?.start).toBe(1.0);
    expect(only?.end).toBe(2.0);
    expect(Segment.safeParse(only).success).toBe(true);
  });
});

describe('referenceTranscriptInput labels and the name mapping (AC15)', () => {
  it('labels Speakers A, B in order of first appearance and returns the names beside the Segments', async () => {
    const { segments, speakers } = await run(transcript(PARITY));
    expect(speakers).toEqual({ A: 'Hukgl Suubayy', B: 'Kallac Haqy' });
    expect(new Set(segments.map((s) => s.speaker))).toEqual(new Set(['A', 'B']));
  });

  it('labels by appearance in this window, not by a fixed list of names', async () => {
    expect((await run(transcript(OVERLAP))).speakers).toEqual({
      A: 'Kallac Haqy',
      B: 'Hukgl Suubayy',
    });
  });

  it('puts no Speaker name into any Segment', async () => {
    // AC15: the mapping travels beside the Segments, never inside them. A spoken word is no mapping: in this window
    // Hukgl Suubayy says "Herr Haqy," (94.16 s), and the words stay unchanged (AC14, "keeps the words of the
    // reference transcript, in order and unchanged"). So only the spoken text `w` is blanked; every other field of
    // the Segment and every other key of each word is still searched for a name.
    const { segments, speakers } = await run(transcript(PARITY));
    const text = JSON.stringify(
      segments.map((s) => ({ ...s, words: s.words.map((word) => ({ ...word, w: '' })) })),
    );
    for (const name of ['Hukgl Suubayy', 'Kallac Haqy', ...Object.values(speakers)]) {
      for (const part of name.split(' ')) expect(text).not.toContain(part);
    }
  });

  it('cuts the overlap window like the harness and carries no overlap mark into the Segments', async () => {
    const { segments } = await run(transcript(OVERLAP));
    expect(rows(segments)).toEqual(OVERLAP_SEGMENTS);
    for (const s of segments) expect(Object.keys(s)).not.toContain('overlap');
  });

  it('labels the 27th Speaker AA', async () => {
    const turns: Turn[] = Array.from({ length: 27 }, (_, i) => ({
      speaker: `Gast ${i}`,
      start: i * 2,
      end: i * 2 + 1,
      words: [{ w: `Wort${i}.`, start: i * 2, end: i * 2 + 1 }],
    }));
    const { segments, speakers } = await run(turns);
    expect(segments.at(-1)?.speaker).toBe('AA');
    expect(speakers['AA']).toBe('Gast 26');
    expect(speakers['Z']).toBe('Gast 25');
  });
});

// ---- properties ------------------------------------------------------------------------------------------------

const NAMES = ['Kallac Haqy', 'Hukgl Suubayy', 'Anna Müller'] as const;
const SENTENCE_END = ['.', '?', '!', '…'];

const turnsArb = fc
  .array(
    fc.record({
      speaker: fc.constantFrom(...NAMES),
      pause: fc.integer({ min: 0, max: 4000 }),
      words: fc.array(
        fc.record({
          stem: fc.constantFrom('Mieten', 'steigen', 'seit', 'Jahren', 'nicht'),
          mark: fc.constantFrom('', '', '', ',', '.', '?'),
          gap: fc.oneof(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 900, max: 1500 })),
          duration: fc.integer({ min: 0, max: 900 }),
        }),
        { minLength: 1, maxLength: 40 },
      ),
    }),
    { minLength: 1, maxLength: 8 },
  )
  .map((raw) => {
    let at = 0;
    return raw.map(({ speaker, pause, words }) => {
      at += pause;
      const list = words.map(({ stem, mark, gap, duration }, i) => {
        if (i > 0) at += gap;
        const word = { w: stem + mark, start: at / 1000, end: (at + duration) / 1000 };
        at += duration;
        return word;
      });
      return { speaker, start: list[0]?.start ?? 0, end: list.at(-1)?.end ?? 0, words: list };
    });
  });

describe('referenceTranscriptInput properties (fast-check)', () => {
  it('emits contract-valid Segments with one Speaker each, ids s-0001 upwards in time order', async () => {
    await fc.assert(
      fc.asyncProperty(turnsArb, async (turns) => {
        const { segments, speakers } = await run(turns);
        segments.forEach((s, i) => {
          expect(Segment.safeParse(s).success).toBe(true);
          expect(s.id).toBe(`s-${String(i + 1).padStart(4, '0')}`);
          expect(Object.keys(speakers)).toContain(s.speaker);
        });
        for (let i = 1; i < segments.length; i += 1) {
          const [a, b] = [segments[i - 1], segments[i]];
          if (a === undefined || b === undefined) continue;
          expect(a.start < b.start || (a.start === b.start && a.end <= b.end)).toBe(true);
        }
      }),
    );
  });

  it('keeps no sentence end, no pause of 1 s or more and no span over 10 s inside a Segment, and places every word once', async () => {
    await fc.assert(
      fc.asyncProperty(turnsArb, async (turns) => {
        const { segments } = await run(turns);
        for (const s of segments) {
          const inner = s.words.slice(0, -1);
          inner.forEach((w, i) => {
            const next = s.words[i + 1];
            if (next === undefined) return;
            expect(SENTENCE_END.some((mark) => w.w.endsWith(mark))).toBe(false);
            expect(next.start - w.end).toBeLessThan(1.0);
            expect(next.end - s.start).toBeLessThanOrEqual(10.0);
          });
        }
        // every word of every Turn sits in exactly one Segment
        const placed = segments
          .flatMap((s) => s.words.map((w) => `${w.start}-${w.end}-${w.w}`))
          .sort();
        expect(placed).toEqual(
          turns.flatMap((t) => t.words.map((w) => `${w.start}-${w.end}-${w.w}`)).sort(),
        );
      }),
    );
  });
  it('with words starting before their predecessor, sorts each Segment and still places every word once', async () => {
    const backwardsArb = fc
      .tuple(
        turnsArb,
        fc.array(fc.nat(), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 400 }),
      )
      .map(([turns, picks, back]) =>
        turns.map((turn, t) => {
          const words = turn.words.map((w) => ({ ...w }));
          for (const pick of picks) {
            const i = words.length > 1 ? 1 + ((pick + t) % (words.length - 1)) : 0;
            const before = words[i - 1];
            const word = words[i];
            if (i === 0 || before === undefined || word === undefined) continue;
            const start = Math.max(0, before.start - back / 1000);
            words[i] = { ...word, start, end: Math.max(start, word.end) };
          }
          return { ...turn, words };
        }),
      );
    await fc.assert(
      fc.asyncProperty(backwardsArb, async (turns) => {
        const { segments } = await run(turns);
        for (const s of segments) {
          expect(Segment.safeParse(s).success).toBe(true);
          s.words.forEach((w, i) => {
            if (i > 0) expect(w.start).toBeGreaterThanOrEqual(s.words[i - 1]?.start ?? 0);
          });
          expect(s.start).toBe(s.words[0]?.start);
          expect(s.end).toBe(s.words.at(-1)?.end);
        }
        const placed = segments
          .flatMap((s) => s.words.map((w) => `${w.start}-${w.end}-${w.w}`))
          .sort();
        expect(placed).toEqual(
          turns.flatMap((t) => t.words.map((w) => `${w.start}-${w.end}-${w.w}`)).sort(),
        );
      }),
    );
  });
});
