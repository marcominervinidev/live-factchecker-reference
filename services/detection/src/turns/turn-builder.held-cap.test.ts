// Stage 1, @issue-28 (T3), Task 1, gate-1 addendum of 2026-10-30: PENDING OWNER DECISION 1 OF 2026-10-30 (security
// finding S1 of task 1, recommendation "yes", K = 200). Red on task/28-2 until the decision and the code exist.
//
// A count cap for the held-back run. The builder holds back a run of another Speaker that may still be an
// interjection until it is decided (AC4, AC7); that run is bounded by time only, so a hostile Input of many tiny
// Segments inside the overlap makes one push() return one `segment-appended` event per held Segment, each with its own
// snapshot (frozen interface): about N²/2 Segment references at once for a run of N (S1: 8000 Segments ≈ 258 MB).
// The cap is a decided deviation from AC4 for such Input, named here so the owner sees it:
//   - new builder parameter `maxHeldSegments` in the parameters object of createTurnBuilder, default 200 when absent
//     (START_VALUES of src/testing/turns.ts has none, so it builds with the default); an integer of at least 1;
//   - a run of at most maxHeldSegments Segments is held as before (AC4 and AC5 unchanged);
//   - the Segment with which the run would exceed maxHeldSegments decides at once that the run is no interjection:
//     the ongoing Turn ends with `speaker_change`, its endKnownAt the finalizedAt of that Segment (AC7, owner decision
//     2026-10-29: the end is known with the Segment that proves it), and the run opens the next Turn (AC3, AC5);
//   - each held run is counted on its own; the Segments of an ongoing Turn are never capped (AC1, AC2 decide those);
//   - 0, a negative number, a non-integer, NaN and Infinity are rejected when the builder is created, with an error
//     that names `maxHeldSegments` (as the configuration names an invalid TURN_* variable, manifest 28.json task 3).
// Bound (property): one push() or end() returns at most P + 2 + (K + 1)(K + 2) / 2 + 2(K + 1) Segment references
// (each event's `turn.segments` plus the `segment` of a `segment-appended`), P the number of Segments pushed before
// the call. Derivation from the interface: the ongoing Turn ends (at most P references) or takes the pushed Segment
// (at most P + 1 plus 1); a released run of h <= K + 1 Segments opens a Turn with h snapshots of 1 to h Segments plus
// h `segment` fields, and ends at once (h more) when it is an interjection or the pushed Segment ends it; a new Turn
// for the pushed Segment adds 2. So a push stays quadratic in K (fresh array per event, frozen) but no longer in the
// length of a hostile run. Linear in K is not reachable with a snapshot per event (open question in the report).
//
// Interface: turn-builder.test.ts (frozen) plus `maxHeldSegments` as above. fast-check seed 280306 (fixed).
import { createTurnBuilder } from './turn-builder.ts';
// After the module under test on purpose: its absence is the red reason on a base without it.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bySeamOrder,
  foldTurns,
  seamSequences,
  seg,
  sid,
  START_VALUES,
  summary,
  type FoldedTurn,
} from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';
import type { EndReason, TurnEvent, TurnParameters } from './types.ts';

/** The builder's parameters with the cap (pending owner decision 1). */
type CappedParameters = TurnParameters & { readonly maxHeldSegments: number };

function capped(maxHeldSegments: number): CappedParameters {
  return { ...START_VALUES, maxHeldSegments };
}

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

const STEP = 1 / 256; // exact in binary floating point

/**
 * A 0-10 (final at 10), then `count` tiny Segments of B inside A's Turn (from 6 s, 1/512 s long, 1/256 s apart,
 * finalized one after the other from 10 s; the whole run spans under 2 s for count <= 400), then A resumes at
 * 10.2-15. Without a cap the run is an interjection (AC4).
 */
function hostile(count: number) {
  const first = seg(sid(1), 'A', 0, 10, 10);
  const run = Array.from({ length: count }, (_, i) =>
    seg(sid(i + 2), 'B', 6 + i * STEP, 6 + i * STEP + STEP / 2, 10 + i * STEP, 'ja'),
  );
  const resume = seg(sid(count + 2), 'A', 10.2, 15, 15);
  const ids = (segments: readonly Segment[]) => segments.map((s) => s.id).join(' ');
  return { segments: [first, ...run, resume], first, run, resume, ids };
}

/** Segment references in what one push() or end() returned. */
function references(events: readonly TurnEvent[]): number {
  return events.reduce(
    (sum, e) => sum + e.turn.segments.length + (e.kind === 'segment-appended' ? 1 : 0),
    0,
  );
}

function bound(k: number, pushedBefore: number): number {
  return pushedBefore + 2 + ((k + 1) * (k + 2)) / 2 + 2 * (k + 1);
}

const CAPS = [
  { name: 'K = 1', k: 1, parameters: capped(1) },
  { name: 'K = 3', k: 3, parameters: capped(3) },
  { name: 'the default K = 200', k: 200, parameters: START_VALUES },
];

describe('createTurnBuilder: a held-back run of at most maxHeldSegments Segments is held as before (pending owner decision 1, AC4)', () => {
  it.each(CAPS)(
    'makes a run of exactly K Segments an interjection with $name',
    ({ k, parameters }) => {
      const { segments, first, run: held, resume, ids } = hostile(k);
      const result = run(segments, parameters);
      expect(result.turns.map(summary)).toEqual([
        row('A', ids([first, resume]), 'stream_end'),
        row('B', ids(held), 'interjection', true),
      ]);
    },
  );

  it('counts each held run on its own: two runs of K = 2 Segments in one Turn are two interjections', () => {
    const segments = [
      seg(sid(1), 'A', 0, 10, 10),
      seg(sid(2), 'B', 6, 6.5, 10),
      seg(sid(3), 'B', 6.75, 7.5, 10),
      seg(sid(4), 'A', 10.2, 12, 12),
      seg(sid(5), 'B', 11.5, 11.75, 12),
      seg(sid(6), 'B', 11.875, 12.25, 12.25),
      seg(sid(7), 'A', 12.5, 15, 15),
    ];
    expect(run(segments, capped(2)).turns.map(summary)).toEqual([
      row('A', `${sid(1)} ${sid(4)} ${sid(7)}`, 'stream_end'),
      row('B', `${sid(2)} ${sid(3)}`, 'interjection', true),
      row('B', `${sid(5)} ${sid(6)}`, 'interjection', true),
    ]);
  });

  it('never caps the Segments of an ongoing Turn: 300 Segments of one Speaker stay one Turn with K = 1', () => {
    const segments = Array.from({ length: 300 }, (_, i) =>
      seg(sid(i + 1), 'A', i * 0.5, i * 0.5 + 0.25, i * 0.5 + 0.25, 'ja'),
    );
    const { turns } = run(segments, capped(1));
    expect(turns.map((t) => [t.speaker, t.segmentIds.length, t.endReason])).toEqual([
      ['A', 300, 'stream_end'],
    ]);
  });
});

describe('createTurnBuilder: the Segment that would exceed maxHeldSegments decides the run is no interjection (pending owner decision 1, AC3, AC5, AC7)', () => {
  it.each(CAPS)(
    'ends the ongoing Turn with speaker_change at the finalizedAt of Segment K + 1 and lets the run open the next Turn, with $name',
    ({ k, parameters }) => {
      const { segments, first, run: held, resume, ids } = hostile(k + 1);
      const crossing = held[k];
      if (crossing === undefined) throw new Error('run too short');
      const result = run(segments, parameters);
      expect(result.turns.map(summary)).toEqual([
        row('A', first.id, 'speaker_change'),
        row('B', ids(held), 'speaker_change'),
        row('A', resume.id, 'stream_end'),
      ]);
      const [turnA, turnB] = result.turns;
      if (turnA === undefined || turnB === undefined) throw new Error('missing Turn');
      expect(turnA.endKnownAt).toBe(crossing.finalizedAt);
      // the push of Segment K + 1 of the run: push index K + 1 (A's Segment is push 0)
      expect(endedBy(result.perPush, result.atEnd, turnA)).toBe(k + 1);
      // A resumes after B's Turn has ended: a Speaker change without overlap, known with A's Segment (AC3, AC7)
      expect(turnB.endKnownAt).toBe(resume.finalizedAt);
    },
  );

  it('decides at once and does not wait for the end of the Input either', () => {
    const { first, run: held } = hostile(4);
    const result = run([first, ...held], capped(3));
    const [turnA] = result.turns;
    if (turnA === undefined) throw new Error('missing Turn');
    expect(endedBy(result.perPush, result.atEnd, turnA)).toBe(4);
    expect(result.turns.map(summary)).toEqual([
      row('A', first.id, 'speaker_change'),
      row('B', held.map((s) => s.id).join(' '), 'stream_end'),
    ]);
  });
});

describe('createTurnBuilder: maxHeldSegments must be an integer of at least 1 (pending owner decision 1, negative)', () => {
  it.each([
    { invalid: '0', value: 0 },
    { invalid: 'a negative number', value: -1 },
    { invalid: 'a non-integer', value: 1.5 },
    { invalid: 'NaN', value: Number.NaN },
    { invalid: 'Infinity', value: Number.POSITIVE_INFINITY },
  ])('rejects $invalid when the builder is created, naming maxHeldSegments', ({ value }) => {
    expect(() => createTurnBuilder(capped(value))).toThrow(/maxHeldSegments/);
  });

  it('accepts the smallest valid value, 1', () => {
    expect(() => createTurnBuilder(capped(1))).not.toThrow();
  });
});

const SEED = 280306;

describe('createTurnBuilder: what one push returns is bounded by K, not by the length of a held run (pending owner decision 1, property)', () => {
  const hostileInput = fc.record({
    k: fc.integer({ min: 1, max: 12 }),
    count: fc.integer({ min: 0, max: 80 }),
    // what follows the run: A resumes (interjection unless capped), a third Speaker, or the end of the Input
    tail: fc.constantFrom('resume', 'third', 'end'),
  });

  it('keeps every push() and end() of a hostile run within the bound, and no interjection longer than K', () => {
    fc.assert(
      fc.property(hostileInput, ({ k, count, tail }) => {
        const { first, run: held } = hostile(count);
        const next =
          tail === 'resume'
            ? [seg(sid(count + 2), 'A', 10.2, 15, 15)]
            : tail === 'third'
              ? [seg(sid(count + 2), 'C', 10.2, 15, 15)]
              : [];
        const segments = [first, ...held, ...next];
        const builder = createTurnBuilder(capped(k));
        const results = segments.map((segment) => builder.push(segment));
        results.push(builder.end());
        results.forEach((events, pushedBefore) => {
          expect(references(events)).toBeLessThanOrEqual(bound(k, pushedBefore));
        });
        const turns = foldTurns(results.flat(), segments);
        expect(turns.flatMap((t) => t.segmentIds).sort()).toEqual(segments.map((s) => s.id).sort());
        for (const turn of turns.filter((t) => t.interjection === true)) {
          expect(turn.segmentIds.length).toBeLessThanOrEqual(k);
        }
      }),
      { numRuns: 200, seed: SEED },
    );
  });

  it('keeps the bound and AC16 on any seam sequence with a small K', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), seamSequences(), (k, segments) => {
        const builder = createTurnBuilder(capped(k));
        const results = segments.map((segment) => builder.push(segment));
        results.push(builder.end());
        results.forEach((events, pushedBefore) => {
          expect(references(events)).toBeLessThanOrEqual(bound(k, pushedBefore));
        });
        const turns = foldTurns(results.flat(), segments);
        expect(turns.flatMap((t) => t.segmentIds).sort()).toEqual(segments.map((s) => s.id).sort());
        expect(turns.every((t) => t.endReason !== undefined)).toBe(true);
        for (const turn of turns.filter((t) => t.interjection === true)) {
          expect(turn.segmentIds.length).toBeLessThanOrEqual(k);
        }
      }),
      { numRuns: 300, seed: SEED },
    );
  });
});
