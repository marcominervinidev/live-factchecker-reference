// Stage 1, @issue-28 (T3), Task 2: the Tick plan, AC8 and AC9 (docs/spec/erkennung-modellrollen.md 2: one Tick per
// 5 s of speech of the Turn's finalized Segments plus the final analysis at the Turn's end, no length or word filter;
// ADR 0002, ADR 0004). Port of tick_plan (evals/src/harness/turns.py, audio mode: a Segment counts from its
// finalizedAt); the cases mirror evals/tests/test_turns.py class TickPlan where one exists. AC10 (both extractors get
// every Tick) is in tick-scheduler.test.ts, where the extractors are.
//
// Public interface these tests define (built in Task 2), next to the types of turn-builder.test.ts:
//   src/turns/tick-plan.ts
//     export interface Tick {
//       readonly turn: Turn;       // the Turn as far as it is known when the Tick falls due (all its Segments for
//                                  // the final analysis)
//       readonly time: number;     // Session audio time at which the Tick falls due
//       readonly upto: number;     // number of the Turn's Segments it covers (harness `upto`)
//       readonly final: boolean;   // the final analysis of the Turn
//     }
//     export function createTickPlan(parameters: TurnParameters): {
//       next(event: TurnEvent): readonly Tick[];   // the Ticks that fall due with this Turn event, in order
//     }
//   A non-final Tick falls due at the finalizedAt of the Segment with which the Turn's summed speech time (end minus
//   start of each Segment) reaches the next multiple of tickSeconds; the final analysis at the Turn's endKnownAt,
//   never before its last Segment's finalizedAt. A non-final Tick and the final analysis at the same time both fall
//   due (ticket #28, Assumptions: parity with the measured baseline).
import { describe, expect, it } from 'vitest';

import { createTickPlan, type Tick } from './tick-plan.ts';
import { seg, sid, START_VALUES, turnEvents } from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';
import type { EndReason, TurnEvent, TurnParameters } from './types.ts';

function ticks(events: readonly TurnEvent[], parameters: TurnParameters = START_VALUES): Tick[] {
  const plan = createTickPlan(parameters);
  return events.flatMap((event) => plan.next(event));
}

function view(tick: Tick) {
  return { turn: tick.turn.id, time: tick.time, upto: tick.upto, final: tick.final };
}

/** The Ticks of one Turn `t-a` of Speaker A, ended at `endKnownAt`. */
function ticksOfTurn(
  segments: readonly Segment[],
  endKnownAt: number,
  parameters?: TurnParameters,
  endReason: EndReason = 'stream_end',
) {
  return ticks(turnEvents('t-a', 'A', segments, { endReason, endKnownAt }), parameters).map(
    (t) => ({ time: t.time, upto: t.upto, final: t.final }),
  );
}

const [S1, S2, S3, S4, S5] = [sid(1), sid(2), sid(3), sid(4), sid(5)];

describe('createTickPlan: one Tick per 5 s of speech (AC8) @ac-8', () => {
  it('lets a Tick fall due at every 5 s of summed speech and carries the number of Segments it covers', () => {
    // evals/tests/test_turns.py test_ticks_je_fuenf_sekunden_redezeit_plus_abschluss
    const segments = [
      seg(S1, 'A', 0, 3),
      seg(S2, 'A', 3, 6),
      seg(S3, 'A', 6, 9),
      seg(S4, 'A', 9, 12),
      seg(S5, 'A', 12, 14),
    ];
    expect(ticksOfTurn(segments, 14)).toEqual([
      { time: 6, upto: 2, final: false },
      { time: 12, upto: 4, final: false },
      { time: 14, upto: 5, final: true },
    ]);
  });

  it('lets the Tick fall due at the finalizedAt of the Segment, not at its end', () => {
    const segments = [seg(S1, 'A', 0, 3, 3.5), seg(S2, 'A', 3, 6, 7.25)];
    expect(ticksOfTurn(segments, 8)).toEqual([
      { time: 7.25, upto: 2, final: false },
      { time: 8, upto: 2, final: true },
    ]);
  });

  it.each([
    { boundary: 'exactly 5 s', end: 5, expected: [{ time: 5, upto: 2, final: false }] },
    { boundary: '4.875 s', end: 4.875, expected: [] },
  ])('treats a speech time of $boundary as reached only from 5 s on', ({ end, expected }) => {
    const segments = [seg(S1, 'A', 0, 2.5), seg(S2, 'A', 2.5, end)];
    expect(ticksOfTurn(segments, end).filter((t) => !t.final)).toEqual(expected);
  });

  it('lets one Tick fall due for a Segment that crosses several multiples, and counts on from the next multiple', () => {
    // evals/tests/test_turns.py test_langes_segment_ueber_mehrere_schwellen_ein_tick, plus a Segment reaching 15 s
    const segments = [seg(S1, 'A', 0, 12), seg(S2, 'A', 12, 14), seg(S3, 'A', 14, 15.5)];
    expect(ticksOfTurn(segments, 16)).toEqual([
      { time: 12, upto: 1, final: false },
      { time: 15.5, upto: 3, final: false },
      { time: 16, upto: 3, final: true },
    ]);
  });

  it('sums the speech of the Segments, not the time from the Turn’s start (gaps do not count)', () => {
    const reaching = [seg(S1, 'A', 0, 3), seg(S2, 'A', 5, 7)];
    const short = [seg(S1, 'A', 0, 3), seg(S2, 'A', 4.875, 6.75)];
    expect(ticksOfTurn(reaching, 7).filter((t) => !t.final)).toEqual([
      { time: 7, upto: 2, final: false },
    ]);
    expect(ticksOfTurn(short, 6.75).filter((t) => !t.final)).toEqual([]);
  });

  it('takes the Tick length from its parameters: with 2.5 s every 2.5 s of speech is a Tick', () => {
    const segments = [seg(S1, 'A', 0, 3), seg(S2, 'A', 3, 5)];
    expect(ticksOfTurn(segments, 5, { ...START_VALUES, tickSeconds: 2.5 })).toEqual([
      { time: 3, upto: 1, final: false },
      { time: 5, upto: 2, final: false },
      { time: 5, upto: 2, final: true },
    ]);
  });

  it('counts each Turn’s own speech when the events of two Turns interleave', () => {
    // A speaks 4 s, B interjects 1.5 s, A goes on for 1 s: A reaches 5 s only with its second Segment
    const a1 = seg(S1, 'A', 0, 4, 4);
    const b = seg(S2, 'B', 3, 4.5, 4.5);
    const a2 = seg(S3, 'A', 4.6, 5.6, 5.6);
    const [openA, appendA1, appendA2, endA] = turnEvents('t-a', 'A', [a1, a2], {
      endReason: 'stream_end',
      endKnownAt: 5.6,
    });
    const interjection = turnEvents('t-b', 'B', [b], {
      endReason: 'interjection',
      endKnownAt: 5.6,
      interjection: true,
    });
    if (
      openA === undefined ||
      appendA1 === undefined ||
      appendA2 === undefined ||
      endA === undefined
    ) {
      throw new Error('turnEvents gave fewer events');
    }
    const all = ticks([openA, appendA1, ...interjection, appendA2, endA]).map(view);
    expect(all.filter((t) => t.turn === 't-a')).toEqual([
      { turn: 't-a', time: 5.6, upto: 2, final: false },
      { turn: 't-a', time: 5.6, upto: 2, final: true },
    ]);
    expect(all.filter((t) => t.turn === 't-b')).toEqual([
      { turn: 't-b', time: 5.6, upto: 1, final: true },
    ]);
  });

  it('lets no Tick fall due when a Turn opens', () => {
    const [opened] = turnEvents('t-a', 'A', [seg(S1, 'A', 0, 6)]);
    if (opened === undefined) throw new Error('no event');
    expect(createTickPlan(START_VALUES).next(opened)).toEqual([]);
  });
});

describe('createTickPlan: exactly one final analysis per Turn (AC9) @ac-9', () => {
  it('gives a Turn of a single word its final analysis and no other Tick', () => {
    // evals/tests/test_turns.py test_abschlussanalyse_auch_bei_einem_wort
    expect(ticksOfTurn([seg(S1, 'A', 0, 0.4, 0.4, 'nein')], 0.4)).toEqual([
      { time: 0.4, upto: 1, final: true },
    ]);
  });

  it('gives a Turn of several Segments under 5 s only its final analysis, covering all Segments', () => {
    const segments = [seg(S1, 'A', 0, 1), seg(S2, 'A', 1, 2.5), seg(S3, 'A', 2.5, 4.875)];
    expect(ticksOfTurn(segments, 7.875, START_VALUES, 'pause')).toEqual([
      { time: 7.875, upto: 3, final: true },
    ]);
  });

  it('gives an interjection exactly one final analysis at the time its end is known', () => {
    const events = turnEvents('t-b', 'B', [seg(S2, 'B', 6, 7.5, 10)], {
      endReason: 'interjection',
      endKnownAt: 15,
      interjection: true,
    });
    expect(ticks(events).map(view)).toEqual([{ turn: 't-b', time: 15, upto: 1, final: true }]);
  });

  it('lets the final analysis fall due at the time the Turn’s end is known, after every other Tick of the Turn', () => {
    const segments = [seg(S1, 'A', 0, 6, 6.5), seg(S2, 'A', 6.5, 8, 9)];
    const all = ticksOfTurn(segments, 12, START_VALUES, 'speaker_change');
    expect(all.filter((t) => t.final)).toEqual([{ time: 12, upto: 2, final: true }]);
    expect(all.at(-1)?.final).toBe(true);
  });

  it('never lets the final analysis fall due before the last Segment’s finalizedAt', () => {
    expect(ticksOfTurn([seg(S1, 'A', 0, 2, 4)], 3)).toEqual([{ time: 4, upto: 1, final: true }]);
  });

  it('lets a non-final Tick and the final analysis fall due together when both come at the same time', () => {
    expect(ticksOfTurn([seg(S1, 'A', 0, 5)], 5)).toEqual([
      { time: 5, upto: 1, final: false },
      { time: 5, upto: 1, final: true },
    ]);
  });
});
