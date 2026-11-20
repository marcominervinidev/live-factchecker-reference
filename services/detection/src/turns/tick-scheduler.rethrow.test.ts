// Stage 1, @issue-28 (T3), Task 2, gate-1 addendum of 2026-10-30: PENDING OWNER DECISION 3 OF 2026-10-30 (minor
// finding of the review of task 2, recommendation "yes"). Red on task/28-2 until the decision and the code exist.
//
// tick() rethrows an extractor's programming error once every lane of the Tick has settled. The port (tick-scheduler.ts
// `Extractor`, review finding A1 of task 2) resolves on every outcome and rejects only for a programming error; a lost
// Tick in the sense of docs/spec/erkennung-modellrollen.md 4.2 (a schema failure after the retry) is the adapter's
// business and resolves. Today such a rejection is logged as `extractor.failed` and swallowed: "tick() and drain()
// never reject" (services/detection/README.md "Ticks", .claude/rules/pipeline.md, the head comment of
// tick-scheduler.ts, tick-scheduler.errors.test.ts). The decision changes only that:
//   - a call that rejects, or throws synchronously, still lets every lane of this Tick settle (both extractors);
//   - it is logged once as `extractor.failed` with the Session id, the extractor and the Turn id, nothing else and
//     never the error text (unchanged; the tests pin the field count and the values, not the names, as AC15 does);
//   - then tick() rejects with the first original error object (the same object, not a copy or a wrapper); the other
//     failure is still logged. With both extractors failing, "first" follows the order of ExtractorName
//     (claim_extractor, then topic_extractor), also when the Topic Extractor fails earlier in time: PENDING OWNER
//     DECISION F6 OF 2026-10-30, recommendation: ExtractorName order (deterministic; the order in time depends on
//     latencies). The case where both orders agree does not depend on F6;
//   - the lanes stay usable: the failed call counts as returned at its start and the lane's `sent` cursor stays, so
//     the next Tick starts a call that carries the lost Segments again (unchanged);
//   - a final analysis that waits for the call in flight (AC12) still starts when that call rejects: at its own time
//     (the failed call counts as returned at its start), with every Segment not yet sent (the cursor stays); only the
//     tick() of the failed call rejects, the final analysis's tick() resolves;
//   - drain() still waits for every lane and never rejects.
// Unchanged and not repeated here: a latency that is not finite and at least 0 has no error object and stays a lost
// Tick that never rejects (tick-scheduler.errors.test.ts).
//
// Interface: tick-scheduler.test.ts (frozen). Fakes only at the extractor port: promises the test settles, or
// scripted outcomes; nothing waits on the wall clock.
import { createTickScheduler, type Extractor, type ExtractorCall } from './tick-scheduler.ts';
import { describe, expect, it } from 'vitest';
import { seg, SESSION, sid } from '../testing/turns.ts';
import { createLogger } from '@lfc/service-kit';
import type { Segment } from '@lfc/contracts';
import type { Tick } from './tick-plan.ts';
import type { EndedTurn, Turn } from './types.ts';

const TRANSCRIPT_WORD = 'Mietpreisbremse';
const A: Segment[] = Array.from({ length: 4 }, (_, i) =>
  seg(sid(i + 1), 'A', i * 2.5, (i + 1) * 2.5, (i + 1) * 2.5, `${TRANSCRIPT_WORD} wirkt kaum`),
);

function turn(segments: readonly Segment[]): Turn {
  return { id: 't-r7', speaker: 'A', interjection: false, segments };
}

function tick(time: number, upto: number): Tick {
  return { turn: turn(A.slice(0, upto)), time, upto, final: false };
}

function final(time: number, count: number): Tick {
  const ended: EndedTurn = {
    ...turn(A.slice(0, count)),
    endReason: 'stream_end',
    endKnownAt: time,
  };
  return { turn: ended, time, upto: count, final: true };
}

const ids = (from: number, to: number) =>
  A.slice(from - 1, to)
    .map((s) => s.id)
    .join(' ');

interface Outcome {
  readonly latencySeconds: number;
}

/** An extractor whose calls stay in flight until the test settles them, one by one. */
function controlled() {
  const calls: {
    readonly call: ExtractorCall;
    readonly resolve: (latencySeconds: number) => void;
    readonly reject: (error: Error) => void;
  }[] = [];
  const extractor: Extractor = {
    call(call) {
      const outcome = Promise.withResolvers<Outcome>();
      calls.push({
        call,
        resolve: (latencySeconds) => {
          outcome.resolve({ latencySeconds });
        },
        reject: (error) => {
          outcome.reject(error);
        },
      });
      return outcome.promise;
    },
  };
  return { extractor, calls };
}

type Behaviour = (call: ExtractorCall) => Promise<Outcome>;

/** An extractor that behaves as scripted per call (the last behaviour repeats) and records every call. */
function scripted(seen: ExtractorCall[], ...script: Behaviour[]): Extractor {
  let index = 0;
  return {
    call(call) {
      seen.push(call);
      const behaviour = script[Math.min(index, script.length - 1)];
      index += 1;
      if (behaviour === undefined) throw new Error('no script');
      return behaviour(call);
    },
  };
}

const ok =
  (latencySeconds: number): Behaviour =>
  () =>
    Promise.resolve({ latencySeconds });

function setup(claim: Extractor, topic: Extractor) {
  const lines: string[] = [];
  const scheduler = createTickScheduler({
    sessionId: SESSION,
    extractors: { claim_extractor: claim, topic_extractor: topic },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  const events = (name: string) =>
    lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e['event'] === name);
  return { scheduler, lines, events };
}

/** The values of a log event besides time, service, event and the Session id. */
function named(entry: Record<string, unknown>): unknown[] {
  return Object.entries(entry)
    .filter(([key]) => !['time', 'service', 'event', 'sessionId'].includes(key))
    .map(([, value]) => value);
}

/** Watches a promise without awaiting it. */
function observe(promise: Promise<void>) {
  const seen: { state: 'pending' | 'resolved' | 'rejected'; reason: unknown } = {
    state: 'pending',
    reason: undefined,
  };
  promise.then(
    () => {
      seen.state = 'resolved';
    },
    (reason: unknown) => {
      seen.state = 'rejected';
      seen.reason = reason;
    },
  );
  return seen;
}

/** Lets every pending promise reaction run (the microtask queue drains before setImmediate fires). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const callView = (calls: readonly ExtractorCall[]) =>
  calls.map((c) => [c.at, c.segments.map((s) => s.id).join(' '), c.final]);

describe('createTickScheduler: tick() rethrows an extractor’s programming error once the Tick has settled (pending owner decision 3)', () => {
  it('waits for every lane of the Tick, then rejects with the original error object', async () => {
    const claim = controlled();
    const topic = controlled();
    const { scheduler } = setup(claim.extractor, topic.extractor);
    const failure = new Error(`model said: ${TRANSCRIPT_WORD}`);

    const ticked = observe(scheduler.tick(tick(5, 2)));
    await flush();
    claim.calls[0]?.reject(failure);
    await flush();
    expect(ticked.state).toBe('pending'); // the Topic Extractor's call of this Tick is still in flight

    topic.calls[0]?.resolve(1);
    await flush();
    expect(ticked.state).toBe('rejected');
    expect(ticked.reason).toBe(failure);
  });

  it('treats a synchronous throw like a rejection and rejects with that error object', async () => {
    const failure = new Error(`model said: ${TRANSCRIPT_WORD}`);
    const throws: Behaviour = () => {
      throw failure;
    };
    const { scheduler } = setup(scripted([], throws), scripted([], ok(0)));
    await expect(scheduler.tick(tick(5, 2))).rejects.toBe(failure);
  });

  it('still logs one extractor.failed event with the Session, the extractor and the Turn only, and no error text', async () => {
    const failure = new Error(`model said: ${TRANSCRIPT_WORD}`);
    const { scheduler, lines, events } = setup(
      scripted([], () => Promise.reject(failure)),
      scripted([], ok(0)),
    );
    await expect(scheduler.tick(tick(5, 2))).rejects.toBe(failure);
    const failed = events('extractor.failed');
    expect(failed).toHaveLength(1);
    const entry: Record<string, unknown> = failed[0] ?? {};
    expect(entry['sessionId']).toBe(SESSION);
    expect(named(entry).sort()).toEqual(['claim_extractor', 't-r7']);
    for (const line of lines) {
      expect(line).not.toContain(TRANSCRIPT_WORD);
      expect(line).not.toContain('model said');
    }
  });

  it('keeps the lanes usable: the next Tick starts a call that carries the lost Segments again, nothing is skipped', async () => {
    const failure = new Error(`model said: ${TRANSCRIPT_WORD}`);
    const seen: ExtractorCall[] = [];
    const { scheduler } = setup(
      scripted(seen, () => Promise.reject(failure), ok(1)),
      scripted([], ok(0)),
    );
    await expect(scheduler.tick(tick(5, 2))).rejects.toBe(failure);
    await expect(scheduler.tick(tick(7.5, 3))).resolves.toBeUndefined();
    await expect(scheduler.tick(final(10, 4))).resolves.toBeUndefined();
    await expect(scheduler.drain()).resolves.toBeUndefined();
    expect(callView(seen)).toEqual([
      [5, ids(1, 2), false],
      [7.5, ids(1, 3), false],
      [10, ids(4, 4), true],
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('rejects with the first error when both lanes of a Tick fail, and logs the second one too', async () => {
    const claim = controlled();
    const topic = controlled();
    const { scheduler, lines, events } = setup(claim.extractor, topic.extractor);
    const claimFailure = new Error(`claim: ${TRANSCRIPT_WORD}`);
    const topicFailure = new Error(`topic: ${TRANSCRIPT_WORD}`);

    const ticked = observe(scheduler.tick(tick(5, 2)));
    await flush();
    claim.calls[0]?.reject(claimFailure);
    await flush();
    topic.calls[0]?.reject(topicFailure);
    await flush();
    expect(ticked.state).toBe('rejected');
    expect(ticked.reason).toBe(claimFailure);

    const failed = events('extractor.failed').map((entry) => named(entry).sort());
    expect(failed).toHaveLength(2);
    expect(failed).toContainEqual(['claim_extractor', 't-r7']);
    expect(failed).toContainEqual(['t-r7', 'topic_extractor']);
    for (const line of lines) expect(line).not.toContain(TRANSCRIPT_WORD);
  });

  it('rejects with the Claim Extractor’s error when the Topic Extractor fails earlier in time (pending owner decision F6)', async () => {
    const claim = controlled();
    const topic = controlled();
    const { scheduler, events } = setup(claim.extractor, topic.extractor);
    const claimFailure = new Error(`claim: ${TRANSCRIPT_WORD}`);
    const topicFailure = new Error(`topic: ${TRANSCRIPT_WORD}`);

    const ticked = observe(scheduler.tick(tick(5, 2)));
    await flush();
    topic.calls[0]?.reject(topicFailure);
    await flush();
    expect(ticked.state).toBe('pending'); // the Claim Extractor's call of this Tick is still in flight
    claim.calls[0]?.reject(claimFailure);
    await flush();
    expect(ticked.state).toBe('rejected');
    expect(ticked.reason).toBe(claimFailure);
    expect(events('extractor.failed')).toHaveLength(2);
  });

  it('starts a final analysis that waits for a call when that call rejects, and only the failed call’s tick() rejects (AC12)', async () => {
    const claim = controlled();
    const failure = new Error(`model said: ${TRANSCRIPT_WORD}`);
    const { scheduler } = setup(claim.extractor, scripted([], ok(0)));

    const failing = observe(scheduler.tick(tick(5, 2)));
    const finalAnalysis = observe(scheduler.tick(final(7.5, 3)));
    await flush();
    // AC12: the final analysis falls due during the call of 5 and waits for it
    expect(callView(claim.calls.map((c) => c.call))).toEqual([[5, ids(1, 2), false]]);

    claim.calls[0]?.reject(failure);
    await flush();
    // the failed call counts as returned at 5, so the final analysis starts at its own time, 7.5, and carries every
    // Segment not yet sent, the lost ones included
    expect(callView(claim.calls.map((c) => c.call))).toEqual([
      [5, ids(1, 2), false],
      [7.5, ids(1, 3), true],
    ]);
    expect(failing.state).toBe('rejected');
    expect(failing.reason).toBe(failure);
    expect(finalAnalysis.state).toBe('pending');

    claim.calls[1]?.resolve(1);
    await flush();
    expect(finalAnalysis.state).toBe('resolved');
    await expect(scheduler.drain()).resolves.toBeUndefined();
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('lets drain() resolve while the Tick it waits for rejects', async () => {
    const claim = controlled();
    const failure = new Error(`model said: ${TRANSCRIPT_WORD}`);
    const { scheduler } = setup(claim.extractor, scripted([], ok(0)));

    const ticked = observe(scheduler.tick(tick(5, 2)));
    let drained = false;
    const draining = scheduler.drain().then(() => {
      drained = true;
    });
    await flush();
    expect(drained).toBe(false); // the Claim Extractor's call is still in flight

    claim.calls[0]?.reject(failure);
    await expect(draining).resolves.toBeUndefined();
    expect(drained).toBe(true);
    await flush();
    expect(ticked.state).toBe('rejected');
    expect(ticked.reason).toBe(failure);
  });
});
