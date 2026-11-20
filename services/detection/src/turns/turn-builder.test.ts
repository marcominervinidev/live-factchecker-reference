// Stage 1, @issue-28 (T3), Task 1: Turn building from finalized Segments in seam order, AC1 to AC7
// (docs/spec/erkennung-modellrollen.md 2 and 8; ADR 0004; ADR 0005 addendum 2026-10-25; docs/spec/inputs.md 4.2
// rules 4 and 5). Cases mirror evals/tests/test_turns.py (class TurnBildung) where one exists; their expected end
// times follow the ticket's first Assumption (knowable times): a Turn's end is known at the harness time or at the
// finalizedAt of the Segment that proves the decision (or the end of the Input), whichever is later. Where that
// differs from the harness's text-mode value, the comment names the harness value (T8 and T9 report the deviation).
//
// Public interface these tests define (built in Task 1):
//   src/turns/types.ts
//     export type EndReason = 'pause' | 'max_length' | 'speaker_change' | 'interjection' | 'stream_end';
//     export interface TurnParameters { tickSeconds; turnPauseEndSeconds; turnMaxSeconds; interjectionMaxSeconds }
//                                        (seconds; the start values of spec 8 are 5, 3, 180, 2)
//     export interface Turn { readonly id: string; readonly speaker: string; readonly interjection: boolean;
//                             readonly segments: readonly Segment[] }
//     export interface EndedTurn extends Turn { readonly endReason: EndReason; readonly endKnownAt: number }
//     export type TurnEvent =
//       | { kind: 'turn-opened'; turn: Turn }                          (the Turn before its first Segment)
//       | { kind: 'segment-appended'; turn: Turn; segment: Segment }   (the Turn with the Segment in it)
//       | { kind: 'turn-ended'; turn: EndedTurn };                     (every Segment of the Turn, in order)
//   src/turns/turn-builder.ts
//     export function createTurnBuilder(parameters: TurnParameters): {
//       push(segment: Segment): readonly TurnEvent[];   // one finalized Segment, in seam order
//       end(): readonly TurnEvent[];                    // the end of the Input
//     }
//   No I/O, no timers, no clock of its own: a Turn's end is known at a time taken from the Segments (endKnownAt, in
//   seconds of Session audio time), and the event appears in what push() or end() returns at that point, not earlier.
//   A Segment that might still be an interjection may be held back or appended at once; the tests observe only the
//   Turns the events add up to and when each Turn's end is reported.
import { describe, expect, it } from 'vitest';

import { createTurnBuilder } from './turn-builder.ts';
import {
  bySeamOrder,
  foldTurns,
  seg,
  sid,
  START_VALUES,
  summary,
  type FoldedTurn,
} from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';
import type { EndReason, TurnEvent, TurnParameters } from './types.ts';

function run(segments: readonly Segment[], parameters: TurnParameters = START_VALUES) {
  const builder = createTurnBuilder(parameters);
  const perPush = segments.map((segment) => builder.push(segment));
  const atEnd = builder.end();
  const events = [...perPush.flat(), ...atEnd];
  return { perPush, atEnd, events, turns: bySeamOrder(foldTurns(events, segments)) };
}

function row(speaker: string, segments: string, endReason: EndReason, interjection = false) {
  return { speaker, segments, endReason, interjection };
}

function rows(segments: readonly Segment[], parameters?: TurnParameters) {
  return run(segments, parameters).turns.map(summary);
}

/** The Turn whose Segments are exactly `segments` (ids separated by spaces). */
function turnWith(turns: readonly FoldedTurn[], segments: string): FoldedTurn {
  const found = turns.find((t) => t.segmentIds.join(' ') === segments);
  if (found === undefined) throw new Error(`no Turn with Segments ${segments}`);
  return found;
}

/** Index of the push whose events end the Turn, or 'end' when end() does. */
function endedBy(
  perPush: readonly (readonly TurnEvent[])[],
  atEnd: readonly TurnEvent[],
  turn: FoldedTurn,
) {
  const ends = (events: readonly TurnEvent[]) =>
    events.some((e) => e.kind === 'turn-ended' && e.turn.id === turn.id);
  const index = perPush.findIndex(ends);
  if (index >= 0) return index;
  return ends(atEnd) ? 'end' : 'never';
}

const [S1, S2, S3, S4, S5, S6] = [sid(1), sid(2), sid(3), sid(4), sid(5), sid(6)];

describe('createTurnBuilder: a pause of 3 s ends a Turn (AC1) @ac-1', () => {
  it('keeps two Segments of one Speaker with a gap of 2.9 s in one Turn', () => {
    expect(rows([seg(S1, 'A', 0, 2), seg(S2, 'A', 4.9, 7)])).toEqual([
      row('A', `${S1} ${S2}`, 'stream_end'),
    ]);
  });

  it.each([
    { boundary: 'exactly 3 s', start: 5 },
    { boundary: '3.1 s', start: 5.1 },
  ])(
    'ends the Turn with pause at a gap of $boundary, and the next Segment opens a new Turn of the same Speaker',
    ({ start }) => {
      expect(rows([seg(S1, 'A', 0, 2), seg(S2, 'A', start, 7)])).toEqual([
        row('A', S1, 'pause'),
        row('A', S2, 'stream_end'),
      ]);
    },
  );

  it('measures the gap from the end of the Turn so far, not from its first Segment', () => {
    // 8.5 s is 6.5 s after the first Segment but 2.5 s after the Turn so far ends at 6 s
    expect(rows([seg(S1, 'A', 0, 2), seg(S2, 'A', 4, 6), seg(S3, 'A', 8.5, 9)])).toEqual([
      row('A', `${S1} ${S2} ${S3}`, 'stream_end'),
    ]);
  });

  it('takes the pause from its parameters: with 4 s a gap of 3.5 s keeps the Turn', () => {
    const segments = [seg(S1, 'A', 0, 2), seg(S2, 'A', 5.5, 7)];
    expect(rows(segments, { ...START_VALUES, turnPauseEndSeconds: 4 })).toEqual([
      row('A', `${S1} ${S2}`, 'stream_end'),
    ]);
    expect(rows(segments)).toEqual([row('A', S1, 'pause'), row('A', S2, 'stream_end')]);
  });
});

describe('createTurnBuilder: a Turn is at most 180 s long (AC2) @ac-2', () => {
  it('ends the Turn with max_length at the Segment that would make it longer than 180 s', () => {
    // evals/tests/test_turns.py test_hoechstlaenge_teilt_turn: Segments of 9.5 s every 10 s, 0 to 199.5 s
    const segments = Array.from({ length: 20 }, (_, i) =>
      seg(sid(i + 1), 'A', i * 10, i * 10 + 9.5),
    );
    const first18 = segments
      .slice(0, 18)
      .map((s) => s.id)
      .join(' ');
    expect(rows(segments)).toEqual([
      row('A', first18, 'max_length'),
      row('A', `${sid(19)} ${sid(20)}`, 'stream_end'),
    ]);
  });

  it('keeps a Turn of exactly 180 s as one Turn', () => {
    expect(rows([seg(S1, 'A', 0, 90), seg(S2, 'A', 91, 180)])).toEqual([
      row('A', `${S1} ${S2}`, 'stream_end'),
    ]);
  });

  it('ends a Turn that 180.125 s would exceed and opens a new Turn of the same Speaker', () => {
    expect(rows([seg(S1, 'A', 0, 90), seg(S2, 'A', 91, 180.125)])).toEqual([
      row('A', S1, 'max_length'),
      row('A', S2, 'stream_end'),
    ]);
  });

  it('ends the Turn with pause, not max_length, when a gap of 3 s comes with a Segment beyond 180 s', () => {
    // the pause is checked first (evals/src/harness/turns.py build_turns); 200 s would also exceed 180 s
    const result = run([seg(S1, 'A', 0, 100), seg(S2, 'A', 103, 200)]);
    expect(result.turns.map(summary)).toEqual([row('A', S1, 'pause'), row('A', S2, 'stream_end')]);
    const first = turnWith(result.turns, S1);
    expect(first.endKnownAt).toBe(200);
    expect(endedBy(result.perPush, result.atEnd, first)).toBe(1);
  });

  it('takes the maximum length from its parameters: 60 s splits at 61 s', () => {
    const segments = [seg(S1, 'A', 0, 30), seg(S2, 'A', 31, 61)];
    expect(rows(segments, { ...START_VALUES, turnMaxSeconds: 60 })).toEqual([
      row('A', S1, 'max_length'),
      row('A', S2, 'stream_end'),
    ]);
  });
});

describe('createTurnBuilder: a Speaker change ends a Turn (AC3) @ac-3', () => {
  it('ends the Turn with speaker_change when another Speaker starts after it, and that speech opens a new Turn', () => {
    // evals/tests/test_turns.py test_einwurf_ohne_ueberlappung_ist_sprecherwechsel
    expect(rows([seg(S1, 'A', 0, 5), seg(S2, 'B', 5.5, 6.5), seg(S3, 'A', 7, 10)])).toEqual([
      row('A', S1, 'speaker_change'),
      row('B', S2, 'speaker_change'),
      row('A', S3, 'stream_end'),
    ]);
  });

  it('splits Turns at every Speaker change inside one final block, whose Segments share finalizedAt', () => {
    // the shape of the Deepgram block at 80.828 s in golden: synt-2026-10-06-a 01:10-01:55 (B A B A, each Segment
    // starting where the one before ends)
    const result = run([
      seg(S1, 'B', 0, 5, 6),
      seg(S2, 'B', 5.2, 7.31, 9.5),
      seg(S3, 'A', 7.31, 7.55, 9.5),
      seg(S4, 'B', 7.55, 7.79, 9.5),
      seg(S5, 'A', 7.79, 8.91, 9.5),
      seg(S6, 'A', 9.14, 12.58, 13.2),
    ]);
    expect(result.turns.map(summary)).toEqual([
      row('B', `${S1} ${S2}`, 'speaker_change'),
      row('A', S3, 'speaker_change'),
      row('B', S4, 'speaker_change'),
      row('A', `${S5} ${S6}`, 'stream_end'),
    ]);
    expect(result.turns.slice(0, 3).map((t) => t.endKnownAt)).toEqual([9.5, 9.5, 9.5]);
  });
});

describe('createTurnBuilder: a short overlapping interjection does not end the Turn (AC4) @ac-4', () => {
  it('makes overlapping speech under 2 s, followed by the first Speaker within 3 s, a Turn of its own marked as interjection', () => {
    // evals/tests/test_turns.py test_kurzer_einwurf_mit_ueberlappung_beendet_turn_nicht; the interjection is
    // finalized with the block that ends at 10 s
    const result = run([seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 10.2, 15)]);
    expect(result.turns.map(summary)).toEqual([
      row('A', `${S1} ${S3}`, 'stream_end'),
      row('B', S2, 'interjection', true),
    ]);
  });

  it('makes a run of several Segments of the other Speaker one interjection', () => {
    expect(
      rows([
        seg(S1, 'A', 0, 10, 10),
        seg(S2, 'B', 6, 6.5, 10),
        seg(S3, 'B', 6.75, 7.5, 10),
        seg(S4, 'A', 10.2, 15),
      ]),
    ).toEqual([
      row('A', `${S1} ${S4}`, 'stream_end'),
      row('B', `${S2} ${S3}`, 'interjection', true),
    ]);
  });

  it('makes two interjections of the same other Speaker in one running Turn two Turns of their own', () => {
    expect(
      rows([
        seg(S1, 'A', 0, 10, 10),
        seg(S2, 'B', 6, 7.5, 10),
        seg(S3, 'A', 10.2, 12),
        seg(S4, 'B', 11.5, 12.5),
        seg(S5, 'A', 12.6, 15),
      ]),
    ).toEqual([
      row('A', `${S1} ${S3} ${S5}`, 'stream_end'),
      row('B', S2, 'interjection', true),
      row('B', S4, 'interjection', true),
    ]);
  });

  it.each([
    {
      boundary: 'starts 0.125 s before the end of the ongoing Turn',
      other: seg(S2, 'B', 9.875, 10.5, 10.5),
      resume: seg(S3, 'A', 11, 14),
    },
    {
      boundary: 'lasts 1.875 s',
      other: seg(S2, 'B', 6, 7.875, 10),
      resume: seg(S3, 'A', 10.2, 15),
    },
    {
      boundary: 'is followed by the first Speaker 2.875 s after the end of the ongoing Turn',
      other: seg(S2, 'B', 6, 7.5, 10),
      resume: seg(S3, 'A', 12.875, 15),
    },
  ])('is an interjection when the other Speaker $boundary', ({ other, resume }) => {
    expect(rows([seg(S1, 'A', 0, 10, 10), other, resume])).toEqual([
      row('A', `${S1} ${S3}`, 'stream_end'),
      row('B', S2, 'interjection', true),
    ]);
  });

  it('takes the interjection length from its parameters: with 1 s, overlapping speech of 1.5 s ends the Turn', () => {
    const segments = [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 10.2, 15)];
    expect(rows(segments, { ...START_VALUES, interjectionMaxSeconds: 1 })).toEqual([
      row('A', S1, 'speaker_change'),
      row('B', S2, 'speaker_change'),
      row('A', S3, 'stream_end'),
    ]);
  });
});

describe('createTurnBuilder: speech that is no interjection ends the Turn (AC5, negative) @ac-5', () => {
  // Each case changes exactly one condition of the interjection A 0-10, B 6-7.5, A 10.2-15 of AC4.
  it.each([
    {
      invalid: 'starts exactly at the end of the ongoing Turn',
      segments: [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 10, 11), seg(S3, 'A', 11.5, 15)],
      expected: [
        row('A', S1, 'speaker_change'),
        row('B', S2, 'speaker_change'),
        row('A', S3, 'stream_end'),
      ],
    },
    {
      invalid: 'overlaps and lasts exactly 2 s',
      segments: [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 8, 10), seg(S3, 'A', 10.2, 15)],
      expected: [
        row('A', S1, 'speaker_change'),
        row('B', S2, 'speaker_change'),
        row('A', S3, 'stream_end'),
      ],
    },
    {
      invalid: 'overlaps and lasts 3 s',
      // evals/tests/test_turns.py test_langer_ueberlappender_einwurf_ist_sprecherwechsel
      segments: [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 9, 10), seg(S3, 'A', 10.2, 15)],
      expected: [
        row('A', S1, 'speaker_change'),
        row('B', S2, 'speaker_change'),
        row('A', S3, 'stream_end'),
      ],
    },
    {
      invalid: 'is followed by the first Speaker exactly 3 s after the end of the ongoing Turn',
      segments: [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 13, 15)],
      expected: [
        row('A', S1, 'speaker_change'),
        row('B', S2, 'speaker_change'),
        row('A', S3, 'stream_end'),
      ],
    },
    {
      invalid: 'is followed by a third Speaker',
      segments: [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'C', 10.2, 15)],
      expected: [
        row('A', S1, 'speaker_change'),
        row('B', S2, 'speaker_change'),
        row('C', S3, 'stream_end'),
      ],
    },
    {
      invalid: 'is followed by the end of the Input',
      segments: [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10)],
      expected: [row('A', S1, 'speaker_change'), row('B', S2, 'stream_end')],
    },
  ])(
    'ends the ongoing Turn with speaker_change and marks no interjection when the other Speaker $invalid',
    ({ segments, expected }) => {
      const { turns } = run(segments);
      expect(turns.map(summary)).toEqual(expected);
      expect(turns.some((t) => t.interjection === true || t.endReason === 'interjection')).toBe(
        false,
      );
    },
  );
});

describe('createTurnBuilder: the end of the Input ends the open Turn (AC6) @ac-6', () => {
  it('ends the open Turn with stream_end at the finalizedAt of its last Segment, reported by end()', () => {
    const result = run([seg(S1, 'A', 0, 2, 2.5), seg(S2, 'A', 2.5, 4, 4.4)]);
    expect(result.turns.map(summary)).toEqual([row('A', `${S1} ${S2}`, 'stream_end')]);
    const [turn] = result.turns;
    if (turn === undefined) throw new Error('no Turn');
    expect(turn.endKnownAt).toBe(4.4);
    expect(endedBy(result.perPush, result.atEnd, turn)).toBe('end');
  });

  it('reports no Turn when the Input ends before any Segment', () => {
    expect(createTurnBuilder(START_VALUES).end()).toEqual([]);
  });

  it('ends a Turn of a single word', () => {
    // evals/tests/test_turns.py test_abschlussanalyse_auch_bei_einem_wort (its Turn half)
    expect(rows([seg(S1, 'A', 0, 0.4, 0.4, 'nein')])).toEqual([row('A', S1, 'stream_end')]);
  });
});

describe('createTurnBuilder: a Turn ends when its end can be known, never earlier (AC7) @ac-7', () => {
  it('knows a Speaker change at the finalizedAt of the other Speaker’s first Segment, not at its start', () => {
    // the harness's audio mode says 8.0 (end plus pause, before B is final); the pipeline sees B only once B is
    // final at 9.0
    const result = run([seg(S1, 'A', 0, 5, 5.25), seg(S2, 'B', 5.5, 6, 9)]);
    const a = turnWith(result.turns, S1);
    expect(a.endReason).toBe('speaker_change');
    expect(a.endKnownAt).toBe(9);
    expect(endedBy(result.perPush, result.atEnd, a)).toBe(1);
  });

  it('knows a pause at the finalizedAt of the Segment after it, which is never before the last word’s end plus 3 s', () => {
    // the harness (evals/tests/test_turns.py test_pause_ab_drei_sekunden_beendet_turn) says 5.0, end plus pause, in
    // text and audio mode; the pause is proven only by the next Segment, final at 6.5
    const result = run([seg(S1, 'A', 0, 2, 2.5), seg(S2, 'A', 5, 6, 6.5)]);
    const first = turnWith(result.turns, S1);
    expect(first.endReason).toBe('pause');
    expect(first.endKnownAt).toBe(6.5);
    expect(endedBy(result.perPush, result.atEnd, first)).toBe(1);
  });

  it('knows the maximum length at the finalizedAt of the Segment that would exceed it', () => {
    const result = run([seg(S1, 'A', 0, 90, 90.5), seg(S2, 'A', 91, 180.125, 181)]);
    const first = turnWith(result.turns, S1);
    expect(first.endReason).toBe('max_length');
    expect(first.endKnownAt).toBe(181);
    expect(endedBy(result.perPush, result.atEnd, first)).toBe(1);
  });

  it('knows that overlapping speech is no interjection only at the Segment with which it reaches 2 s', () => {
    // B's first Segment (1 s, final at 10.5) could still be an interjection; the second one brings B to 2.5 s at 11
    const result = run([
      seg(S1, 'A', 0, 10, 10),
      seg(S2, 'B', 6, 7, 10.5),
      seg(S3, 'B', 7.25, 8.5, 11),
    ]);
    expect(result.turns.map(summary)).toEqual([
      row('A', S1, 'speaker_change'),
      row('B', `${S2} ${S3}`, 'stream_end'),
    ]);
    const a = turnWith(result.turns, S1);
    expect(a.endKnownAt).toBe(11);
    expect(endedBy(result.perPush, result.atEnd, a)).toBe(2);
  });

  it('knows an interjection at the finalizedAt of the Segment with which the first Speaker resumes', () => {
    // the harness's audio mode says 10 (B final), before A has resumed
    const result = run([seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 10.2, 15)]);
    const b = turnWith(result.turns, S2);
    expect(b.endReason).toBe('interjection');
    expect(b.endKnownAt).toBe(15);
    expect(endedBy(result.perPush, result.atEnd, b)).toBe(2);
  });

  it('knows that an undecided overlap is no interjection at the end of the Input, at the last finalizedAt', () => {
    const result = run([seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10.25)]);
    const a = turnWith(result.turns, S1);
    expect(a.endKnownAt).toBe(10.25);
    expect(endedBy(result.perPush, result.atEnd, a)).toBe('end');
  });

  it('appends the first Speaker’s Segment after an interjection to the ongoing Turn, which has not ended', () => {
    const result = run([seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 10.2, 15)]);
    const appendedS3 = result.perPush[2]?.find(
      (e) => e.kind === 'segment-appended' && e.segment.id === S3,
    );
    const a = turnWith(result.turns, `${S1} ${S3}`);
    expect(appendedS3?.turn.id).toBe(a.id);
    expect(endedBy(result.perPush, result.atEnd, a)).toBe('end');
  });

  it('leaves every Segment it was given unchanged (the Segments are frozen)', () => {
    const segments = [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 10.2, 15)];
    const copies = segments.map((s) => JSON.stringify(s));
    expect(() => run(segments)).not.toThrow();
    expect(segments.map((s) => JSON.stringify(s))).toEqual(copies);
  });
});
