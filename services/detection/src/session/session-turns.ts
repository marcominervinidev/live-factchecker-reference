// Turn building of one Session (ticket #28, task 3; docs/spec/erkennung-modellrollen.md 2): the Session owns one Turn
// builder, one Tick plan and one Tick scheduler and drives them from the segment seam. Each finalized Segment goes to
// the builder, each Turn event to the Tick plan, each Tick to the scheduler, which calls the extractor ports. Turns,
// Ticks and the skipped-Tick counts stay in process memory (derived state, never stored; the Segment stream in Redis
// stays the only owner). Wired into the Session routes by #29 task 3 (session-pipelines.ts).
// Errors: tick() rejects with an extractor's programming error once its Tick has settled (owner decision 3 of
// 2026-11-03). The Session catches that rejection per Tick and logs it once as `tick.failed` with the Session id and
// the Turn id, never the error (#29 AC22; gate 1 of #29, question 7: „Angenommen, mit Log-Ereignis `tick.failed`“), so
// accept() and end() resolve once every Tick has settled, later Ticks still reach both extractors and no rejection
// goes unhandled.
import type { Segment } from '@lfc/contracts';
import type { Logger } from '@lfc/service-kit';

import { createTickPlan, type Tick } from '../turns/tick-plan.ts';
import {
  createTickScheduler,
  type Extractor,
  type ExtractorName,
} from '../turns/tick-scheduler.ts';
import { createTurnBuilder } from '../turns/turn-builder.ts';
import type { EndedTurn, Turn, TurnEvent, TurnParameters } from '../turns/types.ts';

export interface SessionTurns {
  /** One finalized Segment from the segment seam, in seam order; resolves once its Ticks have settled. */
  accept(segment: Segment): Promise<void>;
  /** The end of the Input; resolves once every call has returned. */
  end(): Promise<void>;
  /** Resolves once every call in flight has returned; starts no final analysis (the stop of the process). */
  settle(): Promise<void>;
  /** The Turns whose end is known (after end(): every Turn). */
  readonly turns: readonly EndedTurn[];
  /** Every Turn seen so far, open or ended, each once in its latest state (the context of a call, #29 AC5). */
  readonly seen: readonly Turn[];
  /** Every Tick, in the order it fell due. */
  readonly ticks: readonly Tick[];
  readonly skippedTicks: Readonly<Record<ExtractorName, number>>;
}

export function createSessionTurns(options: {
  readonly sessionId: string;
  readonly parameters: TurnParameters;
  readonly extractors: Readonly<Record<ExtractorName, Extractor>>;
  readonly logger: Logger;
}): SessionTurns {
  const { sessionId, parameters, extractors, logger } = options;
  const builder = createTurnBuilder(parameters);
  const plan = createTickPlan(parameters);
  const scheduler = createTickScheduler({ sessionId, extractors, logger });
  const turns: EndedTurn[] = [];
  const seen = new Map<string, Turn>();
  const ticks: Tick[] = [];

  /** One Tick, its rejection caught and logged once (AC22). */
  async function caught(tick: Tick): Promise<void> {
    try {
      await scheduler.tick(tick);
    } catch {
      logger.log({ event: 'tick.failed', sessionId, turnId: tick.turn.id });
    }
  }

  /** Hands every Tick of the events to the scheduler, in order, then waits for all of them to settle. */
  async function run(events: readonly TurnEvent[]): Promise<void> {
    const started: Promise<void>[] = [];
    for (const event of events) {
      seen.set(event.turn.id, event.turn);
      if (event.kind === 'turn-ended') turns.push(event.turn);
      for (const tick of plan.next(event)) {
        ticks.push(tick);
        started.push(caught(tick));
      }
    }
    await Promise.all(started);
  }

  return {
    async accept(segment) {
      await run(builder.push(segment));
    },
    async end() {
      try {
        await run(builder.end());
      } finally {
        await scheduler.drain();
      }
    },
    async settle() {
      await scheduler.drain();
    },
    turns,
    get seen() {
      return [...seen.values()];
    },
    ticks,
    get skippedTicks() {
      return scheduler.skippedTicks;
    },
  };
}
