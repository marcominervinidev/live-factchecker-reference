// Stage 1, @issue-28 (T3), Task 2, implementer-owned (review round 1): a failing extractor never poisons a lane
// (findings R1/A1/S1, S3) and the harness's float tolerance (R2). The freed lane (S4) is not observable from outside
// the frozen interface and is covered by code review. A rejection, a synchronous throw
// or a latency that is not finite and at least 0 is a lost Tick: logged once as `extractor.failed` without the error,
// the `sent` cursor stays, the call counts as returned at its start, and drain() never rejects. tick() rejects with the
// error of a rejection or throw once the Tick has settled (pending owner decision 3 of 2026-10-30; the cases on that
// contract are in tick-scheduler.rethrow.test.ts), never for an unusable latency.
import { describe, expect, it } from 'vitest';

import { createTickScheduler, type Extractor, type ExtractorCall } from './tick-scheduler.ts';
import { seg, SESSION, sid } from '../testing/turns.ts';
import { createLogger } from '@lfc/service-kit';
import type { Segment } from '@lfc/contracts';
import type { Tick } from './tick-plan.ts';
import type { EndedTurn, Turn } from './types.ts';

const TRANSCRIPT_WORD = 'Mietpreisbremse';
const A: Segment[] = Array.from({ length: 4 }, (_, i) =>
  seg(sid(i + 1), 'A', i * 2.5, (i + 1) * 2.5, (i + 1) * 2.5, `${TRANSCRIPT_WORD} wirkt kaum`),
);

function turn(id: string, segments: readonly Segment[]): Turn {
  return { id, speaker: 'A', interjection: false, segments };
}

function tick(id: string, time: number, upto: number): Tick {
  return { turn: turn(id, A.slice(0, upto)), time, upto, final: false };
}

function final(id: string, time: number, count: number): Tick {
  const ended: EndedTurn = {
    ...turn(id, A.slice(0, count)),
    endReason: 'stream_end',
    endKnownAt: time,
  };
  return { turn: ended, time, upto: count, final: true };
}

type Behaviour = (call: ExtractorCall) => Promise<{ readonly latencySeconds: number }>;

interface Seen {
  readonly turn: string;
  readonly segments: string;
  readonly final: boolean;
  readonly at: number;
}

/** A claim extractor that behaves as scripted per call (the last behaviour repeats); the topic extractor returns at once. */
function setup(...script: Behaviour[]) {
  const seen: Seen[] = [];
  const lines: string[] = [];
  let index = 0;
  const claim: Extractor = {
    call(call) {
      seen.push({
        turn: call.turn.id,
        segments: call.segments.map((s) => `s-${String(A.indexOf(s) + 1)}`).join(' '), // short: s-<n> for A[n - 1]
        final: call.final,
        at: call.at,
      });
      const behaviour = script[Math.min(index, script.length - 1)];
      index += 1;
      if (behaviour === undefined) throw new Error('no script');
      return behaviour(call);
    },
  };
  const topic: Extractor = { call: () => Promise.resolve({ latencySeconds: 0 }) };
  const scheduler = createTickScheduler({
    sessionId: SESSION,
    extractors: { claim_extractor: claim, topic_extractor: topic },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  const events = (name: string) =>
    lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e['event'] === name);
  return { scheduler, seen, lines, events };
}

const ok =
  (latencySeconds: number): Behaviour =>
  () =>
    Promise.resolve({ latencySeconds });
const rejects: Behaviour = () => Promise.reject(new Error(`model said: ${TRANSCRIPT_WORD}`));
const throws: Behaviour = () => {
  throw new Error(`model said: ${TRANSCRIPT_WORD}`);
};

describe('createTickScheduler: a failing extractor is a lost Tick, never a poisoned lane', () => {
  it('runs the final analysis after a rejected call, carrying the Segments of the lost call again', async () => {
    const { scheduler, seen } = setup(rejects, ok(1));
    await expect(scheduler.tick(tick('t-a', 5, 2))).rejects.toThrow(TRANSCRIPT_WORD);
    await expect(scheduler.tick(final('t-a', 10, 4))).resolves.toBeUndefined();
    await expect(scheduler.drain()).resolves.toBeUndefined();
    expect(seen).toEqual([
      { turn: 't-a', segments: 's-1 s-2', final: false, at: 5 },
      { turn: 't-a', segments: 's-1 s-2 s-3 s-4', final: true, at: 10 },
    ]);
  });

  it('treats a synchronous throw like a rejection', async () => {
    const { scheduler, seen, events } = setup(throws, ok(1));
    await expect(scheduler.tick(tick('t-a', 5, 2))).rejects.toThrow(TRANSCRIPT_WORD);
    await expect(scheduler.tick(final('t-a', 10, 4))).resolves.toBeUndefined();
    await expect(scheduler.drain()).resolves.toBeUndefined();
    expect(seen.map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, 's-1 s-2', false],
      [10, 's-1 s-2 s-3 s-4', true],
    ]);
    expect(events('extractor.failed')).toHaveLength(1);
  });

  it('counts the failed call as returned at its start: a Tick right after it starts a call, none is skipped', async () => {
    const { scheduler, seen } = setup(rejects, ok(1));
    await expect(scheduler.tick(tick('t-a', 5, 2))).rejects.toThrow(TRANSCRIPT_WORD);
    await scheduler.tick(tick('t-a', 5.5, 3));
    await scheduler.drain();
    expect(seen.map((c) => [c.at, c.segments])).toEqual([
      [5, 's-1 s-2'],
      [5.5, 's-1 s-2 s-3'],
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('logs one fixed extractor.failed event with Session, extractor and Turn only, and no error text in any line', async () => {
    const { scheduler, lines, events } = setup(rejects, throws);
    await expect(scheduler.tick(tick('t-a', 5, 2))).rejects.toThrow(TRANSCRIPT_WORD);
    await expect(scheduler.tick(final('t-a', 10, 4))).rejects.toThrow(TRANSCRIPT_WORD);
    await scheduler.drain();
    const failed = events('extractor.failed');
    expect(failed).toHaveLength(2);
    for (const event of failed) {
      expect(Object.keys(event).sort()).toEqual(
        ['event', 'modelRole', 'service', 'sessionId', 'time', 'turnId'].sort(),
      );
      expect(event).toMatchObject({
        sessionId: SESSION,
        modelRole: 'claim_extractor',
        turnId: 't-a',
      });
    }
    for (const line of lines) {
      expect(line).not.toContain(TRANSCRIPT_WORD);
      expect(line).not.toContain('model said');
      expect(line).not.toMatch(/error|stack|cause/i);
    }
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-1', -1],
  ])('treats a reported latency of %s like a failed call', async (_name, latency) => {
    const { scheduler, seen, events } = setup(ok(latency), ok(1));
    await scheduler.tick(tick('t-a', 5, 2));
    await scheduler.tick(tick('t-a', 7.5, 3));
    await scheduler.tick(final('t-a', 10, 4));
    await scheduler.drain();
    expect(seen.map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, 's-1 s-2', false],
      [7.5, 's-1 s-2 s-3', false],
      [10, 's-4', true],
    ]);
    expect(events('extractor.failed')).toHaveLength(1);
    expect(scheduler.skippedTicks.claim_extractor).toBe(0);
  });

  it('lets drain() wait for every lane, a failing one included, and never reject', async () => {
    /** One deferred outcome per Turn, settled explicitly by the test. */
    const deferred = new Map<
      string,
      { settle: () => void; promise: Promise<{ latencySeconds: number }> }
    >();
    for (const [id, fails] of [
      ['t-a', false],
      ['t-b', true],
      ['t-c', false],
    ] as const) {
      let settle: () => void = () => {
        throw new Error('not yet bound');
      };
      const promise = new Promise<{ latencySeconds: number }>((resolve, reject) => {
        settle = () => {
          if (fails) reject(new Error(TRANSCRIPT_WORD));
          else resolve({ latencySeconds: 1 });
        };
      });
      deferred.set(id, { settle, promise });
    }
    const byTurn: Behaviour = (call) =>
      deferred.get(call.turn.id)?.promise ?? Promise.reject(new Error('no turn'));
    const { scheduler, seen } = setup(byTurn);
    const ticks = ['t-a', 't-b', 't-c'].map((id) => scheduler.tick(final(id, 5, 2)));
    let drained = false;
    const draining = scheduler.drain().then(() => {
      drained = true;
    });
    deferred.get('t-a')?.settle();
    deferred.get('t-b')?.settle();
    await expect(Promise.allSettled(ticks.slice(0, 2))).resolves.toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error(TRANSCRIPT_WORD) },
    ]);
    expect(drained).toBe(false);
    deferred.get('t-c')?.settle();
    await expect(draining).resolves.toBeUndefined();
    expect(drained).toBe(true);
    expect(seen.map((c) => c.turn).sort()).toEqual(['t-a', 't-b', 't-c']);
  });
});

describe('createTickScheduler: a return at a Tick time within the harness tolerance counts as returned', () => {
  it('starts a call at 0.3 after a call at 0.1 with latency 0.2 (0.1 + 0.2 > 0.3 in floating point)', async () => {
    const { scheduler, seen } = setup(ok(0.2));
    await scheduler.tick(tick('t-a', 0.1, 1));
    await scheduler.tick(tick('t-a', 0.3, 2));
    await scheduler.drain();
    expect(seen.map((c) => [c.at, c.segments])).toEqual([
      [0.1, 's-1'],
      [0.3, 's-2'],
    ]);
    expect(scheduler.skippedTicks.claim_extractor).toBe(0);
  });

  // The exact boundary of the harness's strict comparison (pipeline.py on_tick: busy_until > t + 1e-9). A call at 0
  // returns at exactly the latency, so busyUntil is the very float `0.3 + 1e-9` the scheduler compares against.
  it('starts a call at 0.3 when the call at 0 returns at exactly 0.3 + 1e-9 (strict >)', async () => {
    const { scheduler, seen } = setup(ok(0.3 + 1e-9));
    await scheduler.tick(tick('t-a', 0, 1));
    await scheduler.tick(tick('t-a', 0.3, 2));
    await scheduler.drain();
    expect(seen.map((c) => [c.at, c.segments])).toEqual([
      [0, 's-1'],
      [0.3, 's-2'],
    ]);
    expect(scheduler.skippedTicks.claim_extractor).toBe(0);
  });

  it('skips the Tick at 0.3 when the call at 0 returns at 0.3 + 2e-9, beyond the tolerance', async () => {
    const { scheduler, seen } = setup(ok(0.3 + 2e-9));
    await scheduler.tick(tick('t-a', 0, 1));
    await scheduler.tick(tick('t-a', 0.3, 2));
    await scheduler.drain();
    expect(seen.map((c) => [c.at, c.segments])).toEqual([[0, 's-1']]);
    expect(scheduler.skippedTicks.claim_extractor).toBe(1);
  });
});
