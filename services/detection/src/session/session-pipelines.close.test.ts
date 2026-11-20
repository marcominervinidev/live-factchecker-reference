// Stage 1 (stock review of 2026-11-20, finding "cancellation and shutdown drain are not wired for model calls"): the
// stop of the process as the Sessions' analysis sees it (session-pipelines.ts, close()). Source of the expectations:
// packages/service-kit/README.md, Pitfalls ("Background work ... must end inside `close`, before the connection it
// uses is closed") and docs/CODING_STANDARDS.md (a signal nobody aborts is the same as none). Fakes at the boundaries
// only: a model adapter that records each request and answers when the test lets it, and records that count writes.
import { createLogger } from '@lfc/service-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdapterResult, ModelAdapter, ModelRequest } from '@lfc/providers';

import { seg, sid, START_VALUES } from '../testing/turns.ts';
import { createSessionPipelines } from './session-pipelines.ts';
import type { SessionRecords } from './store.ts';

const SESSION = '29a0c0de-0000-4000-8000-0000000000c1';
const OTHER = '29a0c0de-0000-4000-8000-0000000000c2';
const START = { setting: { mode: 'conversation' as const }, speakerNames: {} };
const CONFIG = {
  adapter: 'mock' as const,
  instruction: 'Testanweisung.',
  model: 'claude-haiku-5-5',
  thinking: 'off' as const,
  maxTokens: 2048,
  deadlineSeconds: 15,
  tokensPerWord: 2.1,
  contextTurns: 2,
  contextTokenCap: 600,
  claimListCap: 100,
  schemaRetries: 1,
  cacheBlockBreakpoint: 20,
};

/** Six seconds of speech by one Speaker: the Tick at five seconds calls the Claim Extractor. */
const WITH_TICK = seg(sid(1), 'A', 0, 6, 6);
/** One second of speech: no Tick; only the end of the Input would analyse it. */
const NO_TICK = seg(sid(1), 'A', 0, 1, 1);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-20T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

function answer(request: ModelRequest): AdapterResult {
  return {
    ok: true,
    text: '{"claims": [], "candidates": []}',
    usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 },
    latencySeconds: 0.5,
    model: request.model,
    adapter: 'held',
  };
}

function setup() {
  const requests: ModelRequest[] = [];
  const release: (() => void)[] = [];
  let writes = 0;
  /** Every call stays in flight until the test releases it. */
  const adapter: ModelAdapter = {
    name: 'held',
    call(request) {
      requests.push(request);
      return new Promise((resolve) => {
        release.push(() => {
          resolve(answer(request));
        });
      });
    },
  };
  const records: SessionRecords = {
    detection: () => {
      writes += 1;
      return Promise.resolve();
    },
    candidate: () => {
      writes += 1;
      return Promise.resolve();
    },
  };
  const pipelines = createSessionPipelines({
    config: CONFIG,
    parameters: START_VALUES,
    lifetimeSeconds: 10,
    adapter,
    records,
    logger: createLogger({ service: 'detection', write: () => undefined }),
  });
  return { pipelines, requests, release, writes: () => writes };
}

/** Lets every pending microtask run; the adapter's answers are promises, not timers. */
async function settled(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('createSessionPipelines: close() at the stop of the process', () => {
  it('aborts the signal of a call in flight and resolves only once that call has returned', async () => {
    const { pipelines, requests, release } = setup();
    pipelines.open(SESSION, START);
    pipelines.accept(SESSION, WITH_TICK);
    await settled();
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.signal.aborted).toBe(false);

    let closed = false;
    const closing = pipelines.close().then(() => {
      closed = true;
    });
    await settled();
    expect(request?.signal.aborted).toBe(true);
    expect(closed).toBe(false);

    release.forEach((let_go) => {
      let_go();
    });
    await closing;
    expect(closed).toBe(true);
  });

  it('gives every Session of the process the same stop signal', async () => {
    const { pipelines, requests, release } = setup();
    pipelines.open(SESSION, START);
    pipelines.open(OTHER, START);
    pipelines.accept(SESSION, WITH_TICK);
    pipelines.accept(OTHER, WITH_TICK);
    await settled();
    expect(requests).toHaveLength(2);

    const closing = pipelines.close();
    release.forEach((let_go) => {
      let_go();
    });
    await closing;
    expect(requests.map((r) => r.signal.aborted)).toEqual([true, true]);
  });

  it('starts no final analysis: the Input of an open Session has not ended', async () => {
    const { pipelines, requests } = setup();
    pipelines.open(SESSION, START);
    pipelines.accept(SESSION, NO_TICK);
    await pipelines.close();
    expect(requests).toHaveLength(0);
  });

  it('analyses no Segment and opens no Session afterwards, and writes nothing', async () => {
    const { pipelines, requests, writes } = setup();
    pipelines.open(SESSION, START);
    await pipelines.close();
    pipelines.accept(SESSION, WITH_TICK);
    pipelines.open(OTHER, START);
    pipelines.accept(OTHER, WITH_TICK);
    await settled();
    await pipelines.end(OTHER);
    expect(requests).toHaveLength(0);
    expect(writes()).toBe(0);
  });

  it('drops the lifetime timers of every Session', async () => {
    const { pipelines } = setup();
    pipelines.open(SESSION, START);
    pipelines.open(OTHER, START);
    expect(vi.getTimerCount()).toBe(2);
    await pipelines.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for an end of the Input that is already running instead of cutting it off', async () => {
    const { pipelines, requests, release } = setup();
    pipelines.open(SESSION, START);
    pipelines.accept(SESSION, NO_TICK);
    const ending = pipelines.end(SESSION);
    await settled();
    expect(requests).toHaveLength(1);

    let closed = false;
    const closing = pipelines.close().then(() => {
      closed = true;
    });
    await settled();
    expect(closed).toBe(false);
    release.forEach((let_go) => {
      let_go();
    });
    await Promise.all([ending, closing]);
    expect(closed).toBe(true);
  });

  it('resolves at once when no Session is open, and a second close is harmless', async () => {
    const { pipelines } = setup();
    await pipelines.close();
    await pipelines.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
