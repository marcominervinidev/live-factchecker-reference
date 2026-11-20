// Turn building (ticket #28, AC1 to AC7 and AC16; docs/spec/erkennung-modellrollen.md 2 and 8; ADR 0004): final
// Segments in seam order become Turns, each with an end reason and the time its end could be known.
//
// Reference: evals/src/harness/turns.py build_turns (audio mode). Turn membership and end reasons are the same:
// - same Speaker: a gap of turnPauseEndSeconds or more from the end of the Turn so far ends it (`pause`), else a
//   Segment that would make it longer than turnMaxSeconds ends it (`max_length`); the pause is checked first;
// - another Speaker starting at or after the end of the ongoing Turn ends it (`speaker_change`);
// - another Speaker starting before that end (overlap from start and end only, ADR 0005 addendum 2026-10-25) is an
//   interjection when the run of that Speaker lasts under interjectionMaxSeconds and the first Speaker resumes within
//   turnPauseEndSeconds of the end of the ongoing Turn: a Turn of its own, marked interjection, ended `interjection`;
//   the ongoing Turn continues. Otherwise the ongoing Turn ends with `speaker_change`;
// - the end of the Input ends the open Turn (`stream_end`).
// Deviations (knowable times, the ticket's first Assumption): the builder sees no Segment ahead, so a decision falls
// at the Segment that proves it, or at the end of the Input, and endKnownAt is the latest finalizedAt seen by then.
// That equals the ticket's "harness time or finalizedAt, whichever is later": finalizedAt >= end (docs/spec/inputs.md
// 4.1) and every harness time is at most the end of the proving Segment, so the harness time never wins.
// The harness takes earlier times from its foresight at pause (end plus pause), maximum length, overlap (run start
// plus interjectionMaxSeconds) and interjection (at its own finalizedAt); at a speaker change without overlap it
// already uses max(start, finalized_at) of the other Speaker, the same value as here. T8 and T9 report the difference.
// The run of a possible interjection is held back until it is decided, so a Segment once in a Turn never moves and
// nothing is appended to a Turn whose end is known.
// Bounds: a held run is bounded by time (its span stays under interjectionMaxSeconds) and by count: the Segment with
// which it would exceed maxHeldSegments (default 200) decides at once that it is no interjection, like a run that
// lasts too long (owner decision 1 of 2026-11-03, security finding S1; a named deviation from AC4 for hostile
// Input only). Releasing a run emits one `segment-appended` event per Segment, each with its own snapshot of the
// Turn's Segments, so one push() returns at most about K²/2 Segment references for the run, never more with its
// length. Run and Turn bounds (start, latest end) are kept as Segments arrive, never recomputed over the run.
// Pure: no I/O, no timers, no clock of its own.
import type { Segment } from '@lfc/contracts';

import type { EndReason, Turn, TurnBuilderParameters, TurnEvent } from './types.ts';

export interface TurnBuilder {
  /** One final Segment, in seam order; returns what it decides. */
  push(segment: Segment): readonly TurnEvent[];
  /** The end of the Input: ends whatever is still open. */
  end(): readonly TurnEvent[];
}

interface OpenTurn {
  readonly id: string;
  readonly speaker: string;
  readonly interjection: boolean;
  readonly segments: Segment[];
  /** Start of the first Segment (the reference's Turn.start). */
  readonly start: number;
  /** End of the latest word so far (the reference's Turn.end). */
  end: number;
}

/** A run of one Speaker's Segments that may still be an interjection; never empty, bounds kept as it grows. */
interface HeldRun {
  readonly speaker: string;
  readonly segments: [Segment, ...Segment[]];
  /** Start of the first Segment. */
  readonly start: number;
  /** End of the latest word so far. */
  end: number;
}

function snapshot(turn: OpenTurn): Turn {
  const { id, speaker, interjection } = turn;
  return { id, speaker, interjection, segments: [...turn.segments] };
}

/** Default of maxHeldSegments (owner decision 1 of 2026-11-03). */
const MAX_HELD_SEGMENTS = 200;

/** Throws on a builder parameter that is no integer of at least 1, naming it (as the configuration names TURN_*). */
function wholeCount(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Turn builder: ${name} must be an integer of at least 1`);
  }
  return value;
}

export function createTurnBuilder(parameters: TurnBuilderParameters): TurnBuilder {
  const { turnPauseEndSeconds, turnMaxSeconds, interjectionMaxSeconds } = parameters;
  const maxHeldSegments = wholeCount(
    'maxHeldSegments',
    parameters.maxHeldSegments ?? MAX_HELD_SEGMENTS,
  );
  let counter = 0;
  let current: OpenTurn | undefined;
  /** The other Speaker's run that overlaps `current` and may still be an interjection. */
  let held: HeldRun | undefined;
  /** The latest finalizedAt seen: the time every decision is known at. */
  let knownAt = 0;
  let inputEnded = false;
  /** Sink of the running push() or end() call; a fresh array per call, so a returned one is never kept here. */
  let events: TurnEvent[] = [];

  /** Opens a Turn with its first Segment: `turn-opened` (no Segment yet), then `segment-appended`. */
  function open(first: Segment, interjection: boolean): OpenTurn {
    counter += 1;
    const id = `t-${String(counter).padStart(3, '0')}`;
    const turn: OpenTurn = {
      id,
      speaker: first.speaker,
      interjection,
      segments: [],
      start: first.start,
      end: first.end,
    };
    events.push({ kind: 'turn-opened', turn: snapshot(turn) });
    append(turn, first);
    return turn;
  }

  function append(turn: OpenTurn, segment: Segment): void {
    turn.end = Math.max(turn.end, segment.end);
    turn.segments.push(segment);
    events.push({ kind: 'segment-appended', turn: snapshot(turn), segment });
  }

  function close(turn: OpenTurn, endReason: EndReason): void {
    events.push({
      kind: 'turn-ended',
      turn: { ...snapshot(turn), endReason, endKnownAt: knownAt },
    });
  }

  /** One step of the reference loop for a Segment that is not part of a held run. */
  function place(segment: Segment): void {
    if (current === undefined) {
      current = open(segment, false);
    } else if (segment.speaker === current.speaker) {
      const reason: EndReason | undefined =
        segment.start - current.end >= turnPauseEndSeconds
          ? 'pause'
          : segment.end - current.start > turnMaxSeconds
            ? 'max_length'
            : undefined;
      if (reason === undefined) {
        append(current, segment);
      } else {
        close(current, reason);
        current = open(segment, false);
      }
    } else if (segment.start < current.end) {
      hold(segment);
    } else {
      close(current, 'speaker_change');
      current = open(segment, false);
    }
  }

  /** Holds a Segment of a possible interjection; a run of interjectionMaxSeconds or more is none, and so is a run
   * of more than maxHeldSegments Segments (owner decision 1 of 2026-11-03). */
  function hold(segment: Segment): void {
    let run = held;
    if (run === undefined) {
      run = {
        speaker: segment.speaker,
        segments: [segment],
        start: segment.start,
        end: segment.end,
      };
      held = run;
    } else {
      run.segments.push(segment);
      run.end = Math.max(run.end, segment.end);
    }
    if (run.end - run.start >= interjectionMaxSeconds || run.segments.length > maxHeldSegments) {
      release(run);
    }
  }

  /** The held run is no interjection: the ongoing Turn ends, the run is placed as ordinary speech. */
  function release(run: HeldRun): void {
    held = undefined;
    if (current !== undefined) close(current, 'speaker_change');
    current = undefined;
    for (const segment of run.segments) place(segment);
  }

  /** The held run is an interjection: a Turn of its own; the ongoing Turn continues. */
  function interject(run: HeldRun): void {
    held = undefined;
    const [first, ...rest] = run.segments;
    const turn = open(first, true);
    for (const segment of rest) append(turn, segment);
    close(turn, 'interjection');
  }

  function decide(segment: Segment): void {
    if (held === undefined || current === undefined) {
      place(segment);
    } else if (segment.speaker === held.speaker) {
      hold(segment);
    } else {
      const resumes =
        segment.speaker === current.speaker && segment.start - current.end < turnPauseEndSeconds;
      if (resumes) interject(held);
      else release(held);
      place(segment);
    }
  }

  /** Runs one step with a local event array and detaches it from the closure before returning it. */
  function collect(step: () => void): readonly TurnEvent[] {
    const out: TurnEvent[] = [];
    events = out;
    try {
      step();
    } finally {
      events = [];
    }
    return out;
  }

  return {
    push(segment) {
      if (inputEnded) throw new Error('Turn builder: a Segment after the end of the Input');
      knownAt = Math.max(knownAt, segment.finalizedAt);
      return collect(() => {
        decide(segment);
      });
    },
    end() {
      inputEnded = true;
      return collect(() => {
        if (held !== undefined) release(held);
        if (current !== undefined) close(current, 'stream_end');
        current = undefined;
      });
    },
  };
}
