// Types of Turn building (ticket #28, docs/spec/erkennung-modellrollen.md 2 and 8; ADR 0004): Turns made of final
// Segments, why each one ended and when that end could be known, and the events the Turn builder reports.
import type { Segment } from '@lfc/contracts';

/** The harness's `end_reason` strings (evals/src/harness/turns.py); `stream_end` is kept for T8 parity although the
 * glossary says Input. */
export type EndReason = 'pause' | 'max_length' | 'speaker_change' | 'interjection' | 'stream_end';

/** Seconds; the start values of spec 8 are 5, 3, 180 and 2. */
export interface TurnParameters {
  readonly tickSeconds: number;
  readonly turnPauseEndSeconds: number;
  readonly turnMaxSeconds: number;
  readonly interjectionMaxSeconds: number;
}

/** The Turn builder's parameters: spec 8's plus a guard that is no measurement variable. */
export interface TurnBuilderParameters extends TurnParameters {
  /**
   * Most Segments a held-back run may have and still be an interjection; one more decides at once that it is none.
   * An integer of at least 1, default 200 when absent. Owner decision 1 of 2026-11-03 (security finding S1
   * of #28 task 1): a named deviation from AC4 for hostile Input only; real speech never has 200 Segments under 2 s.
   */
  readonly maxHeldSegments?: number;
}

export interface Turn {
  readonly id: string;
  readonly speaker: string;
  readonly interjection: boolean;
  readonly segments: readonly Segment[];
}

export interface EndedTurn extends Turn {
  readonly endReason: EndReason;
  /** Seconds of Session audio time at which the end could be known. */
  readonly endKnownAt: number;
}

export type TurnEvent =
  /** The Turn before its first Segment. */
  | { readonly kind: 'turn-opened'; readonly turn: Turn }
  /** The Turn with the Segment in it. */
  | { readonly kind: 'segment-appended'; readonly turn: Turn; readonly segment: Segment }
  /** Every Segment of the Turn, in order. */
  | { readonly kind: 'turn-ended'; readonly turn: EndedTurn };
