// Stage 1, issue #32 (T6), Task 1: the Topic Extractor as the second role of every Tick (AC2), with its own skip
// rule and skipped-Tick counter (AC3), a final analysis that is never dropped (AC4) and a skip state independent of
// the Claim Extractor's (AC5). The Session's Turn building of #28 (src/session/session-turns.ts, the Tick plan and the
// Tick scheduler, frozen and green) drives the real Topic Extractor of this ticket; the model is a scripted adapter
// with a fixed latency on the Session clock, the Claim Extractor a recording fake (its own role is #29's).
// Interface: header of topic-extractor.test.ts (createTopicExtractor).
//
// One Turn of Speaker B in three Segments of 5 s speech each (tick_seconds 5, spec 8): non-final Ticks at 5.5, 11 and
// 16.5 (the finalizedAt of the Segment that reaches 5, 10 and 15 s of speech, tick-plan.ts), then the final analysis
// at the end of the Input. With a Topic Extractor latency of 6 s the call of 5.5 runs until 11.5, so the Tick of 11
// is skipped and the call of 16.5 carries both Segments new since then (harness pipeline.py on_tick, on_return).
import { createTopicExtractor } from './topic-extractor.ts';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@lfc/service-kit';
import { createSessionTurns } from '../session/session-turns.ts';
import { START_VALUES, seg } from '../testing/turns.ts';
import type { AdapterResult, ModelAdapter, ModelRequest } from '@lfc/providers';
import type { Segment } from '@lfc/contracts';
import type { Extractor, ExtractorCall } from '../turns/tick-scheduler.ts';

const SESSION = '32a0c0de-0000-4000-8000-000000000021';
const TOPIC = 'Mieten Berlin';
const CONFIG = {
  instruction: 'Du bist der Topic-Extraktor (Testanweisung).',
  model: 'claude-haiku-5-5',
  thinking: 'off' as 'off' | 'low',
  maxTokens: 1024,
  deadlineSeconds: 15,
  windowSeconds: 60,
  schemaRetries: 1,
};

const S1 = seg('s-0001', 'B', 0, 5, 5.5, 'Die Mieten in Berlin steigen');
const S2 = seg('s-0002', 'B', 5.5, 10.5, 11, 'Die Mietpreisbremse wirkt nicht');
const S3 = seg('s-0003', 'B', 11, 16, 16.5, 'Wir brauchen mehr Neubau');
const LINE_S2 = '[5.50–10.50] B: Die Mietpreisbremse wirkt nicht';
const LINE_S3 = '[11.00–16.00] B: Wir brauchen mehr Neubau';

type Answer = 'nothing' | 'subtopic' | 'fatal';

/** A scripted model: every call answers after `latency` s of Session time; `subtopic` opens a new tag per call. */
function topicModel(latency: number, answer: Answer) {
  const requests: ModelRequest[] = [];
  const adapter: ModelAdapter = {
    name: 'scripted',
    call(request): Promise<AdapterResult> {
      requests.push(request);
      const common = { latencySeconds: latency, model: request.model, adapter: 'scripted' };
      if (answer === 'fatal') {
        return Promise.resolve({
          ok: false,
          error: { kind: 'fatal', message: 'scripted' },
          ...common,
        });
      }
      const tag = `Unterthema ${requests.length}`;
      const body =
        answer === 'subtopic'
          ? { current: [TOPIC, tag], new: [{ tag, parent: TOPIC }], returned: [], ended: [] }
          : { current: [TOPIC], new: [], returned: [], ended: [] };
      const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };
      return Promise.resolve({ ok: true, text: JSON.stringify(body), usage, ...common });
    },
  };
  return { adapter, requests };
}

/** The Claim Extractor's place in the Tick: records when it was called and returns after `latency`. */
function claimFake(latency: number) {
  const calls: ExtractorCall[] = [];
  const extractor: Extractor = {
    call(c) {
      calls.push(c);
      return Promise.resolve({ latencySeconds: latency });
    },
  };
  return { extractor, calls };
}

async function run(options: { topicLatency: number; topicAnswer?: Answer; claimLatency: number }) {
  const model = topicModel(options.topicLatency, options.topicAnswer ?? 'nothing');
  const claim = claimFake(options.claimLatency);
  const accepted: Segment[] = [];
  const events: unknown[] = [];
  const lines: string[] = [];
  const logger = createLogger({ service: 'detection', write: (line) => lines.push(line) });
  const topic = createTopicExtractor({
    sessionId: SESSION,
    config: CONFIG,
    setting: { mode: 'broadcast', topic: TOPIC },
    speakerNames: {},
    adapter: model.adapter,
    session: { segments: () => accepted },
    stream: {
      append(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    logger,
  });
  // Records when the scheduler started each Topic Extractor call and how long it took, around the real extractor.
  const topicStarts: { at: number; final: boolean; latency: number }[] = [];
  const recording: Extractor = {
    async call(c) {
      const returned = await topic.call(c);
      topicStarts.push({ at: c.at, final: c.final, latency: returned.latencySeconds });
      return returned;
    },
  };
  const session = createSessionTurns({
    sessionId: SESSION,
    parameters: START_VALUES,
    extractors: { claim_extractor: claim.extractor, topic_extractor: recording },
    logger,
  });
  for (const segment of [S1, S2, S3]) {
    accepted.push(segment);
    await session.accept(segment);
  }
  await session.end();
  const logged = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  const topicCalls = logged.filter((e) => e['event'] === 'topic_extractor.call');
  const tickAts = events.map(
    (e) =>
      ((e as Record<string, unknown>)['topic'] as Record<string, unknown> | undefined)?.['tickAt'],
  );
  return { session, model, claim, topicCalls, tickAts, logged, topicStarts };
}

const newBlock = (request: ModelRequest | undefined) =>
  (request?.blocks ?? []).find((b) => b.kind === 'new')?.text;

describe('the Topic Extractor is called on every Tick of a Turn, as a call of its own (AC2)', () => {
  it('makes one Topic Extractor request per Tick, three non-final and the final analysis', async () => {
    const { model, session, topicCalls } = await run({ topicLatency: 0.5, claimLatency: 0.5 });
    expect(session.ticks).toHaveLength(4);
    expect(model.requests).toHaveLength(4);
    expect(model.requests.every((r) => r.role === 'topic_extractor')).toBe(true);
    expect(topicCalls).toHaveLength(4);
    expect(topicCalls.every((c) => c['turnId'] === 't-001' && c['outcome'] === 'valid')).toBe(true);
  });

  it('calls the Claim Extractor for the same Ticks, separately', async () => {
    const { claim, model } = await run({ topicLatency: 0.5, claimLatency: 0.5 });
    expect(claim.calls).toHaveLength(4);
    expect(model.requests.some((r) => r.blocks.some((b) => b.kind === 'turn'))).toBe(false);
  });

  it('dates the Topic events of the non-final Ticks at their Tick times', async () => {
    const { tickAts } = await run({
      topicLatency: 0.5,
      topicAnswer: 'subtopic',
      claimLatency: 0.5,
    });
    expect(tickAts.slice(0, 3)).toEqual([5.5, 11, 16.5]);
  });
});

describe('a due Tick is skipped while the previous Topic Extractor call of the Turn runs (AC3)', () => {
  it('skips the Tick of 11 s, counts it for the Topic Extractor only, and never runs two calls of the Turn at once', async () => {
    const { session, model, tickAts } = await run({
      topicLatency: 6,
      topicAnswer: 'subtopic',
      claimLatency: 0.5,
    });
    expect(session.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 1 });
    expect(model.requests).toHaveLength(3);
    expect(tickAts.slice(0, 2)).toEqual([5.5, 16.5]);
  });

  it('starts no Topic Extractor call of the Turn before the previous one has returned', async () => {
    const { topicStarts } = await run({ topicLatency: 6, claimLatency: 0.5 });
    const ordered = [...topicStarts].sort((a, b) => a.at - b.at);
    for (let i = 1; i < ordered.length; i += 1) {
      const before = ordered[i - 1];
      expect(ordered[i]?.at).toBeGreaterThanOrEqual((before?.at ?? 0) + (before?.latency ?? 0));
    }
  });

  it('gives the next call after the return everything new since the last analysis', async () => {
    const { model } = await run({ topicLatency: 6, claimLatency: 0.5 });
    expect(newBlock(model.requests[1])).toBe(
      `Neu seit der letzten Analyse:\n${LINE_S2}\n${LINE_S3}`,
    );
  });
});

describe('the final analysis of a Turn is never dropped (AC4)', () => {
  it('starts the final analysis when the running call returns, at 22.5 s, as the last call of the Turn', async () => {
    const { model, topicCalls, topicStarts } = await run({ topicLatency: 6, claimLatency: 0.5 });
    expect(model.requests).toHaveLength(3);
    expect(topicCalls.map((c) => c['final'])).toEqual([false, false, true]);
    expect(topicStarts.map((c) => [c.at, c.final])).toEqual([
      [5.5, false],
      [16.5, false],
      [22.5, true],
    ]);
  });

  it('dates the Topic event of the deferred final analysis at the start of that call', async () => {
    const { tickAts } = await run({ topicLatency: 6, topicAnswer: 'subtopic', claimLatency: 0.5 });
    expect(tickAts).toEqual([5.5, 16.5, 22.5]);
  });
});

describe('the skip state of the Topic Extractor is independent of the Claim Extractor (AC5)', () => {
  it('never skips or delays a Claim Extractor Tick for a slow Topic Extractor', async () => {
    const fast = await run({ topicLatency: 0.5, claimLatency: 0.5 });
    const slow = await run({ topicLatency: 6, claimLatency: 0.5 });
    expect(slow.claim.calls.map((c) => [c.at, c.final])).toEqual(
      fast.claim.calls.map((c) => [c.at, c.final]),
    );
    expect(slow.session.skippedTicks.claim_extractor).toBe(0);
  });

  it('never skips or delays a Claim Extractor Tick for a failing Topic Extractor', async () => {
    const fast = await run({ topicLatency: 0.5, claimLatency: 0.5 });
    const failing = await run({ topicLatency: 0.5, topicAnswer: 'fatal', claimLatency: 0.5 });
    expect(failing.claim.calls.map((c) => [c.at, c.final])).toEqual(
      fast.claim.calls.map((c) => [c.at, c.final]),
    );
    expect(failing.topicCalls.every((c) => c['outcome'] === 'fatal')).toBe(true);
  });

  it('never skips a Topic Extractor Tick for a slow Claim Extractor', async () => {
    const { session, model } = await run({ topicLatency: 0.5, claimLatency: 6 });
    expect(session.skippedTicks).toEqual({ claim_extractor: 1, topic_extractor: 0 });
    expect(model.requests).toHaveLength(4);
  });
});
