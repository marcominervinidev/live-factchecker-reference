// Stage-2a steps for the Claim Extractor in a Session (issue #29, T4, Task 3; feature features/claim-extractor.feature).
// In-process: the service runs through startDetection (support/service.ts, #27) against the Redis of the test project,
// with the mock adapter of @lfc/providers; Segments go in through the Session routes of #27, the recording fixture is
// cut by tests/fixtures/golden-window.mjs (step "the recording fixture {string}" of turn-building.steps.ts, #28) and
// replayed through T2's STT-recording Input. Steps observe behaviour only: HTTP answers, log lines, Redis keys.
// Extends the step libraries of detection.steps.ts (#25: World `lines`, `port`), session.steps.ts (#27: World
// `sessionId`, `baselineKeys`, `earlierIds`, `lifetimeSeconds`, `redisUrl`) and turn-building.steps.ts (#28: World
// `recording`, `replayed`); it never copies their steps.
//
// Interface these steps define (built in Task 3; names: gate 1, owner 2026-11-03, question 10 "Angenommen"):
//   Environment: MODEL_ADAPTER=mock, CLAIM_EXTRACTOR_PROMPT_FILE, MOCK_EXPECTATIONS_FILE, MOCK_LATENCY_SECONDS,
//                MOCK_INVALID_CALLS (src/config.claim-extractor.test.ts); VERIFIER_PROMPT_FILE, because with a model
//                adapter the service refuses to start without it (owner unlock for #30, gate 1 of #30 on 2026-11-18,
//                answer 1; the mock Verifier accepts every Claim after 0 s, so #29's timings stay)
//   POST /sessions          body (optional, #27's body-less creation stays valid):
//                           { setting: { mode, speakers?: [{ name, role, public }], topic? },
//                             speakerNames?: { <label>: <name> } }        -> 2xx { id, ... }
//   POST /sessions/{id}/end -> 2xx once every call of the Session has returned (gate 1, owner 2026-11-03, question 2)
//   Redis stream `session:<id>:detection`, one entry per detection event, field `event` = the envelope as JSON
//   (DetectionEvent of @lfc/contracts); a key of the Session (it expires with it, AC16)
//   POST /sessions/{id}/end on an unknown Session -> 4xx "Session unknown"; a second end -> 2xx again, no new call
//   (gate 1, owner 2026-11-03, question 2)
//   Log events: claim_extractor.call { sessionId, modelRole, turnId, attempts, outcome },
//               candidate.created { sessionId, turnId, candidateId, reason }
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { After, DataTable, Given, Then, When, type World } from '@cucumber/cucumber';
import type { Segment } from '@lfc/contracts';

import { allKeys, contentOf, withRedis } from '../support/redis.ts';
import { startService, testProjectRedis, type ServiceWorld } from '../support/service.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'claim_extractor.v2.de.txt');
const VERIFIER_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'verifier.v2.de.txt');
const REFERENCE = /^golden: ([a-z0-9][a-z0-9-]*) (\d{2}):(\d{2})-(\d{2}):(\d{2})$/;
const PRECISION = 0.001;

interface Answer {
  readonly status: number;
  readonly body: string;
}

interface ClaimWorld extends World, ServiceWorld {
  sessionId?: string | undefined;
  earlierIds?: Set<string>;
  baselineKeys?: Set<string>;
  lifetimeSeconds?: number;
  redisUrl?: string;
  recording?: string;
  replayed?: Segment[];
  expectationsFile?: string;
  mockLatency?: number;
  mockInvalidCalls?: string;
  setting?: { speakers: string[]; topic: string };
  endAnswer?: Answer;
  /** The last answer, read by the Then steps of session.steps.ts ("the service rejects the {word} as {string}"). */
  answer?: Answer;
  scratchDirs?: string[];
}

// ---- helpers ------------------------------------------------------------------------------------------------

function scratch(world: ClaimWorld): string {
  const dir = mkdtempSync(join(tmpdir(), 'lfc-29-2a-'));
  (world.scratchDirs ??= []).push(dir);
  return dir;
}

async function call(
  world: ClaimWorld,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${world.port}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.text() };
}

const ok = (answer: Answer | undefined) =>
  answer !== undefined && answer.status >= 200 && answer.status <= 299;

async function streamOf(
  world: ClaimWorld,
  sessionId: string | undefined,
): Promise<Record<string, unknown>[]> {
  if (sessionId === undefined) throw new Error('no Session');
  const entries = await withRedis(world.redisUrl, (client) =>
    client.xrange(`session:${sessionId}:detection`, '-', '+'),
  );
  return entries.map(([, fields]) => {
    const at = fields.indexOf('event');
    if (at < 0 || fields[at + 1] === undefined)
      throw new Error('a detection stream entry has no field "event"');
    return JSON.parse(fields[at + 1] ?? 'null') as Record<string, unknown>;
  });
}

function claimOf(event: Record<string, unknown>): Record<string, unknown> {
  const claim = event['claim'];
  if (typeof claim !== 'object' || claim === null)
    throw new Error(`entry without a Claim: ${JSON.stringify(event['type'])}`);
  return claim as Record<string, unknown>;
}

function logEvents(world: ClaimWorld): Record<string, unknown>[] {
  return world.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Keys written since the Session was created that hold the text and are no key of the World's Session (their name
 * does not contain its id). Keys that existed before (Sessions of earlier scenarios replaying the same fixture) are
 * not counted.
 */
async function keysOutsideHolding(world: ClaimWorld, texts: readonly string[]): Promise<string[]> {
  const id = world.sessionId ?? '\u0000';
  const baseline = world.baselineKeys ?? new Set<string>();
  return withRedis(world.redisUrl, async (client) => {
    const found: string[] = [];
    for (const key of await allKeys(client)) {
      if (key.includes(id) || baseline.has(key)) continue;
      const content = await contentOf(client, key);
      if (texts.some((text) => content.includes(text))) found.push(key);
    }
    return found;
  });
}

async function start(world: ClaimWorld, extra: Record<string, string>): Promise<void> {
  if (world.expectationsFile === undefined) throw new Error('the mock has no expectations');
  await startService(world, {
    ...testProjectRedis(),
    MODEL_ADAPTER: 'mock',
    CLAIM_EXTRACTOR_PROMPT_FILE: PROMPT,
    VERIFIER_PROMPT_FILE: VERIFIER_PROMPT,
    MOCK_EXPECTATIONS_FILE: world.expectationsFile,
    MOCK_LATENCY_SECONDS: String(world.mockLatency ?? 0),
    ...(world.mockInvalidCalls === undefined ? {} : { MOCK_INVALID_CALLS: world.mockInvalidCalls }),
    ...extra,
  });
}

// ---- steps --------------------------------------------------------------------------------------------------

Given(
  'the expectations of the mock are the Golden Set labels of {string}',
  function (this: ClaimWorld, reference: string) {
    const match = REFERENCE.exec(reference);
    if (match === null) throw new Error(`not a Golden Set reference: ${reference}`);
    const [, slug, m1, s1, m2, s2] = match;
    const from = Number(m1) * 60 + Number(s1);
    const to = Number(m2) * 60 + Number(s2);
    // a reference to the Golden Set, never a copy: the labels are read at run time and written to a scratch file
    const lines = readFileSync(join(ROOT, 'evals', 'golden', slug ?? '', 'labels.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .filter((line) => {
        const start = Number((JSON.parse(line) as Record<string, unknown>)['start']);
        return start >= from && start < to;
      });
    if (lines.length === 0) throw new Error(`no label of ${reference}`);
    this.expectationsFile = join(scratch(this), 'labels.jsonl');
    writeFileSync(this.expectationsFile, `${lines.join('\n')}\n`);
  },
);

Given('the expectations of the mock contain no Claim', function (this: ClaimWorld) {
  this.expectationsFile = join(scratch(this), 'labels.jsonl');
  writeFileSync(this.expectationsFile, '');
});

Given(
  'the expectations of the mock are these labels:',
  function (this: ClaimWorld, table: DataTable) {
    // `start` from the row number: parseExpectations orders by it and requires it (packages/providers/src/mock/
    // mock-claim-extractor.ts), so the table order is the answer order (owner unlock after #30 critic, finding 11).
    const lines = table.hashes().map((row, index) =>
      JSON.stringify({
        id: row['id'],
        speaker: row['speaker'],
        sentence: row['sentence'],
        verbatim: row['verbatim'],
        type: 'ereignis',
        checkworthiness: 'hoch',
        kind: row['kind'],
        refersTo: row['refersTo'] === undefined || row['refersTo'] === '' ? null : row['refersTo'],
        repeatOf: null,
        start: index + 1,
      }),
    );
    this.expectationsFile = join(scratch(this), 'labels.jsonl');
    writeFileSync(this.expectationsFile, `${lines.join('\n')}\n`);
  },
);

Given(
  'the mock Claim Extractor answers after {float} seconds',
  function (this: ClaimWorld, seconds: number) {
    this.mockLatency = seconds;
  },
);

Given(
  'the mock Claim Extractor answers no JSON on its calls {string}',
  function (this: ClaimWorld, calls: string) {
    this.mockInvalidCalls = calls;
  },
);

Given(
  'the detection service runs with the Redis of the test project and the mock Claim Extractor',
  async function (this: ClaimWorld) {
    await start(
      this,
      this.lifetimeSeconds === undefined
        ? {}
        : { SESSION_LIFETIME_SECONDS: String(this.lifetimeSeconds) },
    );
  },
);

Given('the Session lifetime is {int} seconds', function (this: ClaimWorld, seconds: number) {
  this.lifetimeSeconds = seconds;
});

Given(
  'the client creates a Session in mode {string} with the Topic {string} and these Speakers:',
  async function (this: ClaimWorld, mode: string, topic: string, table: DataTable) {
    const rows = table.hashes();
    const body = {
      setting: {
        mode,
        speakers: rows.map((row) => ({
          name: row['name'],
          role: row['role'],
          public: row['public'] === 'yes',
        })),
        topic,
      },
      speakerNames: Object.fromEntries(
        rows.map((row): [string, string | undefined] => [String(row['label']), row['name']]),
      ),
    };
    if (this.sessionId !== undefined) (this.earlierIds ??= new Set<string>()).add(this.sessionId);
    this.baselineKeys = new Set(await withRedis(this.redisUrl, allKeys));
    const answer = await call(this, 'POST', '/sessions', body);
    if (!ok(answer))
      throw new Error(`creating a Session with a Setting: status ${answer.status} ${answer.body}`);
    const id = (JSON.parse(answer.body) as Record<string, unknown>)['id'];
    if (typeof id !== 'string' || id === '') throw new Error('the new Session has no id');
    this.sessionId = id;
    this.setting = { speakers: rows.map((row) => row['name'] ?? ''), topic };
  },
);

When(
  'the recording fixture is replayed into the Session through its routes',
  async function (this: ClaimWorld) {
    if (this.recording === undefined || this.sessionId === undefined)
      throw new Error('no recording fixture or no Session');
    // T2's STT-recording Input (frozen with #27); loaded here, at run time
    const { sttRecordingInput } = await import('@lfc/inputs');
    const input = await sttRecordingInput({
      recording: this.recording,
      sessionId: this.sessionId,
      language: 'de',
    });
    const replayed: Segment[] = [];
    for await (const segment of input.segments) {
      replayed.push(segment);
      const answer = await call(this, 'POST', `/sessions/${this.sessionId}/segments`, segment);
      if (!ok(answer)) throw new Error(`Segment ${segment.id} refused: status ${answer.status}`);
    }
    this.replayed = replayed;
  },
);

When('the client ends the Input of the Session', async function (this: ClaimWorld) {
  this.endAnswer = await call(this, 'POST', `/sessions/${this.sessionId ?? ''}/end`);
  this.answer = this.endAnswer;
});

When('the client ends the Input of a Session id nobody created', async function (this: ClaimWorld) {
  this.endAnswer = await call(this, 'POST', '/sessions/29a0c0de-0000-4000-8000-0000000000ff/end');
  this.answer = this.endAnswer;
});

Then('the Input ended normally', function (this: ClaimWorld) {
  if (!ok(this.endAnswer))
    throw new Error(
      `ending the Input: status ${String(this.endAnswer?.status)} ${this.endAnswer?.body ?? ''}`,
    );
});

Then(
  'the detection stream of the Session holds exactly these Claim events, in this order:',
  async function (this: ClaimWorld, table: DataTable) {
    const actual = (await streamOf(this, this.sessionId)).map(claimOf);
    const expected = table.hashes();
    const same =
      actual.length === expected.length &&
      actual.every((claim, i) => {
        const row = expected[i] ?? {};
        const close = (field: string) =>
          Math.abs(Number(claim[field]) - Number(row[field])) <= PRECISION;
        return (
          claim['id'] === row['id'] &&
          claim['speaker'] === row['speaker'] &&
          claim['speakerLabel'] === row['speakerLabel'] &&
          claim['turnId'] === row['turnId'] &&
          JSON.stringify(claim['segmentIds']) ===
            JSON.stringify((row['segmentIds'] ?? '').trim().split(/\s+/)) &&
          close('lastWordEnd') &&
          close('emittedAt')
        );
      });
    if (!same) {
      const shown = actual.map((c) =>
        JSON.stringify({
          id: c['id'],
          speakerLabel: c['speakerLabel'],
          turnId: c['turnId'],
          segmentIds: c['segmentIds'],
          lastWordEnd: c['lastWordEnd'],
          emittedAt: c['emittedAt'],
        }),
      );
      throw new Error(
        `the detection stream holds ${actual.length} Claim event(s):\n${shown.join('\n')}`,
      );
    }
  },
);

Then(
  'every entry of the detection stream is a valid detection event of the Session, not earlier than the end of its last word',
  async function (this: ClaimWorld) {
    const { DetectionEvent } = await import('@lfc/contracts');
    const entries = await streamOf(this, this.sessionId);
    if (entries.length === 0) throw new Error('the detection stream is empty');
    for (const entry of entries) {
      const parsed = DetectionEvent.safeParse(entry);
      if (!parsed.success)
        throw new Error(
          `an entry fails the contract at ${JSON.stringify(parsed.error.issues.map((i) => i.path))}`,
        );
      const claim = claimOf(entry);
      if (entry['sessionId'] !== this.sessionId) throw new Error('an entry names another Session');
      if (!(Number(claim['emittedAt']) >= Number(claim['lastWordEnd'])))
        throw new Error(`${String(claim['id'])} is earlier than its last word`);
    }
  },
);

Then(
  'the detection stream of the Session holds {int} Claim event(s)',
  async function (this: ClaimWorld, count: number) {
    // every entry counts: until T6 adds topic events, an entry of another type is a defect too
    const entries = await streamOf(this, this.sessionId);
    if (entries.length !== count)
      throw new Error(`the detection stream holds ${entries.length} entries, expected ${count}`);
  },
);

Then(
  'the detection stream of the earlier Session holds {int} Claim event(s)',
  async function (this: ClaimWorld, count: number) {
    const [earlier] = [...(this.earlierIds ?? [])];
    if (earlier === undefined) throw new Error('no earlier Session');
    const entries = await streamOf(this, earlier);
    if (entries.length !== count)
      throw new Error(`the earlier Session's stream holds ${entries.length} entries`);
  },
);

Then(
  'the Claim Extractor was called {int} times for the Session, each call {string}',
  function (this: ClaimWorld, count: number, outcome: string) {
    const calls = logEvents(this).filter(
      (e) => e['event'] === 'claim_extractor.call' && e['sessionId'] === this.sessionId,
    );
    if (calls.length !== count)
      throw new Error(`${calls.length} claim_extractor.call events, expected ${count}`);
    const other = calls.filter((c) => c['outcome'] !== outcome);
    if (other.length > 0)
      throw new Error(
        `${other.length} call(s) ended ${JSON.stringify(other.map((c) => c['outcome']))}`,
      );
  },
);

Then(
  'exactly one {string} event of the Session for Turn {string} has the outcome {string} after {int} attempts',
  function (this: ClaimWorld, event: string, turnId: string, outcome: string, attempts: number) {
    const found = logEvents(this).filter(
      (e) =>
        e['event'] === event &&
        e['sessionId'] === this.sessionId &&
        e['turnId'] === turnId &&
        e['outcome'] === outcome,
    );
    if (found.length !== 1 || found[0]?.['attempts'] !== attempts)
      throw new Error(`found ${JSON.stringify(found)}`);
  },
);

Then(
  'exactly one {string} event names the Session with Candidate {string} and reason {string}',
  function (this: ClaimWorld, event: string, candidateId: string, reason: string) {
    const found = logEvents(this).filter((e) => e['event'] === event);
    if (found.length !== 1) throw new Error(`expected one ${event} event, got ${found.length}`);
    const [only] = found;
    if (
      only?.['sessionId'] !== this.sessionId ||
      only?.['candidateId'] !== candidateId ||
      only['reason'] !== reason
    )
      throw new Error(
        `the ${event} event names ${JSON.stringify({ candidateId: only?.['candidateId'], reason: only?.['reason'] })}`,
      );
  },
);

Then(
  'no log line contains a Speaker name or the Topic of the Setting',
  function (this: ClaimWorld) {
    const texts = [...(this.setting?.speakers ?? []), this.setting?.topic ?? ''].filter(
      (t) => t !== '',
    );
    const words = texts.flatMap((t) => t.split(/\s+/)).filter((w) => w.length >= 4);
    const leaking = this.lines.filter((line) =>
      [...texts, ...words].some((text) => line.includes(text)),
    );
    if (leaking.length > 0) throw new Error(`${leaking.length} log line(s) contain Setting text`);
  },
);

Then(
  'no Redis key outside the Session holds {string}',
  async function (this: ClaimWorld, text: string) {
    const found = await keysOutsideHolding(this, [text]);
    if (found.length > 0)
      throw new Error(`${found.length} Redis key(s) outside the Session hold it`);
  },
);

Then(
  'no Redis key outside the Session holds the sentence of a Claim event of the Session',
  async function (this: ClaimWorld) {
    const sentences = (await streamOf(this, this.sessionId)).map((e) =>
      String(claimOf(e)['sentence']),
    );
    if (sentences.length === 0) throw new Error('the Session has no Claim event');
    const found = await keysOutsideHolding(this, sentences);
    if (found.length > 0)
      throw new Error(`${found.length} Redis key(s) outside the Session hold a Claim sentence`);
  },
);

After(function (this: ClaimWorld) {
  for (const dir of this.scratchDirs ?? []) rmSync(dir, { recursive: true, force: true });
});
