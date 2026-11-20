// Stage 1, issue #29 task 3 (implementer-owned, review finding M3b): the life of a Session's analysis in this process
// (session-pipelines.ts). Its state is dropped once the Session's lifetime has passed without a Segment (ADR 0009, as
// its Redis keys are); a second end waits for the same calls and starts no second final analysis; a Segment after
// the end reaches no extractor. Fakes at the boundaries only: a model adapter that records each call and answers
// with no Claim, and records that keep what they are given. Fake timers stand in for the lifetime.
import { createLogger } from '@lfc/service-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelAdapter, ModelRequest } from '@lfc/providers';

import { seg, sid, START_VALUES } from '../testing/turns.ts';
import { createSessionPipelines } from './session-pipelines.ts';
import type { SessionRecords } from './store.ts';

const SESSION = '29a0c0de-0000-4000-8000-000000000081';
const LIFETIME_SECONDS = 10;
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

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-19T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const calls: ModelRequest[] = [];
  const lines: string[] = [];
  const adapter: ModelAdapter = {
    name: 'recording',
    call(request) {
      calls.push(request);
      return Promise.resolve({
        ok: true,
        text: '{"claims": [], "candidates": []}',
        usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 },
        latencySeconds: 0.5,
        model: request.model,
        adapter: 'recording',
      });
    },
  };
  const records: SessionRecords = {
    detection: () => Promise.resolve(),
    candidate: () => Promise.resolve(),
  };
  const pipelines = createSessionPipelines({
    config: CONFIG,
    parameters: START_VALUES,
    lifetimeSeconds: LIFETIME_SECONDS,
    adapter,
    records,
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  pipelines.open(SESSION, { setting: { mode: 'conversation' }, speakerNames: {} });
  const events = () => lines.map((line) => (JSON.parse(line) as { event: unknown }).event);
  return { pipelines, calls, events };
}

/** One second of speech: no Tick yet, only the final analysis at the end of the Input. */
const FIRST = seg(sid(1), 'A', 0, 1, 1);

describe('createSessionPipelines: the end of the Input', () => {
  it('runs the final analysis once, also when the Input is ended twice', async () => {
    const { pipelines, calls } = setup();
    pipelines.accept(SESSION, FIRST);
    const first = pipelines.end(SESSION);
    const second = pipelines.end(SESSION);
    expect(second).toBe(first);
    await first;
    await pipelines.end(SESSION);
    expect(calls).toHaveLength(1);
  });

  it('sends a Segment that arrives after the end to no extractor and fails nothing', async () => {
    const { pipelines, calls, events } = setup();
    pipelines.accept(SESSION, FIRST);
    await pipelines.end(SESSION);
    pipelines.accept(SESSION, seg(sid(2), 'B', 1, 7, 7));
    await vi.advanceTimersByTimeAsync(0);
    await pipelines.end(SESSION);
    expect(calls).toHaveLength(1);
    expect(events()).not.toContain('tick.failed');
  });
});

describe('createSessionPipelines: the lifetime', () => {
  it('drops the analysis once the lifetime has passed without a Segment', async () => {
    const { pipelines, calls } = setup();
    pipelines.accept(SESSION, FIRST);
    await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000);
    pipelines.accept(SESSION, seg(sid(2), 'A', 1, 7, 7));
    await vi.advanceTimersByTimeAsync(0);
    await pipelines.end(SESSION);
    expect(calls).toEqual([]);
  });

  it('keeps the analysis while each Segment comes within the lifetime of the one before', async () => {
    const { pipelines, calls } = setup();
    pipelines.accept(SESSION, FIRST);
    await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000 - 1);
    pipelines.accept(SESSION, seg(sid(2), 'A', 1, 2, 2));
    await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000 - 1);
    await pipelines.end(SESSION);
    expect(calls).toHaveLength(1);
  });
});
