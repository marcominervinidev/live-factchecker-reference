// The skip rule (ticket #28, AC9 to AC15 and AC17; docs/spec/erkennung-modellrollen.md 2; ADR 0004): every Tick of
// the Tick plan goes to both extractors. Per extractor and Turn at most one call is in flight; a non-final Tick that
// falls due during that call starts nothing and is counted and logged as skipped (`tick.skipped`), and the next call
// carries every Segment not yet sent (the `sent` cursor). A non-final Tick with no Segment beyond the cursor starts
// nothing and is not counted, checked before "in flight" (AC14 as the frozen tests pin it). The final analysis is
// never skipped: while a call is in flight it starts when that call returns.
//
// Reference: evals/src/harness/pipeline.py on_tick, on_return and the `sent` cursor of call_claim_extractor.
// Deviations: the harness checks "in flight" first (with Ticks from the Tick plan the order makes no difference, a
// non-final Tick always covers a new Segment); the pending final analysis is chained onto the call in flight instead
// of being started from an event queue. The scheduler runs on Session audio time: a Tick at its finalizedAt, a return
// at `at + latencySeconds` as the extractor reports it (measured live, scripted in tests); a return at a Tick's time,
// within the harness's tolerance of 1e-9, counts as returned. Turns are independent, so are the two extractors. The
// lane order needs no await; a Session awaits tick() only in a replay run. An extractor that rejects or throws (a
// programming error, the port never rejects otherwise) is logged as `extractor.failed` and its call is a lost Tick;
// once every lane of the Tick has settled, tick() rejects with the first original error in the order of
// ExtractorName, so the Session must catch it (owner decision 3 and F6 of 2026-11-03). drain() never rejects.
import type { Segment } from '@lfc/contracts';
import type { Logger } from '@lfc/service-kit';

import type { Tick } from './tick-plan.ts';
import type { Turn } from './types.ts';

/** The harness's role names (T8 reads the counts as skipped_ticks). */
export type ExtractorName = 'claim_extractor' | 'topic_extractor';

const EXTRACTORS: readonly ExtractorName[] = ['claim_extractor', 'topic_extractor'];

/**
 * The harness's float tolerance on the Session clock (evals/src/harness/pipeline.py: `busy_until > t + 1e-9` in
 * on_tick, `emitted_at <= t + 1e-9` in cards_until): a time that is a sum of latencies counts as reached at `t`.
 */
export const TIME_TOLERANCE = 1e-9;

export interface ExtractorCall {
  readonly turn: Turn;
  /** The Turn's Segments not yet sent to this extractor, in order. */
  readonly segments: readonly Segment[];
  readonly final: boolean;
  /** Session audio time at which the call starts. */
  readonly at: number;
}

/** The port the Claim Extractor (T4) and the Topic Extractor (T6) implement. */
export interface Extractor {
  /**
   * Resolves on every outcome of the call, an extractor error or a timeout included, with the time the call took
   * (`latencySeconds`, finite and at least 0). The outcome is the extractor's business (its own `model.called`
   * record, #26). Timeouts and abort belong to the adapter (T7) and must end the call before it resolves, so there
   * are never two calls in flight (AC13). Rejects only for a programming error; the scheduler then treats the call
   * as a lost Tick (`extractor.failed`, see handle) and tick() rejects with that error once the Tick has settled
   * (owner decision 3 of 2026-11-03).
   */
  call(call: ExtractorCall): Promise<{ readonly latencySeconds: number }>;
}

export interface TickScheduler {
  /** A Tick of the Tick plan, in order of the Turn events; resolves when what it starts has returned. When an
   * extractor rejected or threw, it rejects with the first such error (ExtractorName order) after every lane of the
   * Tick has settled; the lanes stay usable (owner decision 3 and F6 of 2026-11-03). */
  tick(tick: Tick): Promise<void>;
  /** Lets every call in flight return and runs what waits for it; waits for every lane, never rejects. */
  drain(): Promise<void>;
  readonly skippedTicks: Readonly<Record<ExtractorName, number>>;
}

/** An extractor's rejection or throw, wrapped so that a thrown `undefined` still counts as one. */
interface Failure {
  readonly error: unknown;
}

/** What one lane made of a Tick: when the lane is free again, and the extractor's error if its call failed. */
interface Handled {
  readonly busyUntil: number;
  readonly failure?: Failure;
}

/** One extractor and one Turn; freed once the Turn's final analysis has returned. */
interface Lane {
  /** Number of the Turn's Segments already sent. */
  sent: number;
  /** Resolves with the return time of the latest call, once every earlier Tick of this lane is handled. */
  returned: Promise<number>;
}

export function createTickScheduler(options: {
  readonly sessionId: string;
  readonly extractors: Readonly<Record<ExtractorName, Extractor>>;
  readonly logger: Logger;
}): TickScheduler {
  const { sessionId, extractors, logger } = options;
  const lanes = new Map<string, Lane>();
  const skipped: Record<ExtractorName, number> = { claim_extractor: 0, topic_extractor: 0 };

  const keyOf = (name: ExtractorName, turnId: string) => `${name} ${turnId}`;

  const laneOf = (name: ExtractorName, turnId: string): Lane => {
    const key = keyOf(name, turnId);
    const known = lanes.get(key);
    if (known !== undefined) return known;
    const fresh = { sent: 0, returned: Promise.resolve(-Infinity) };
    lanes.set(key, fresh);
    return fresh;
  };

  /** The extractor's latency (undefined when it reported none usable), or the error it rejected or threw with. */
  async function outcomeOf(
    name: ExtractorName,
    call: ExtractorCall,
  ): Promise<{ readonly latency: number | undefined; readonly failure?: Failure }> {
    try {
      const { latencySeconds } = await extractors[name].call(call);
      const usable = Number.isFinite(latencySeconds) && latencySeconds >= 0;
      return { latency: usable ? latencySeconds : undefined };
    } catch (error: unknown) {
      return { latency: undefined, failure: { error } };
    }
  }

  async function handle(
    name: ExtractorName,
    lane: Lane,
    tick: Tick,
    busyUntil: number,
  ): Promise<Handled> {
    if (!tick.final && tick.upto <= lane.sent) return { busyUntil };
    // The harness's float tolerance (evals/src/harness/pipeline.py on_tick: busy_until > t + 1e-9): a call at 0.1
    // with latency 0.2 has returned by a Tick at 0.3.
    const busy = busyUntil > tick.time + TIME_TOLERANCE;
    if (!tick.final && busy) {
      skipped[name] += 1;
      logger.log({ event: 'tick.skipped', sessionId, modelRole: name, turnId: tick.turn.id });
      return { busyUntil };
    }
    const at = busy ? busyUntil : tick.time;
    const segments = tick.turn.segments.slice(lane.sent, tick.upto);
    const { latency, failure } = await outcomeOf(name, {
      turn: tick.turn,
      segments,
      final: tick.final,
      at,
    });
    // Frees the lane once the final analysis has returned (S4); not observable through the frozen interface, so
    // covered by code review, not by a test.
    if (tick.final) lanes.delete(keyOf(name, tick.turn.id));
    if (latency === undefined) {
      // A lost Tick (docs/spec/erkennung-modellrollen.md 4.2): the cursor stays, so the next call carries these
      // Segments again. The call counts as returned at its start `at`: the scheduler knows no time the call took and
      // invents none, and the lane is free for the next Tick at once. One fixed event, never the error or its text;
      // the error itself goes back to tick() (owner decision 3 of 2026-11-03), an unusable latency has none.
      logger.log({ event: 'extractor.failed', sessionId, modelRole: name, turnId: tick.turn.id });
      return failure === undefined ? { busyUntil: at } : { busyUntil: at, failure };
    }
    lane.sent = tick.upto;
    return { busyUntil: at + latency };
  }

  return {
    async tick(tick) {
      const handled = EXTRACTORS.map((name) => {
        const lane = laneOf(name, tick.turn.id);
        const outcome = lane.returned.then((busyUntil) => handle(name, lane, tick, busyUntil));
        lane.returned = outcome.then(({ busyUntil }) => busyUntil);
        return outcome;
      });
      // Every lane settles first; then the first failure in ExtractorName order, not in time (owner decision
      // F6 of 2026-11-03: deterministic, the order in time depends on latencies).
      const failure = (await Promise.all(handled)).find((h) => h.failure !== undefined)?.failure;
      if (failure !== undefined) throw failure.error;
    },
    async drain() {
      await Promise.allSettled([...lanes.values()].map((lane) => lane.returned));
    },
    get skippedTicks() {
      return { ...skipped };
    },
  };
}
