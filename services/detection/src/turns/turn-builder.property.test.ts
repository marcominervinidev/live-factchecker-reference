// Stage 1, @issue-28 (T3), Task 1: properties of Turn building over generated sequences of finalized Segments in
// seam order (fast-check), AC16 for Turns, AC7 for the knowable times, and the rules of AC1, AC2 and AC4 as
// invariants. Interface: see turn-builder.test.ts. Generator: seamSequences() in src/testing/turns.ts (ids
// ascending, finalizedAt non-decreasing and never before end, times on a 1/8 s grid so shifts stay exact).
// The Tick and count half of AC16 (same input, same Ticks and counts; a time shift moves every Tick) is in
// tick-scheduler.property.test.ts, because Ticks and counts come with Task 2.
import { createTurnBuilder } from './turn-builder.ts';
// After the modules under test on purpose: their absence is the red reason (tools/classify_red_reason.py).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  foldTurns,
  gridShift,
  seamSequences,
  shifted,
  START_VALUES,
  type FoldedTurn,
} from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';
import type { TurnEvent } from './types.ts';

const RUNS = { numRuns: 300 };

function build(segments: readonly Segment[]) {
  const builder = createTurnBuilder(START_VALUES);
  const perPush = segments.map((segment) => builder.push(segment));
  const atEnd = builder.end();
  const events: TurnEvent[] = [...perPush.flat(), ...atEnd];
  return { perPush, atEnd, events, turns: foldTurns(events, segments) };
}

/** The Turn's Segments, as given to the builder. */
function segmentsOf(turn: FoldedTurn, segments: readonly Segment[]): Segment[] {
  return turn.segmentIds.map((id) => {
    const found = segments.find((s) => s.id === id);
    if (found === undefined) throw new Error(`unknown Segment ${id}`);
    return found;
  });
}

function seamIndex(segments: readonly Segment[], id: string): number {
  return segments.findIndex((s) => s.id === id);
}

/** Turns without their ids (ids are the builder's own) and without times. */
function shape(turns: readonly FoldedTurn[]) {
  return turns.map((t) => ({
    speaker: t.speaker,
    segments: t.segmentIds,
    endReason: t.endReason,
    interjection: t.interjection,
  }));
}

describe('Turn building on any seam sequence (AC16) @ac-16', () => {
  it('puts every Segment into exactly one Turn, and every Turn ends', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        const { turns } = build(segments);
        const placed = turns.flatMap((t) => t.segmentIds).sort();
        expect(placed).toEqual(segments.map((s) => s.id).sort());
        expect(turns.every((t) => t.endReason !== undefined && t.endKnownAt !== undefined)).toBe(
          true,
        );
      }),
      RUNS,
    );
  });

  it('gives every Turn exactly one Speaker', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        for (const turn of build(segments).turns) {
          expect(new Set(segmentsOf(turn, segments).map((s) => s.speaker))).toEqual(
            new Set([turn.speaker]),
          );
        }
      }),
      RUNS,
    );
  });

  it('keeps the Segments of a Turn in seam order', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        for (const turn of build(segments).turns) {
          const positions = turn.segmentIds.map((id) => seamIndex(segments, id));
          expect(positions).toEqual([...positions].sort((a, b) => a - b));
        }
      }),
      RUNS,
    );
  });

  it('builds the same Turns from the same input every time', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        const once = build(segments);
        const again = build(segments);
        expect(again.events).toEqual(once.events);
      }),
      RUNS,
    );
  });

  it('builds the same Turns, with every end time moved by the same amount, when all times are shifted', () => {
    fc.assert(
      fc.property(seamSequences(), gridShift(), (segments, by) => {
        const plain = build(segments).turns;
        const moved = build(segments.map((s) => shifted(s, by))).turns;
        expect(shape(moved)).toEqual(shape(plain));
        expect(moved.map((t) => t.endKnownAt)).toEqual(
          plain.map((t) => (t.endKnownAt ?? Number.NaN) + by),
        );
      }),
      RUNS,
    );
  });
});

describe('Turn building keeps the rules of AC1, AC2 and AC4 on any seam sequence @ac-1 @ac-2 @ac-4', () => {
  it('never keeps a gap of 3 s or more inside a Turn', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        for (const turn of build(segments).turns) {
          const own = segmentsOf(turn, segments);
          let end = own[0]?.end ?? 0;
          for (const s of own.slice(1)) {
            expect(s.start - end).toBeLessThan(START_VALUES.turnPauseEndSeconds);
            end = Math.max(end, s.end);
          }
        }
      }),
      RUNS,
    );
  });

  it('never lets a Turn run longer than 180 s from its start to the end of a Segment', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        for (const turn of build(segments).turns) {
          const own = segmentsOf(turn, segments);
          const start = own[0]?.start ?? 0;
          for (const s of own)
            expect(s.end - start).toBeLessThanOrEqual(START_VALUES.turnMaxSeconds);
        }
      }),
      RUNS,
    );
  });

  it('marks a Turn as interjection only when it lasts under 2 s and starts before the end of another Speaker’s ongoing Turn', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        const turns = build(segments).turns;
        for (const turn of turns.filter((t) => t.interjection === true)) {
          expect(turn.endReason).toBe('interjection');
          const own = segmentsOf(turn, segments);
          const start = own[0]?.start ?? 0;
          expect(Math.max(...own.map((s) => s.end)) - start).toBeLessThan(
            START_VALUES.interjectionMaxSeconds,
          );
          // the ongoing Turn: another Speaker's, opened earlier in seam order, with speech ending after this start
          const first = seamIndex(segments, turn.segmentIds[0] ?? '');
          const host = turns.find((t) => {
            if (t.speaker === turn.speaker || t.interjection === true) return false;
            const hostSegments = segmentsOf(t, segments);
            return (
              seamIndex(segments, t.segmentIds[0] ?? '') < first &&
              hostSegments.some((s) => s.end > start)
            );
          });
          expect(host).toBeDefined();
        }
        for (const turn of turns.filter((t) => t.endReason === 'interjection')) {
          expect(turn.interjection).toBe(true);
        }
      }),
      RUNS,
    );
  });
});

describe('Turn building reports a Turn’s end only when it can be known (AC7) @ac-7', () => {
  it('never knows a Turn’s end before the finalizedAt of its last Segment', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        for (const turn of build(segments).turns) {
          const own = segmentsOf(turn, segments);
          const lastFinal = Math.max(...own.map((s) => s.finalizedAt));
          expect(turn.endKnownAt).toBeGreaterThanOrEqual(lastFinal);
        }
      }),
      RUNS,
    );
  });

  it('never knows a Speaker change before the finalizedAt of the other Speaker’s first Segment', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        for (const turn of build(segments).turns.filter((t) => t.endReason === 'speaker_change')) {
          const last = Math.max(...turn.segmentIds.map((id) => seamIndex(segments, id)));
          const next = segments[last + 1];
          if (next === undefined) continue; // decided by the end of the Input
          expect(next.speaker).not.toBe(turn.speaker);
          expect(turn.endKnownAt).toBeGreaterThanOrEqual(next.finalizedAt);
        }
      }),
      RUNS,
    );
  });

  it('never knows a pause before the end of the Turn’s last word plus 3 s', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        for (const turn of build(segments).turns.filter((t) => t.endReason === 'pause')) {
          const end = Math.max(...segmentsOf(turn, segments).map((s) => s.end));
          expect(turn.endKnownAt).toBeGreaterThanOrEqual(end + START_VALUES.turnPauseEndSeconds);
        }
      }),
      RUNS,
    );
  });

  it('reports a Turn’s end no earlier than the Segment, or the end of the Input, whose finalizedAt it names', () => {
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        const { perPush, atEnd } = build(segments);
        const lastFinal = segments.at(-1)?.finalizedAt ?? 0;
        perPush.forEach((events, i) => {
          for (const e of events) {
            if (e.kind !== 'turn-ended') continue;
            expect(e.turn.endKnownAt).toBeLessThanOrEqual(segments[i]?.finalizedAt ?? Number.NaN);
          }
        });
        for (const e of atEnd) {
          if (e.kind === 'turn-ended') expect(e.turn.endKnownAt).toBeLessThanOrEqual(lastFinal);
        }
      }),
      RUNS,
    );
  });

  it('never appends a Segment to a Turn whose end is known, and never changes, repeats or moves a Segment', () => {
    // foldTurns throws on an append after the end, a second append, a changed Segment or an ended Turn whose
    // Segments differ from the ones appended to it; the Segments are frozen, so a change in place throws too.
    fc.assert(
      fc.property(seamSequences(), (segments) => {
        expect(() => build(segments)).not.toThrow();
      }),
      RUNS,
    );
  });
});
