// Stage 1, @issue-28 (T3), Task 2: properties of Tick plan and skip rule over generated sequences of finalized
// Segments in seam order (fast-check): AC17, the Tick and count half of AC16, and AC9 to AC15 as invariants. Each
// generated sequence runs through Turn building, Tick plan and scheduler the way the Session drives them (Task 3):
// every Turn event to the Tick plan, every Tick to the scheduler, then the end of the Input and drain(). The fake
// extractors report generated latencies on the 1/8 s grid (0 s up to 12 s), so a call can return exactly when a Tick
// falls due. Interfaces: turn-builder.test.ts, tick-plan.test.ts, tick-scheduler.test.ts.
import { createTickScheduler, type Extractor, type ExtractorName } from './tick-scheduler.ts';
import { createTickPlan, type Tick } from './tick-plan.ts';
import { createTurnBuilder } from './turn-builder.ts';
// After the modules under test on purpose: their absence is the red reason (tools/classify_red_reason.py).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  gridShift,
  latencies,
  seamSequences,
  SESSION,
  shifted,
  START_VALUES,
} from '../testing/turns.ts';
import { createLogger } from '@lfc/service-kit';
import type { Segment } from '@lfc/contracts';
import type { EndedTurn, TurnEvent } from './types.ts';

const RUNS = { numRuns: 200 };
const EXTRACTORS: readonly ExtractorName[] = ['claim_extractor', 'topic_extractor'];

interface Call {
  readonly extractor: ExtractorName;
  readonly turn: string;
  readonly segments: readonly string[];
  readonly final: boolean;
  readonly at: number;
  readonly returns: number;
}

function fake(name: ExtractorName, script: readonly number[], calls: Call[]): Extractor {
  let index = 0;
  return {
    call({ turn, segments, final, at }) {
      const latencySeconds = script[index % script.length] ?? 0;
      index += 1;
      calls.push({
        extractor: name,
        turn: turn.id,
        segments: segments.map((s) => s.id),
        final,
        at,
        returns: at + latencySeconds,
      });
      return Promise.resolve({ latencySeconds });
    },
  };
}

async function replay(
  segments: readonly Segment[],
  claim: readonly number[],
  topic: readonly number[],
) {
  const builder = createTurnBuilder(START_VALUES);
  const plan = createTickPlan(START_VALUES);
  const calls: Call[] = [];
  const lines: string[] = [];
  const scheduler = createTickScheduler({
    sessionId: SESSION,
    extractors: {
      claim_extractor: fake('claim_extractor', claim, calls),
      topic_extractor: fake('topic_extractor', topic, calls),
    },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  const ticks: Tick[] = [];
  const turns: EndedTurn[] = [];
  const handle = async (events: readonly TurnEvent[]) => {
    for (const event of events) {
      if (event.kind === 'turn-ended') turns.push(event.turn);
      for (const tick of plan.next(event)) {
        ticks.push(tick);
        await scheduler.tick(tick);
      }
    }
  };
  for (const segment of segments) await handle(builder.push(segment));
  await handle(builder.end());
  await scheduler.drain();
  return { ticks, turns, calls, lines, skipped: { ...scheduler.skippedTicks } };
}

const view = (t: Tick) => ({ turn: t.turn.id, time: t.time, upto: t.upto, final: t.final });

const input = fc.record({ segments: seamSequences(), claim: latencies(), topic: latencies() });

describe('Tick plan and skip rule on any seam sequence (AC17) @ac-17', () => {
  it('sends every Segment of a Turn to each extractor exactly once and in order, over all its calls', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const { turns, calls } = await replay(segments, claim, topic);
        for (const turn of turns) {
          for (const name of EXTRACTORS) {
            const sent = calls
              .filter((c) => c.extractor === name && c.turn === turn.id)
              .flatMap((c) => c.segments);
            expect(sent).toEqual(turn.segments.map((s) => s.id));
          }
        }
      }),
      RUNS,
    );
  });

  it('lets at most one non-final Tick per full 5 s of a Turn’s speech fall due', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const { turns, ticks } = await replay(segments, claim, topic);
        for (const turn of turns) {
          const speech = turn.segments.reduce((sum, s) => sum + (s.end - s.start), 0);
          const nonFinal = ticks.filter((t) => t.turn.id === turn.id && !t.final).length;
          expect(nonFinal).toBeLessThanOrEqual(Math.floor(speech / START_VALUES.tickSeconds));
        }
      }),
      RUNS,
    );
  });

  it('keeps the Tick times of a Turn in order and makes the final analysis its one and last Tick', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const { turns, ticks } = await replay(segments, claim, topic);
        for (const turn of turns) {
          const own = ticks.filter((t) => t.turn.id === turn.id);
          const times = own.map((t) => t.time);
          expect(times).toEqual([...times].sort((a, b) => a - b));
          expect(own.filter((t) => t.final)).toHaveLength(1);
          expect(own.at(-1)?.final).toBe(true);
        }
      }),
      RUNS,
    );
  });
});

describe('the skip rule as invariants (AC9 to AC15) @ac-9 @ac-10 @ac-11 @ac-12 @ac-13 @ac-14 @ac-15', () => {
  it('never runs two calls of one extractor for one Turn at once', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const { calls } = await replay(segments, claim, topic);
        for (const name of EXTRACTORS) {
          for (const id of new Set(calls.map((c) => c.turn))) {
            const own = calls.filter((c) => c.extractor === name && c.turn === id);
            own.slice(1).forEach((c, i) => {
              expect(c.at).toBeGreaterThanOrEqual(own[i]?.returns ?? Number.NaN);
            });
          }
        }
      }),
      RUNS,
    );
  });

  it('runs exactly one final analysis per extractor and Turn, at its Tick or when the call before it returns', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const { turns, ticks, calls } = await replay(segments, claim, topic);
        for (const turn of turns) {
          const finalTick = ticks.find((t) => t.turn.id === turn.id && t.final);
          for (const name of EXTRACTORS) {
            const own = calls.filter((c) => c.extractor === name && c.turn === turn.id);
            const finals = own.filter((c) => c.final);
            expect(finals).toHaveLength(1);
            expect(own.at(-1)?.final).toBe(true);
            const before = own.at(-2)?.returns ?? -Infinity;
            expect(finals[0]?.at).toBe(Math.max(finalTick?.time ?? Number.NaN, before));
          }
        }
      }),
      RUNS,
    );
  });

  it('either calls or counts as skipped every non-final Tick, for each extractor on its own', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const { ticks, calls, skipped } = await replay(segments, claim, topic);
        const nonFinal = ticks.filter((t) => !t.final).length;
        for (const name of EXTRACTORS) {
          const own = calls.filter((c) => c.extractor === name);
          expect(own.filter((c) => !c.final).length + skipped[name]).toBe(nonFinal);
          expect(own.length).toBe(ticks.length - skipped[name]);
        }
      }),
      RUNS,
    );
  });

  it('writes one tick.skipped event per skipped Tick, naming the Session, the extractor and a Turn of the Session', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const { turns, lines, skipped } = await replay(segments, claim, topic);
        const events = lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((e) => e['event'] === 'tick.skipped');
        const turnIds = new Set(turns.map((t) => t.id));
        for (const name of EXTRACTORS) {
          const own = events.filter((e) => Object.values(e).includes(name));
          expect(own).toHaveLength(skipped[name]);
          for (const e of own) {
            expect(e['sessionId']).toBe(SESSION);
            expect(Object.values(e).some((v) => typeof v === 'string' && turnIds.has(v))).toBe(
              true,
            );
          }
        }
      }),
      RUNS,
    );
  });
});

describe('Ticks and counts are a function of the input (AC16) @ac-16', () => {
  it('yields the same Ticks, calls and counts from the same input every time', async () => {
    await fc.assert(
      fc.asyncProperty(input, async ({ segments, claim, topic }) => {
        const once = await replay(segments, claim, topic);
        const again = await replay(segments, claim, topic);
        expect(again.ticks.map(view)).toEqual(once.ticks.map(view));
        expect(again.calls).toEqual(once.calls);
        expect(again.skipped).toEqual(once.skipped);
      }),
      RUNS,
    );
  });

  it('moves every Tick and call by the same amount and changes nothing else when all times are shifted', async () => {
    await fc.assert(
      fc.asyncProperty(input, gridShift(), async ({ segments, claim, topic }, by) => {
        const plain = await replay(segments, claim, topic);
        const moved = await replay(
          segments.map((s) => shifted(s, by)),
          claim,
          topic,
        );
        expect(moved.ticks.map((t) => ({ ...view(t), time: t.time - by }))).toEqual(
          plain.ticks.map(view),
        );
        expect(moved.calls.map((c) => ({ ...c, at: c.at - by, returns: c.returns - by }))).toEqual(
          plain.calls,
        );
        expect(moved.skipped).toEqual(plain.skipped);
        expect(moved.turns.map((t) => [t.endReason, t.segments.map((s) => s.id)])).toEqual(
          plain.turns.map((t) => [t.endReason, t.segments.map((s) => s.id)]),
        );
      }),
      RUNS,
    );
  });
});
