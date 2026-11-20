// The Tick plan (ticket #28, AC8 and AC9; docs/spec/erkennung-modellrollen.md 2; ADR 0002, ADR 0004): from the Turn
// events it decides when a Tick of a Turn falls due. A non-final Tick falls due at the finalizedAt of the Segment with
// which the Turn's summed speech time (end minus start of each Segment) reaches the next multiple of tickSeconds; a
// Segment crossing several multiples yields one Tick. Every Turn, an interjection or a single word included, gets
// exactly one final analysis at its endKnownAt, never before its last Segment's finalizedAt; no length or word filter.
//
// Reference: evals/src/harness/turns.py tick_plan (audio mode, a Segment counts from its finalizedAt). Deviation: it
// runs on the event stream instead of a finished Turn, so the speech time is kept per open Turn; the events of two
// Turns may interleave (the Turn builder appends to the ongoing Turn after an interjection has ended). A non-final Tick
// and the final analysis at the same time both fall due (parity with the harness, ticket #28 Assumptions).
// Knowable times (owner decision F2 of 2026-11-03): a non-final Tick never falls due before the latest time
// the Turn events have shown so far (a finalizedAt or an endKnownAt). With Segments in seam order that changes
// nothing, except for a held-back run released later as no interjection: its Ticks fall due at the release. An
// interjection's events arrive together when it is decided, its end included, so its non-final Ticks wait for that
// end and fall due with its final analysis. The harness and AC8 read literally say the Segment's finalizedAt.
// Pure: no I/O, no timers, no clock of its own.
import type { Turn, TurnEvent, TurnParameters } from './types.ts';

export interface Tick {
  /** The Turn as far as it is known when the Tick falls due (all its Segments for the final analysis). */
  readonly turn: Turn;
  /** Session audio time, seconds, at which the Tick falls due. */
  readonly time: number;
  /** Number of the Turn's Segments it covers. */
  readonly upto: number;
  /** The final analysis of the Turn. */
  readonly final: boolean;
}

export interface TickPlan {
  /** The Ticks that fall due with this Turn event, in order. */
  next(event: TurnEvent): readonly Tick[];
}

interface Speech {
  /** Summed speech time of the Turn's Segments so far. */
  seconds: number;
  /** The next multiple of tickSeconds a Tick waits for. */
  threshold: number;
  /** An interjection's non-final Ticks, due once its end is known (owner decision F2 of 2026-11-03). */
  readonly waiting: Tick[];
}

export function createTickPlan(parameters: TurnParameters): TickPlan {
  const { tickSeconds } = parameters;
  const open = new Map<string, Speech>();
  /** The latest Session audio time the Turn events have shown (owner decision F2 of 2026-11-03). */
  let latest = -Infinity;

  const speechOf = (id: string): Speech => {
    const known = open.get(id);
    if (known !== undefined) return known;
    const fresh: Speech = { seconds: 0, threshold: tickSeconds, waiting: [] };
    open.set(id, fresh);
    return fresh;
  };

  return {
    next(event) {
      switch (event.kind) {
        case 'turn-opened':
          speechOf(event.turn.id);
          return [];
        case 'segment-appended': {
          const speech = speechOf(event.turn.id);
          latest = Math.max(latest, event.segment.finalizedAt);
          speech.seconds += event.segment.end - event.segment.start;
          if (speech.seconds < speech.threshold) return [];
          while (speech.threshold <= speech.seconds) speech.threshold += tickSeconds;
          const { turn } = event;
          const tick = { turn, time: latest, upto: turn.segments.length, final: false };
          if (!turn.interjection) return [tick];
          speech.waiting.push(tick);
          return [];
        }
        case 'turn-ended': {
          const { turn } = event;
          const waiting = open.get(turn.id)?.waiting ?? [];
          open.delete(turn.id);
          const time = Math.max(turn.endKnownAt, ...turn.segments.map((s) => s.finalizedAt));
          latest = Math.max(latest, time);
          return [
            ...waiting.map((tick) => ({ ...tick, time })),
            { turn, time, upto: turn.segments.length, final: true },
          ];
        }
      }
    },
  };
}
