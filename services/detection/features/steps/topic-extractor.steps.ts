// Stage-2a steps for the Topic Extractor in a Session (issue #32, T6, Task 1; feature features/topic-extractor.feature).
// In-process: the service runs through startDetection (support/service.ts, #27) against the Redis of the test project,
// with the mock adapters of @lfc/providers; Segments go in through the Session routes of #27 and #29. Steps observe
// behaviour only: HTTP answers, log lines, Redis keys and the detection stream.
// Extends the step libraries of claim-extractor.steps.ts (#29: World `expectationsFile`, `mockLatency`,
// `mockInvalidCalls`, `lifetimeSeconds`, `setting`, `sessionId`; the Session routes and the end of the Input),
// session.steps.ts (#27: `redisUrl`, `baselineKeys`) and turn-building.steps.ts (#28: parameter type {extractor},
// `recording`, `replayed`); it never copies their steps. Two helpers of claim-extractor.steps.ts (reading the stream,
// assembling the mock environment) are module-local there and repeated here in a few lines; the report names them as
// a candidate for features/support/.
//
// Interface these steps define (proposal of the test designer for gate 1):
//   Environment: #29's (MODEL_ADAPTER=mock, CLAIM_EXTRACTOR_PROMPT_FILE, MOCK_EXPECTATIONS_FILE, MOCK_LATENCY_SECONDS,
//                MOCK_INVALID_CALLS) plus TOPIC_EXTRACTOR_PROMPT_FILE, MOCK_TOPIC_NEW_RATE, MOCK_TOPIC_LATENCY_SECONDS,
//                MOCK_TOPIC_INVALID_CALLS (src/config.topic-extractor.test.ts)
//   Redis stream `session:<id>:detection` of #29, field `event` = the envelope as JSON; a Topic event is an entry of
//   type `topic` (packages/contracts/src/detection-event.topic.test.ts), its Tick time in `topic.tickAt`
//   Log events: topic_extractor.call { sessionId, modelRole, turnId, final, outcome, attempts, durationMs,
//               inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, thinkingTokens, costUsd, unknownTags }
//               (src/topic-extractor/topic-extractor.test.ts); tick.skipped of #28
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Given, Then, type World } from '@cucumber/cucumber';

import { withRedis } from '../support/redis.ts';
import { startService, testProjectRedis, type ServiceWorld } from '../support/service.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CLAIM_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'claim_extractor.v2.de.txt');
// With a model adapter the service refuses to start without VERIFIER_PROMPT_FILE (gate 1 of #30, owner 2026-11-18,
// answer 1); before #30 the variable has no effect.
const VERIFIER_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'verifier.v2.de.txt');
const TOPIC_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'topic_extractor.de.txt');
const PRECISION = 0.001;

type Json = Record<string, unknown>;

interface TopicWorld extends World, ServiceWorld {
  sessionId?: string | undefined;
  redisUrl?: string;
  lifetimeSeconds?: number;
  expectationsFile?: string;
  mockLatency?: number;
  mockInvalidCalls?: string;
  topicLatency?: number;
  topicNewRate?: number;
  topicInvalidCalls?: string;
}

// ---- helpers ------------------------------------------------------------------------------------------------

async function streamOf(world: TopicWorld): Promise<Json[]> {
  if (world.sessionId === undefined) throw new Error('no Session');
  const entries = await withRedis(world.redisUrl, (client) =>
    client.xrange(`session:${world.sessionId ?? ''}:detection`, '-', '+'),
  );
  return entries.map(([, fields]) => {
    const at = fields.indexOf('event');
    if (at < 0 || fields[at + 1] === undefined)
      throw new Error('a detection stream entry has no field "event"');
    return JSON.parse(fields[at + 1] ?? 'null') as Json;
  });
}

async function topicEvents(world: TopicWorld): Promise<Json[]> {
  return (await streamOf(world))
    .filter((entry) => entry['type'] === 'topic')
    .map((entry) => {
      const topic = entry['topic'];
      if (typeof topic !== 'object' || topic === null)
        throw new Error('a topic entry without a Topic event');
      return topic as Json;
    });
}

function newTags(event: Json): { tag: unknown; parent: unknown }[] {
  const list = event['new'];
  return Array.isArray(list) ? (list as { tag: unknown; parent: unknown }[]) : [];
}

function logEvents(world: TopicWorld): Json[] {
  return world.lines.map((line) => JSON.parse(line) as Json);
}

function sessionEvents(world: TopicWorld, event: string): Json[] {
  return logEvents(world).filter((e) => e['event'] === event && e['sessionId'] === world.sessionId);
}

// ---- steps --------------------------------------------------------------------------------------------------

Given(
  'the mock Topic Extractor answers after {float} seconds and opens a sub-topic with the rate {float}',
  function (this: TopicWorld, seconds: number, rate: number) {
    this.topicLatency = seconds;
    this.topicNewRate = rate;
  },
);

Given(
  'the mock Topic Extractor answers no JSON on its calls {string}',
  function (this: TopicWorld, calls: string) {
    this.topicInvalidCalls = calls;
  },
);

Given(
  'the detection service runs with the Redis of the test project, the mock Claim Extractor and the mock Topic Extractor',
  async function (this: TopicWorld) {
    if (this.expectationsFile === undefined) throw new Error('the Claim mock has no expectations');
    await startService(this, {
      ...testProjectRedis(),
      // The Sessions of every earlier scenario of this run stay in the index of live Sessions until their lifetime
      // ends (#27); these scenarios do not test the cap of 20 (MAX_SESSIONS), so it must not refuse their Session.
      MAX_SESSIONS: '1000',
      MODEL_ADAPTER: 'mock',
      CLAIM_EXTRACTOR_PROMPT_FILE: CLAIM_PROMPT,
      VERIFIER_PROMPT_FILE: VERIFIER_PROMPT,
      MOCK_EXPECTATIONS_FILE: this.expectationsFile,
      MOCK_LATENCY_SECONDS: String(this.mockLatency ?? 0),
      ...(this.mockInvalidCalls === undefined ? {} : { MOCK_INVALID_CALLS: this.mockInvalidCalls }),
      TOPIC_EXTRACTOR_PROMPT_FILE: TOPIC_PROMPT,
      MOCK_TOPIC_LATENCY_SECONDS: String(this.topicLatency ?? 0),
      MOCK_TOPIC_NEW_RATE: String(this.topicNewRate ?? 0),
      ...(this.topicInvalidCalls === undefined
        ? {}
        : { MOCK_TOPIC_INVALID_CALLS: this.topicInvalidCalls }),
      ...(this.lifetimeSeconds === undefined
        ? {}
        : { SESSION_LIFETIME_SECONDS: String(this.lifetimeSeconds) }),
    });
  },
);

Then(
  'the Topic Extractor was called {int} times for the Session, each call {string}',
  function (this: TopicWorld, count: number, outcome: string) {
    const calls = sessionEvents(this, 'topic_extractor.call');
    if (calls.length !== count)
      throw new Error(`${calls.length} topic_extractor.call events, expected ${count}`);
    const other = calls.filter((c) => c['outcome'] !== outcome);
    if (other.length > 0)
      throw new Error(
        `${other.length} call(s) ended ${JSON.stringify(other.map((c) => c['outcome']))}`,
      );
  },
);

Then(
  'the first Topic event of the Session reports {string} as new under {string}, at the Tick time {float}',
  async function (this: TopicWorld, tag: string, parent: string, tickAt: number) {
    const [first] = await topicEvents(this);
    if (first === undefined) throw new Error('the Session has no Topic event');
    const reported = newTags(first);
    const close = Math.abs(Number(first['tickAt']) - tickAt) <= PRECISION;
    if (!close || !reported.some((n) => n.tag === tag && n.parent === parent))
      throw new Error(
        `the first Topic event reports ${reported.length} new tag(s) at ${String(first['tickAt'])}`,
      );
  },
);

Then(
  'no Topic event of the Session reports {string} as new',
  async function (this: TopicWorld, tag: string) {
    const events = await topicEvents(this);
    if (events.length === 0) throw new Error('the Session has no Topic event');
    const found = events.filter((e) => newTags(e).some((n) => n.tag === tag));
    if (found.length > 0) throw new Error(`${found.length} Topic event(s) report it as new`);
  },
);

Then(
  'no tag is reported as new in more than one Topic event of the Session',
  async function (this: TopicWorld) {
    const events = await topicEvents(this);
    if (events.length === 0) throw new Error('the Session has no Topic event');
    const seen = new Map<unknown, number>();
    for (const event of events) {
      for (const tag of new Set(newTags(event).map((n) => n.tag)))
        seen.set(tag, (seen.get(tag) ?? 0) + 1);
    }
    const twice = [...seen.values()].filter((n) => n > 1).length;
    if (twice > 0) throw new Error(`${twice} tag(s) are reported as new more than once`);
  },
);

Then(
  'every entry of the detection stream is a valid detection event of the Session',
  async function (this: TopicWorld) {
    const { DetectionEvent } = await import('@lfc/contracts');
    const entries = await streamOf(this);
    if (entries.length === 0) throw new Error('the detection stream is empty');
    for (const entry of entries) {
      const parsed = DetectionEvent.safeParse(entry);
      if (!parsed.success)
        throw new Error(
          `an entry fails the contract at ${JSON.stringify(parsed.error.issues.map((i) => i.path))}`,
        );
      if (entry['sessionId'] !== this.sessionId) throw new Error('an entry names another Session');
    }
  },
);

Then(
  'the detection stream of the Session holds {int} Claim event(s) and at least one Topic event',
  async function (this: TopicWorld, count: number) {
    const entries = await streamOf(this);
    const claims = entries.filter((e) => e['type'] === 'claim').length;
    const topics = entries.filter((e) => e['type'] === 'topic').length;
    if (claims !== count || topics === 0)
      throw new Error(`the detection stream holds ${claims} Claim and ${topics} Topic events`);
  },
);

Then(
  'the detection stream of the Session holds {int} Topic event(s)',
  async function (this: TopicWorld, count: number) {
    const events = await topicEvents(this);
    if (events.length !== count)
      throw new Error(
        `the detection stream holds ${events.length} Topic events, expected ${count}`,
      );
  },
);

Then(
  'exactly {int} {string} event(s) of the Session name(s) the {extractor}, for Turn {string}',
  function (this: TopicWorld, count: number, event: string, extractor: string, turnId: string) {
    const found = sessionEvents(this, event).filter((e) => e['modelRole'] === extractor);
    if (found.length !== count || found.some((e) => e['turnId'] !== turnId))
      throw new Error(
        `found ${found.length} ${event} event(s) for ${JSON.stringify(found.map((e) => e['turnId']))}`,
      );
  },
);

Then(
  'exactly {int} {string} event(s) of the Session name(s) the {extractor}',
  function (this: TopicWorld, count: number, event: string, extractor: string) {
    const found = sessionEvents(this, event).filter((e) => e['modelRole'] === extractor);
    if (found.length !== count)
      throw new Error(`found ${found.length} ${event} event(s), expected ${count}`);
  },
);

Then(
  'no log line contains a tag of a Topic event of the Session',
  async function (this: TopicWorld) {
    const tags = new Set<string>();
    for (const event of await topicEvents(this)) {
      for (const field of ['current', 'returned', 'ended']) {
        const list = event[field];
        if (Array.isArray(list)) for (const tag of list) tags.add(String(tag));
      }
      for (const n of newTags(event)) tags.add(String(n.tag));
    }
    if (tags.size === 0) throw new Error('the Session has no tag in a Topic event');
    const leaking = this.lines.filter((line) => [...tags].some((tag) => line.includes(tag)));
    if (leaking.length > 0) throw new Error(`${leaking.length} log line(s) contain a tag`);
  },
);

Then(
  'every {string} event of the Session carries the Session id, the role, the Turn id, final, the outcome, the duration, the tokens and the cost',
  function (this: TopicWorld, event: string) {
    const calls = sessionEvents(this, event);
    if (calls.length === 0) throw new Error(`no ${event} event of the Session`);
    const required = [
      'modelRole',
      'turnId',
      'final',
      'outcome',
      'durationMs',
      'inputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'outputTokens',
      'thinkingTokens',
      'costUsd',
    ];
    for (const call of calls) {
      const missing = required.filter((field) => call[field] === undefined);
      if (missing.length > 0) throw new Error(`a ${event} event lacks ${missing.join(', ')}`);
      if (call['modelRole'] !== 'topic_extractor')
        throw new Error(`a ${event} event names another role`);
      if (typeof call['final'] !== 'boolean')
        throw new Error(`a ${event} event has no boolean final`);
    }
  },
);
