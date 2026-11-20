// Stage 1, @issue-28 (T3), Task 3: the error path of createSessionTurns, written by the implementer for an internal
// the frozen tests do not reach (the stage-2a fakes never reject). Owner decision 3 of 2026-11-03: tick() rejects with
// the first original error once every call of the Tick has settled; since #29 AC22 (gate 1 question 7: „Angenommen,
// mit Log-Ereignis `tick.failed`“) the Session catches it: accept() and end() resolve once every call has settled and
// log `tick.failed` once per failed Tick (session-turns.rethrow.test.ts, frozen with #29 task 3). end() drains the
// scheduler even after a failure. Fakes only at the extractor port, on the Session clock:
// promises the test settles, or scripted latencies; nothing waits on the wall clock.
import { createLogger } from '@lfc/service-kit';
import { describe, expect, it } from 'vitest';

import { seg, SESSION, sid, START_VALUES } from '../testing/turns.ts';
import type { Extractor, ExtractorCall } from '../turns/tick-scheduler.ts';
import { createSessionTurns } from './session-turns.ts';

interface Pending {
  readonly call: ExtractorCall;
  readonly resolve: (latencySeconds: number) => void;
  readonly reject: (error: Error) => void;
}

/** An extractor whose calls stay in flight until the test settles them. */
function controlled() {
  const calls: Pending[] = [];
  const extractor: Extractor = {
    call(call) {
      const outcome = Promise.withResolvers<{ readonly latencySeconds: number }>();
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
  const nth = (n: number): Pending => {
    const pending = calls[n];
    if (pending === undefined) throw new Error(`no call ${n}`);
    return pending;
  };
  return { extractor, calls, nth };
}

/** An extractor that returns after a fixed latency and records every call. */
function fixed(latencySeconds: number, seen: ExtractorCall[] = []): Extractor {
  return {
    call(call) {
      seen.push(call);
      return Promise.resolve({ latencySeconds });
    },
  };
}

function session(claim: Extractor, topic: Extractor) {
  const lines: string[] = [];
  const turns = createSessionTurns({
    sessionId: SESSION,
    parameters: START_VALUES,
    extractors: { claim_extractor: claim, topic_extractor: topic },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  return { turns, lines };
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

/** The Turn ids of the `tick.failed` lines, in order (AC22: one line per failed Tick, with its Turn id). */
function failedTurns(lines: readonly string[]): unknown[] {
  return lines
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((l) => l['event'] === 'tick.failed')
    .map((l) => l['turnId']);
}

/** Lets every pending promise reaction run (the microtask queue drains before setImmediate fires). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// 5 s of Speaker A: a non-final Tick at 5 (spec 8: tickSeconds 5).
const A1 = seg(sid(1), 'A', 0, 5, 5);
// Speaker B from 5 s: ends A's Turn (speaker change) at 6.
const B1 = seg(sid(2), 'B', 5, 6, 6);

describe('createSessionTurns: accept() and end() resolve only once every call of the Tick has settled', () => {
  it('keeps accept() pending while another call of the Tick is in flight, then resolves and logs tick.failed', async () => {
    const claim = controlled();
    const topic = controlled();
    const { turns, lines } = session(claim.extractor, topic.extractor);
    const failure = new Error('claim extractor bug');

    const accepted = observe(turns.accept(A1));
    await flush();
    claim.nth(0).reject(failure);
    await flush();
    expect(accepted.state).toBe('pending');

    topic.nth(0).resolve(0.5);
    await flush();
    expect(accepted.state).toBe('resolved');
    expect(failedTurns(lines)).toEqual([claim.nth(0).call.turn.id]);
  });

  it('keeps end() pending while another call of the final analysis is in flight, then resolves and logs tick.failed', async () => {
    const claim = controlled();
    const topic = controlled();
    const { turns, lines } = session(claim.extractor, topic.extractor);
    const failure = new Error('topic extractor bug');

    await turns.accept(seg(sid(1), 'A', 0, 1, 1));
    const ended = observe(turns.end());
    await flush();
    expect(topic.nth(0).call.final).toBe(true);
    topic.nth(0).reject(failure);
    await flush();
    expect(ended.state).toBe('pending');

    claim.nth(0).resolve(0.5);
    await flush();
    expect(ended.state).toBe('resolved');
    expect(failedTurns(lines)).toEqual([topic.nth(0).call.turn.id]);
  });
});

describe('createSessionTurns: with both extractors failing, one tick.failed per Tick', () => {
  it('resolves once both failed calls have settled and logs the Tick once', async () => {
    const claim = controlled();
    const topic = controlled();
    const { turns, lines } = session(claim.extractor, topic.extractor);
    const claimFailure = new Error('claim extractor bug');
    const topicFailure = new Error('topic extractor bug');

    const accepted = observe(turns.accept(A1));
    await flush();
    topic.nth(0).reject(topicFailure);
    await flush();
    expect(accepted.state).toBe('pending');
    claim.nth(0).reject(claimFailure);
    await flush();
    expect(accepted.state).toBe('resolved');
    expect(failedTurns(lines)).toEqual([claim.nth(0).call.turn.id]);
  });
});

describe('createSessionTurns: an earlier failing Tick of the same accept() loses no later Tick', () => {
  it('hands the next Turn’s Tick to the extractor and resolves only once both Ticks have settled', async () => {
    const claim = controlled();
    const { turns, lines } = session(claim.extractor, fixed(0.5));
    const failure = new Error('claim extractor bug');

    await turns.accept(seg(sid(1), 'A', 0, 2, 2)); // Turn A, 2 s of speech: no Tick yet
    // 5 s of Speaker B: ends Turn A (its final analysis) and falls due a non-final Tick of Turn B, in that order.
    const accepted = observe(turns.accept(seg(sid(2), 'B', 2, 7, 7)));
    await flush();
    expect(claim.calls.map((c) => [c.call.turn.speaker, c.call.final])).toEqual([
      ['A', true],
      ['B', false],
    ]);

    claim.nth(0).reject(failure);
    await flush();
    expect(accepted.state).toBe('pending'); // Turn B's Tick is still in flight

    claim.nth(1).resolve(0.5);
    await flush();
    expect(accepted.state).toBe('resolved');
    expect(failedTurns(lines)).toEqual([claim.nth(0).call.turn.id]);
  });
});

describe('createSessionTurns: end() drains the scheduler also after a failure', () => {
  it('resolves only after the call of an earlier Turn still in flight and the final analysis waiting for it have returned', async () => {
    const claim = controlled();
    const { turns, lines } = session(claim.extractor, fixed(0.5));
    const failure = new Error('claim extractor bug');

    const first = observe(turns.accept(A1)); // Claim Extractor call 0: Turn A, non-final, in flight
    await flush();
    const second = observe(turns.accept(B1)); // ends Turn A; its final analysis waits for call 0
    await flush();
    expect(claim.calls).toHaveLength(1);

    const ended = observe(turns.end()); // Claim Extractor call 1: Turn B, final
    await flush();
    expect(claim.calls).toHaveLength(2);
    expect(claim.nth(1).call.turn.speaker).toBe('B');
    claim.nth(1).reject(failure);
    await flush();
    expect(ended.state).toBe('pending'); // the drain waits for Turn A's lane

    claim.nth(0).resolve(0.5);
    await flush();
    expect(first.state).toBe('resolved');
    expect(claim.nth(2).call.final).toBe(true);
    expect(claim.nth(2).call.turn.speaker).toBe('A');
    expect(ended.state).toBe('pending'); // Turn A's final analysis is in flight

    claim.nth(2).resolve(0.5);
    await flush();
    expect(second.state).toBe('resolved');
    expect(ended.state).toBe('resolved');
    expect(failedTurns(lines)).toEqual([claim.nth(1).call.turn.id]);
    expect(turns.turns.map((t) => t.speaker)).toEqual(['A', 'B']);
  });
});

describe('createSessionTurns: a run without failure', () => {
  it('counts a Tick skipped while the Claim Extractor is busy and none for the Topic Extractor', async () => {
    const claimCalls: ExtractorCall[] = [];
    const { turns, lines } = session(fixed(6, claimCalls), fixed(0.5));
    for (const segment of [
      seg(sid(1), 'A', 0, 5, 5),
      seg(sid(2), 'A', 5, 10, 10),
      seg(sid(3), 'A', 10, 15, 15),
    ]) {
      await turns.accept(segment);
    }
    await turns.end();

    expect(turns.skippedTicks).toEqual({ claim_extractor: 1, topic_extractor: 0 });
    expect(turns.ticks.map((t) => [t.time, t.upto, t.final])).toEqual([
      [5, 1, false],
      [10, 2, false],
      [15, 3, false],
      [15, 3, true],
    ]);
    expect(claimCalls.map((c) => [c.at, c.segments.map((s) => s.id).join(' '), c.final])).toEqual([
      [5, 's-0001', false],
      [15, 's-0002 s-0003', false],
      [21, '', true],
    ]);
    const skipped = lines.filter(
      (l) => (JSON.parse(l) as Record<string, unknown>)['event'] === 'tick.skipped',
    );
    expect(skipped).toHaveLength(1);
    expect(turns.turns).toHaveLength(1);
  });
});
