// Test helper of the detection service, issue #28 (T3): Segments built by hand for the unit tests of Turn building,
// Tick plan and skip rule, the fast-check generator of seam sequences, and a fold of Turn events into Turns. It
// imports no module under test (only types), so each task's tests fail for their own missing module. Never imported
// by production code.
//
// Times are seconds of Session audio time (docs/spec/inputs.md 4.1). Generated times lie on a 1/8 s grid, so sums and
// shifts are exact in binary floating point and a boundary such as "exactly 5 s of speech" stays exact.
import fc from 'fast-check';

import type { Segment } from '@lfc/contracts';

import type { EndedTurn, EndReason, Turn, TurnEvent, TurnParameters } from '../turns/types.ts';

/** Start values of docs/spec/erkennung-modellrollen.md section 8 (the criteria of #28 name them). */
export const START_VALUES: TurnParameters = {
  tickSeconds: 5,
  turnPauseEndSeconds: 3,
  turnMaxSeconds: 180,
  interjectionMaxSeconds: 2,
};

export const SESSION = '28a0c0de-0000-4000-8000-000000000001';

/** Freezes a Segment with its words: a module that changes a Segment it was given throws (ESM is strict). */
function frozen(segment: Segment): Segment {
  for (const word of segment.words) Object.freeze(word);
  Object.freeze(segment.words);
  return Object.freeze(segment);
}

/**
 * A contract-valid, frozen Segment: words spread evenly over [start, end], `finalizedAt` defaults to `end` (as the
 * reference-transcript Input sets it). Throws on a Segment the contract would reject.
 */
export function seg(
  id: string,
  speaker: string,
  start: number,
  end: number,
  finalizedAt: number = end,
  text = 'die Mieten steigen',
): Segment {
  if (!(end >= start && finalizedAt >= end && start >= 0)) {
    throw new Error(`invalid test Segment ${id}: ${start}-${end}, finalizedAt ${finalizedAt}`);
  }
  const texts = text.split(' ').filter((w) => w !== '');
  const step = (end - start) / texts.length;
  const words = texts.map((w, i) => ({
    w,
    start: i === 0 ? start : start + i * step,
    end: i === texts.length - 1 ? end : start + (i + 1) * step,
  }));
  return frozen({
    schemaVersion: 1,
    id,
    sessionId: SESSION,
    speaker,
    start,
    end,
    finalizedAt,
    language: 'de',
    words,
  });
}

/** Ids s-0001, s-0002, … for `seg`, in seam order. */
export function sid(n: number): string {
  return `s-${String(n).padStart(4, '0')}`;
}

/** The same Segment with every time moved by `by` seconds (words, start, end, finalizedAt). */
export function shifted(segment: Segment, by: number): Segment {
  return frozen({
    ...segment,
    start: segment.start + by,
    end: segment.end + by,
    finalizedAt: segment.finalizedAt + by,
    words: segment.words.map((w) => ({ ...w, start: w.start + by, end: w.end + by })),
  });
}

/**
 * The events of one Turn as the builder reports them (interface in src/turns/turn-builder.test.ts): opened without a
 * Segment, one event per appended Segment with the Turn so far, and, when `end` is given, the ended Turn.
 */
export function turnEvents(
  id: string,
  speaker: string,
  segments: readonly Segment[],
  end?: {
    readonly endReason: EndReason;
    readonly endKnownAt: number;
    readonly interjection?: boolean;
  },
): TurnEvent[] {
  const interjection = end?.interjection ?? false;
  const events: TurnEvent[] = [
    { kind: 'turn-opened', turn: { id, speaker, interjection, segments: [] } },
  ];
  segments.forEach((segment, i) => {
    events.push({
      kind: 'segment-appended',
      turn: { id, speaker, interjection, segments: segments.slice(0, i + 1) },
      segment,
    });
  });
  if (end !== undefined) {
    events.push({
      kind: 'turn-ended',
      turn: {
        id,
        speaker,
        interjection,
        segments: [...segments],
        endReason: end.endReason,
        endKnownAt: end.endKnownAt,
      },
    });
  }
  return events;
}

/** A Turn as the Turn events describe it, folded in order of opening. */
export interface FoldedTurn {
  readonly id: string;
  readonly speaker: string;
  readonly segmentIds: string[];
  endReason?: EndReason;
  endKnownAt?: number;
  interjection?: boolean;
}

/**
 * Folds Turn events into Turns and checks the rules every event stream keeps (AC7): a Segment is appended only to a
 * Turn that is open and not ended, once overall, unchanged; a Turn ends once and its ended form lists exactly the
 * Segments appended to it, in that order. Throws an Error naming the broken rule.
 */
export function foldTurns(events: readonly TurnEvent[], pushed?: readonly Segment[]): FoldedTurn[] {
  const fold: Fold = {
    turns: new Map(),
    appended: new Set(),
    pushed: new Map((pushed ?? []).map((s) => [s.id, s])),
  };
  // An event kind the builder adds beyond these three is ignored here.
  for (const event of events) {
    switch (event.kind) {
      case 'turn-opened':
        opened(fold, event.turn);
        break;
      case 'segment-appended':
        appendedTo(fold, event.turn, event.segment);
        break;
      case 'turn-ended':
        ended(fold, event.turn);
        break;
    }
  }
  return [...fold.turns.values()];
}

interface Fold {
  readonly turns: Map<string, FoldedTurn>;
  readonly appended: Set<string>;
  readonly pushed: ReadonlyMap<string, Segment>;
}

function broken(rule: string): never {
  throw new Error(rule);
}

function opened(fold: Fold, turn: Turn): void {
  if (fold.turns.has(turn.id)) broken(`Turn ${turn.id} opened twice`);
  fold.turns.set(turn.id, { id: turn.id, speaker: turn.speaker, segmentIds: [] });
}

function appendedTo(fold: Fold, to: Turn, segment: Segment): void {
  const turn =
    fold.turns.get(to.id) ?? broken(`Segment ${segment.id} appended to unopened ${to.id}`);
  if (turn.endReason !== undefined)
    broken(`Segment ${segment.id} appended to ${turn.id} after its end`);
  if (fold.appended.has(segment.id)) broken(`Segment ${segment.id} appended twice`);
  const original = fold.pushed.get(segment.id);
  if (original !== undefined && JSON.stringify(original) !== JSON.stringify(segment)) {
    broken(`Segment ${segment.id} changed on its way into a Turn`);
  }
  fold.appended.add(segment.id);
  turn.segmentIds.push(segment.id);
}

function ended(fold: Fold, end: EndedTurn): void {
  const turn = fold.turns.get(end.id) ?? broken(`unopened Turn ${end.id} ended`);
  if (turn.endReason !== undefined) broken(`Turn ${turn.id} ended twice`);
  const listed = end.segments.map((s) => s.id).join(' ');
  if (listed !== turn.segmentIds.join(' ')) {
    broken(`ended Turn ${turn.id} lists ${listed}, appended ${turn.segmentIds.join(' ')}`);
  }
  turn.endReason = end.endReason;
  turn.endKnownAt = end.endKnownAt;
  turn.interjection = end.interjection;
}

/** The parts of a folded Turn the examples compare. */
export function summary(turn: FoldedTurn): {
  speaker: string;
  segments: string;
  endReason: EndReason | undefined;
  interjection: boolean | undefined;
} {
  return {
    speaker: turn.speaker,
    segments: turn.segmentIds.join(' '),
    endReason: turn.endReason,
    interjection: turn.interjection,
  };
}

/** Folded Turns ordered by the seam position of their first Segment (ids ascend in seam order). */
export function bySeamOrder(turns: readonly FoldedTurn[]): FoldedTurn[] {
  const first = (t: FoldedTurn): number => Number((t.segmentIds[0] ?? 's-0').slice(2));
  return [...turns].sort((a, b) => first(a) - first(b));
}

const GRID = 8; // 1/8 s

interface Step {
  speaker: number;
  gap: number;
  length: number;
  delay: number;
  words: number;
}

function build(steps: readonly Step[], speakers: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  const lastEnd = new Map<string, number>();
  let previousEnd = 0;
  let previousFinal = 0;
  steps.forEach((step, i) => {
    const speaker = speakers[step.speaker % speakers.length] ?? 'A';
    // No Speaker overlaps their own speech; another Speaker may start before the previous Segment ends.
    const start = Math.max(0, previousEnd + step.gap / GRID, lastEnd.get(speaker) ?? 0);
    const end = start + step.length / GRID;
    const finalizedAt = Math.max(previousFinal, end) + step.delay / GRID;
    const words = Array.from({ length: Math.min(step.words, step.length) }, (_, k) => `w${k}`);
    segments.push(seg(sid(i + 1), speaker, start, end, finalizedAt, words.join(' ')));
    lastEnd.set(speaker, end);
    previousEnd = end;
    previousFinal = finalizedAt;
  });
  return segments;
}

const conversationStep = fc.record({
  // A, B, C with A and B most often, so runs, Speaker changes and interjections all occur.
  speaker: fc.constantFrom(0, 0, 0, 1, 1, 1, 2),
  // -3 s to +5 s after the previous Segment: overlaps, short gaps, gaps of 3 s and more.
  gap: fc.integer({ min: -24, max: 40 }),
  // 1/8 s to 12 s of speech.
  length: fc.integer({ min: 1, max: 96 }),
  // finalized at once (several Segments of one final block share finalizedAt) or up to 2 s later.
  delay: fc.constantFrom(0, 0, 0, 1, 4, 16),
  words: fc.integer({ min: 1, max: 3 }),
});

const monologueStep = fc.record({
  speaker: fc.constant(0),
  gap: fc.integer({ min: 0, max: 20 }),
  length: fc.integer({ min: 40, max: 120 }),
  delay: fc.constantFrom(0, 1, 8),
  words: fc.integer({ min: 1, max: 3 }),
});

/**
 * Sequences of finalized, contract-valid Segments in seam order: ids ascending, `finalizedAt` non-decreasing and never
 * before `end`, one Speaker per Segment, no Speaker overlapping their own speech. Mixes conversations (Speaker
 * changes, overlaps, pauses) with long monologues (beyond 180 s), so every end reason occurs.
 */
export function seamSequences(): fc.Arbitrary<Segment[]> {
  return fc
    .oneof(
      { weight: 4, arbitrary: fc.array(conversationStep, { minLength: 1, maxLength: 40 }) },
      { weight: 1, arbitrary: fc.array(monologueStep, { minLength: 10, maxLength: 30 }) },
    )
    .map((steps) => build(steps, ['A', 'B', 'C']));
}

/** A shift on the grid, up to about three hours. */
export function gridShift(): fc.Arbitrary<number> {
  return fc.integer({ min: 1, max: 80_000 }).map((units) => units / GRID);
}

/** Latencies on the grid: 0 s up to 12 s, often around the 5 s of a Tick. */
export function latencies(): fc.Arbitrary<number[]> {
  return fc.array(
    fc
      .oneof(fc.integer({ min: 0, max: 96 }), fc.constantFrom(0, 8, 40, 41, 48))
      .map((u) => u / GRID),
    { minLength: 1, maxLength: 12 },
  );
}
