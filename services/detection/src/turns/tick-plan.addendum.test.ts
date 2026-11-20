// Stage 1, @issue-28 (T3), Task 2, gate-1 addendum of 2026-10-30 (coverage gap P2 named by the review of task 2):
// the Tick plan when a Turn's speech lands exactly on a multiple of 5 s and the Turn goes on.
//
// Source: AC8 (a Tick falls due at the finalizedAt of the Segment with which the summed speech time reaches the next
// multiple of 5 s; a Segment that crosses several multiples yields one Tick; each Tick carries the number of Segments
// it covers), AC9 (exactly one final analysis at the time the Turn's end is known), AC17 (at most speech / 5 s
// non-final Ticks; the final analysis is the last Tick of its Turn), the ticket's Assumption that a non-final Tick and
// the final analysis at the same time both fall due, and evals/src/harness/turns.py tick_plan (after a Tick the next
// threshold is the first multiple above the speech so far). The frozen boundary case of tick-plan.test.ts ends the
// Turn on the multiple; these fixed examples let it go on, so a random property seed is not the only guard.
//
// Interface: tick-plan.test.ts (frozen). Turn events from `turnEvents` (src/testing/turns.ts), own ids.
import { describe, expect, it } from 'vitest';

import { createTickPlan } from './tick-plan.ts';
import { seg, sid, START_VALUES, turnEvents } from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';

/** The Ticks of one Turn `t-p2` of Speaker A, ended with stream_end at `endKnownAt`. */
function ticksOfTurn(segments: readonly Segment[], endKnownAt: number) {
  const plan = createTickPlan(START_VALUES);
  return turnEvents('t-p2', 'A', segments, { endReason: 'stream_end', endKnownAt })
    .flatMap((event) => plan.next(event))
    .map((t) => ({ time: t.time, upto: t.upto, final: t.final }));
}

const [S1, S2, S3] = [sid(1), sid(2), sid(3)];

describe('createTickPlan: speech that lands exactly on a multiple of 5 s (item P2, AC8) @ac-8', () => {
  it('lets exactly one non-final Tick fall due at 5 s of speech when the Turn goes on for 0.5 s, then the final analysis', () => {
    const segments = [seg(S1, 'A', 0, 5), seg(S2, 'A', 5, 5.5)];
    expect(ticksOfTurn(segments, 5.5)).toEqual([
      { time: 5, upto: 1, final: false },
      { time: 5.5, upto: 2, final: true },
    ]);
  });

  it('counts on to the next multiple after landing exactly on 5 s: the next Tick falls due at 10 s of speech', () => {
    const segments = [seg(S1, 'A', 0, 5), seg(S2, 'A', 5, 5.5), seg(S3, 'A', 5.5, 10)];
    expect(ticksOfTurn(segments, 10)).toEqual([
      { time: 5, upto: 1, final: false },
      { time: 10, upto: 3, final: false },
      { time: 10, upto: 3, final: true },
    ]);
  });

  it('lets a Segment that crosses 5 s and lands exactly on 10 s yield one Tick, and the next 0.5 s none', () => {
    const segments = [seg(S1, 'A', 0, 3), seg(S2, 'A', 3, 10), seg(S3, 'A', 10, 10.5)];
    expect(ticksOfTurn(segments, 10.5)).toEqual([
      { time: 10, upto: 2, final: false },
      { time: 10.5, upto: 3, final: true },
    ]);
  });
});
