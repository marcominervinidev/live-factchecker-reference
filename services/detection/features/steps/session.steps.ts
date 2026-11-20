// Stage-2a steps for Sessions of the detection service (issue #27, T2, Task 3; feature features/session.feature).
// Extends the step library of features/steps/detection.steps.ts (#25, frozen): it reuses its World (port, lines,
// exited, exitCode, signals; its After hook stops the service) and its start step for the default lifetime.
// Shared helpers without steps live in features/support/service.ts.
// Steps observe behaviour only: HTTP answers of the service, the log lines it wrote, and the keys Redis reports.
//
// Interface these steps define (built in Task 3, documented in the service README):
//   SESSION_LIFETIME_SECONDS   environment variable, default 900, validated in src/config.ts (configuration from the
//                              environment only, .claude/rules/platform.md); 2a sets a few seconds
//   POST /sessions                    -> 2xx, JSON { id, ... }              create a Session
//   POST /sessions/{id}/segments      -> 2xx accepted | 4xx rejected        body: one Segment (JSON)
//   GET  /sessions/{id}               -> 2xx JSON { id, segments, lastSegmentId, lastFinalizedAt, remainingSeconds }
//   A rejection names the failing field in its body; an unknown Session answers 4xx with "Session unknown".
//   Log event of an accepted Segment: { event: "segment.accepted", sessionId, segmentId } (platform.md fields plus
//   segmentId, which the logging module of packages/service-kit gains with this ticket).
//   SESSION_BYTE_BUDGET, MAX_SESSIONS  environment variables (owner decision 2026-10-29, service README): the JSON
//                              bytes the Segments of one Session may add up to, and how many Sessions may live at once
//   POST /sessions                    -> 409 "no room for another Session" while MAX_SESSIONS Sessions live
//   POST /sessions/{id}/segments      -> 409 "Session full" when the Segment would take the Session past the budget
//   Redis key `sessions:live`: the index of the live Sessions (sorted set of Session ids), the one key outside a Session
// Every Redis key a Session holds is a key that did not exist before the Session was created (scenarios run one
// after another) or a key whose name contains the Session id; the index of live Sessions is never one of them.
import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Given, Then, When, type World } from '@cucumber/cucumber';
import { Redis } from 'ioredis';

import { eventually, required, startService, testProjectRedis } from '../support/service.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface Answer {
  readonly status: number;
  readonly body: string;
}

interface SentSegment {
  readonly id: string;
  readonly speaker: unknown;
  readonly finalizedAt: number;
  readonly words: readonly string[];
}

/** The World of detection.steps.ts plus the state of this file (set on the same object). */
interface SessionWorld extends World {
  port: number;
  lines: string[];
  exitCode: number | undefined;
  exited: Promise<number>;
  signals: EventEmitter;
  lifetimeSeconds?: number;
  sessionId?: string | undefined;
  earlierIds?: Set<string>;
  baselineKeys?: Set<string>;
  answer?: Answer;
  sent?: SentSegment;
  /** The last Segment the service accepted (2xx); a rejected one never replaces it. */
  accepted?: SentSegment;
  clock?: number | undefined;
  compose?: string;
  /** The Redis the service of this scenario uses, when not the test project's default database. */
  redisUrl?: string;
  /** JSON bytes of the Segments the service accepted into the World's Session. */
  storedBytes?: number;
}

/** The index of the live Sessions (service README; owner decision 2026-10-29): Session ids only, no word, no label. */
const LIVE_INDEX = 'sessions:live';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---- helpers ------------------------------------------------------------------------------------------------

async function call(
  world: SessionWorld,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${world.port}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
    signal: AbortSignal.timeout(3000),
  });
  return { status: response.status, body: await response.text() };
}

function redis(url: string): Redis {
  const target = new URL(url);
  const password = readFileSync(required('REDIS_PASSWORD_FILE'), 'utf8').replace(/\r?\n$/, '');
  return new Redis({
    host: target.hostname,
    port: Number(target.port || 6379),
    db: Number(target.pathname.slice(1) || '0'),
    password,
    lazyConnect: true,
    // the ready check runs INFO, which the ACL denies (compose.yml)
    enableReadyCheck: false,
    maxRetriesPerRequest: 1,
  });
}

/** A client of the Redis database the World's service uses. */
async function withRedis<T>(
  world: { readonly redisUrl?: string | undefined },
  use: (client: Redis) => Promise<T>,
): Promise<T> {
  const client = redis(world.redisUrl ?? required('REDIS_URL'));
  try {
    await client.connect();
    return await use(client);
  } finally {
    client.disconnect();
  }
}

async function allKeys(client: Redis): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(cursor, 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function sessionKeys(world: SessionWorld, client: Redis): Promise<string[]> {
  const baseline = world.baselineKeys ?? new Set<string>();
  const id = world.sessionId ?? '\u0000';
  return (await allKeys(client)).filter(
    (key) => key !== LIVE_INDEX && (!baseline.has(key) || key.includes(id)),
  );
}

/** Every string a key holds, whatever its type (stream, hash, list, set, string). */
async function contentOf(client: Redis, key: string): Promise<string> {
  const type = await client.type(key);
  if (type === 'string') return (await client.get(key)) ?? '';
  if (type === 'hash') return JSON.stringify(await client.hgetall(key));
  if (type === 'list') return JSON.stringify(await client.lrange(key, 0, -1));
  if (type === 'set') return JSON.stringify(await client.smembers(key));
  if (type === 'zset') return JSON.stringify(await client.zrange(key, 0, '-1'));
  if (type === 'stream') return JSON.stringify(await client.xrange(key, '-', '+'));
  return '';
}

function parse(answer: Answer | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(answer?.body ?? 'null');
  if (typeof value !== 'object' || value === null)
    throw new Error(`expected a JSON object, got ${answer?.body ?? 'nothing'}`);
  return value as Record<string, unknown>;
}

async function state(world: SessionWorld): Promise<Answer> {
  return call(world, 'GET', `/sessions/${world.sessionId ?? ''}`);
}

async function knownState(world: SessionWorld): Promise<Record<string, unknown>> {
  const answer = await state(world);
  if (answer.status < 200 || answer.status > 299)
    throw new Error(`state of the Session: status ${answer.status} ${answer.body}`);
  return parse(answer);
}

function segmentWords(text: string): string[] {
  return text.split(' ').filter((word) => word !== '');
}

/** A contract-valid Segment of the World's Session; times follow on from the previous one. */
function buildSegment(
  world: SessionWorld,
  id: string,
  speaker: string,
  text: string,
): Record<string, unknown> {
  const start = world.clock ?? 1;
  const words = segmentWords(text).map((w, i) => ({
    w,
    start: start + i * 0.4,
    end: start + (i + 1) * 0.4,
  }));
  const end = words.at(-1)?.end ?? start;
  world.clock = end + 1;
  return {
    schemaVersion: 1,
    id,
    sessionId: world.sessionId,
    speaker,
    start,
    end,
    finalizedAt: end + 0.5,
    language: 'de',
    words,
  };
}

// One change per defect; each yields exactly one contract violation (features/session.feature, AC8 and AC9).
const DEFECTS: Readonly<Record<string, (segment: Record<string, unknown>) => void>> = {
  'an overlap field': (s) => {
    s['overlap'] = true;
  },
  'speaker as a number 1': (s) => {
    s['speaker'] = 1;
  },
  'finalizedAt 0.001 s before end': (s) => {
    s['finalizedAt'] = Number(s['end']) - 0.001;
  },
  'speaker "Kallac Haqy"': (s) => {
    s['speaker'] = 'Kallac Haqy';
  },
  'the sessionId of another Session': (s) => {
    s['sessionId'] = randomUUID();
  },
};

async function send(
  world: SessionWorld,
  segment: Record<string, unknown>,
  text: string,
): Promise<void> {
  world.sent = {
    id: String(segment['id']),
    speaker: segment['speaker'],
    finalizedAt: Number(segment['finalizedAt']),
    words: segmentWords(text).map((word) => word.replace(/[.,?!…]+$/, '')),
  };
  world.answer = await call(world, 'POST', `/sessions/${world.sessionId ?? ''}/segments`, segment);
  if (world.answer.status >= 200 && world.answer.status <= 299) {
    world.accepted = world.sent;
    world.storedBytes = (world.storedBytes ?? 0) + Buffer.byteLength(JSON.stringify(segment));
  }
}

function logLines(world: SessionWorld): Record<string, unknown>[] {
  return world.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ---- steps --------------------------------------------------------------------------------------------------

Given(
  'the detection service runs with the Redis of the test project and a Session lifetime of {int} seconds',
  async function (this: SessionWorld, seconds: number) {
    this.lifetimeSeconds = seconds;
    await startService(this, { ...testProjectRedis(), SESSION_LIFETIME_SECONDS: String(seconds) });
  },
);

/**
 * The URL of the first database of the test project's Redis that holds no key (1 to 15; database 0 is shared). Not
 * safe for scenarios in parallel (two could pick the same database); cucumber.json runs them one after another.
 */
async function emptyDatabase(): Promise<string> {
  const base = new URL(required('REDIS_URL'));
  const sizes = await withRedis({ redisUrl: base.href }, async (client) => {
    const found: number[] = [];
    for (let db = 1; db <= 15; db += 1) {
      await client.select(db);
      found.push(await client.dbsize());
    }
    return found;
  });
  const index = sizes.indexOf(0);
  if (index < 0)
    throw new Error('every database 1 to 15 of the Redis of the test project holds keys');
  base.pathname = `/${index + 1}`;
  return base.href;
}

Given(
  'the detection service runs with an empty database of the Redis of the test project, a Session lifetime of {int} seconds, a byte budget of {int} bytes and at most {int} Sessions',
  async function (this: SessionWorld, seconds: number, budget: number, sessions: number) {
    // own database: the Sessions of the other scenarios neither count against these limits nor see them
    this.redisUrl = await emptyDatabase();
    this.lifetimeSeconds = seconds;
    await startService(this, {
      REDIS_URL: this.redisUrl,
      REDIS_PASSWORD_FILE: required('REDIS_PASSWORD_FILE'),
      SESSION_LIFETIME_SECONDS: String(seconds),
      SESSION_BYTE_BUDGET: String(budget),
      MAX_SESSIONS: String(sessions),
    });
  },
);

async function createSession(world: SessionWorld): Promise<string> {
  const answer = await call(world, 'POST', '/sessions');
  if (answer.status < 200 || answer.status > 299) {
    throw new Error(`creating a Session: status ${answer.status} ${answer.body}`);
  }
  const id = parse(answer)['id'];
  if (typeof id !== 'string' || id === '')
    throw new Error(`the new Session has no id: ${answer.body}`);
  world.answer = answer;
  return id;
}

Given('an earlier Session exists', async function (this: SessionWorld) {
  this.earlierIds ??= new Set<string>();
  this.earlierIds.add(await createSession(this));
});

When('the client creates a Session', async function (this: SessionWorld) {
  if (this.sessionId !== undefined) (this.earlierIds ??= new Set<string>()).add(this.sessionId);
  this.baselineKeys = new Set(await withRedis(this, allKeys));
  this.sessionId = await createSession(this);
});

When('the client asks for another Session', async function (this: SessionWorld) {
  // unlike "the client creates a Session", a refusal is an outcome here, not a failure of the step
  if (this.sessionId !== undefined) (this.earlierIds ??= new Set<string>()).add(this.sessionId);
  this.baselineKeys = new Set(await withRedis(this, allKeys));
  this.answer = await call(this, 'POST', '/sessions');
  const accepted = this.answer.status >= 200 && this.answer.status <= 299;
  const id = accepted ? parse(this.answer)['id'] : undefined;
  this.sessionId = typeof id === 'string' ? id : undefined;
});

Given('{int} seconds have passed', async function (seconds: number) {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
});

When(
  'the client sends Segment {string} by Speaker {string} containing {string} to the Session',
  async function (this: SessionWorld, id: string, speaker: string, text: string) {
    await send(this, buildSegment(this, id, speaker, text), text);
  },
);

When(
  'the client sends Segment {string} by Speaker {string} containing {string} with {} to the Session',
  async function (this: SessionWorld, id: string, speaker: string, text: string, defect: string) {
    const change = DEFECTS[defect];
    if (change === undefined)
      throw new Error(`unknown defect "${defect}"; known: ${Object.keys(DEFECTS).join(', ')}`);
    const segment = buildSegment(this, id, speaker, text);
    change(segment);
    await send(this, segment, text);
  },
);

/**
 * A filler word for padding a Segment; its last copy grows letter by letter to hit an exact byte count. Not ASCII on
 * purpose: "ö" is one UTF-16 unit but two UTF-8 bytes, so a budget counted in string length misses the boundary.
 */
const FILLER = 'Wohnungsbauförderung';

When(
  'the client sends Segment {string} by Speaker {string} containing {string} padded to take the Segments of the Session to {int} bytes',
  async function (this: SessionWorld, id: string, speaker: string, text: string, total: number) {
    // the byte budget counts the JSON bytes of the Segments (owner decision 2026-10-29, service README)
    const clock = this.clock;
    const bytes = (words: string): number => {
      this.clock = clock;
      return Buffer.byteLength(JSON.stringify(buildSegment(this, id, speaker, words)));
    };
    const target = total - (this.storedBytes ?? 0);
    let padded = `${text} ${FILLER}`;
    if (bytes(padded) > target) throw new Error(`the Segment alone exceeds ${target} bytes`);
    while (bytes(`${padded} ${FILLER}`) <= target) padded = `${padded} ${FILLER}`;
    padded += 'e'.repeat(target - bytes(padded));
    this.clock = clock;
    const segment = buildSegment(this, id, speaker, padded);
    if (Buffer.byteLength(JSON.stringify(segment)) !== target)
      throw new Error(`padding missed: the Segment has not ${target} bytes`);
    await send(this, segment, padded);
  },
);

When(
  'the client sends Segment {string} by Speaker {string} containing {string} to a Session id nobody created',
  async function (this: SessionWorld, id: string, speaker: string, text: string) {
    this.baselineKeys = new Set(await withRedis(this, allKeys));
    this.sessionId = randomUUID();
    await send(this, buildSegment(this, id, speaker, text), text);
  },
);

When('the lifetime of the Session has run out', async function (this: SessionWorld) {
  const lifetime = this.lifetimeSeconds ?? 900;
  await new Promise((resolve) => setTimeout(resolve, lifetime * 1000));
  await eventually(async () => (await state(this)).status >= 400, 3000, 'the Session expiring');
});

Given('the Compose definition of the stack', function (this: SessionWorld) {
  this.compose = readFileSync(join(ROOT, 'compose.yml'), 'utf8');
});

Then('the Session gets an id no earlier Session had', function (this: SessionWorld) {
  // needs "an earlier Session exists" before it
  if (this.sessionId === undefined || (this.earlierIds?.has(this.sessionId) ?? false)) {
    throw new Error('the new Session reuses an earlier id');
  }
  if ((this.earlierIds?.size ?? 0) === 0) throw new Error('no earlier Session to compare with');
});

Then(
  'the state of the Session shows {int} Segments',
  async function (this: SessionWorld, count: number) {
    const current = await knownState(this);
    if (current['segments'] !== count)
      throw new Error(`expected ${count} Segments, state shows ${JSON.stringify(current)}`);
  },
);

Then(
  'the state of the Session shows last Segment {string}',
  async function (this: SessionWorld, id: string) {
    const current = await knownState(this);
    if (current['lastSegmentId'] !== id)
      throw new Error(`expected last Segment ${id}, state shows ${JSON.stringify(current)}`);
    // the stored last Segment is the last accepted one: a rejected duplicate (same id) must not replace it (AC9)
    const last = this.accepted;
    if (last === undefined || last.id !== id)
      throw new Error(`the last Segment the service accepted is ${last?.id ?? 'none'}, not ${id}`);
    if (current['lastFinalizedAt'] !== last.finalizedAt) {
      throw new Error(
        `expected lastFinalizedAt ${last.finalizedAt}, state shows ${JSON.stringify(current)}`,
      );
    }
  },
);

Then(
  'the remaining lifetime of the Session is {int} seconds',
  async function (this: SessionWorld, seconds: number) {
    const remaining = Number((await knownState(this))['remainingSeconds']);
    // one second of slack: integer seconds in Redis and the time the request took
    if (!(remaining <= seconds && remaining >= seconds - 1)) {
      throw new Error(`expected a remaining lifetime of ${seconds} s, state shows ${remaining}`);
    }
  },
);

Then(
  'the remaining lifetime of the Session is at most {int} seconds',
  async function (this: SessionWorld, seconds: number) {
    const remaining = Number((await knownState(this))['remainingSeconds']);
    if (!(remaining <= seconds))
      throw new Error(
        `the lifetime was renewed: ${remaining} s remain, at most ${seconds} expected`,
      );
  },
);

Then(
  'every Redis key of the Session expires in {int} seconds',
  async function (this: SessionWorld, seconds: number) {
    const ttls = await withRedis(this, async (client) => {
      const keys = await sessionKeys(this, client);
      return Promise.all(keys.map(async (key) => [key, await client.pttl(key)] as const));
    });
    if (ttls.length === 0) throw new Error('the Session holds no Redis key');
    const off = ttls.filter(([, ms]) => !(ms <= seconds * 1000 && ms >= seconds * 1000 - 1500));
    if (off.length > 0)
      throw new Error(
        `${off.length} of ${ttls.length} key(s) of the Session do not expire in ${seconds} s: ${JSON.stringify(off.map(([, ms]) => ms))}`,
      );
  },
);

Then('the state of the Session is {string}', async function (this: SessionWorld, text: string) {
  const answer = await state(this);
  if (answer.status < 400 || answer.status > 499 || !answer.body.includes(text)) {
    throw new Error(`expected 4xx with "${text}", got ${answer.status} ${answer.body}`);
  }
});

Then('no Redis key of the Session remains', async function (this: SessionWorld) {
  const keys = await withRedis(this, (client) => sessionKeys(this, client));
  if (keys.length > 0) throw new Error(`${keys.length} Redis key(s) of the Session remain`);
});

Then('the service {word} the Segment', function (this: SessionWorld, outcome: string) {
  const status = this.answer?.status ?? 0;
  const accepted = status >= 200 && status <= 299;
  const rejected = status >= 400 && status <= 499;
  if (outcome === 'accepts' && !accepted)
    throw new Error(`expected the Segment accepted, got ${status} ${this.answer?.body ?? ''}`);
  if (outcome === 'rejects' && !rejected)
    throw new Error(`expected the Segment rejected, got ${status} ${this.answer?.body ?? ''}`);
  if (outcome !== 'accepts' && outcome !== 'rejects')
    throw new Error(`outcome must be accepts or rejects, got ${outcome}`);
});

Then(
  'the service rejects the Segment naming {string}',
  function (this: SessionWorld, field: string) {
    const status = this.answer?.status ?? 0;
    if (status < 400 || status > 499 || !(this.answer?.body ?? '').includes(field)) {
      throw new Error(`expected a 4xx naming "${field}", got ${status} ${this.answer?.body ?? ''}`);
    }
  },
);

Then(
  'the service rejects the {word} as {string}',
  function (this: SessionWorld, what: string, text: string) {
    if (what !== 'Segment' && what !== 'Session')
      throw new Error(`the service rejects a Segment or a Session, not ${what}`);
    const status = this.answer?.status ?? 0;
    if (status < 400 || status > 499 || !(this.answer?.body ?? '').includes(text)) {
      throw new Error(`expected a 4xx with "${text}", got ${status} ${this.answer?.body ?? ''}`);
    }
  },
);

/** The keys of the World's Session whose content contains the text. */
async function keysHolding(world: SessionWorld, text: string): Promise<string[]> {
  return withRedis(world, async (client) => {
    const keys = await sessionKeys(world, client);
    const found: string[] = [];
    for (const key of keys) if ((await contentOf(client, key)).includes(text)) found.push(key);
    return found;
  });
}

Then(
  'no Redis key of the Session holds {string}',
  async function (this: SessionWorld, text: string) {
    const holding = await keysHolding(this, text);
    if (holding.length > 0)
      throw new Error(`${holding.length} Redis key(s) of the Session hold the rejected Segment`);
  },
);

Then(
  'a Redis key of the Session holds {string}',
  async function (this: SessionWorld, text: string) {
    // the accepted Segment is stored, not only counted (AC6, AC9)
    if ((await keysHolding(this, text)).length === 0)
      throw new Error(`no Redis key of the Session holds "${text}"`);
  },
);

Then('no log line contains a word of the Segment', function (this: SessionWorld) {
  const words = (this.sent?.words ?? []).filter((word) => word.length >= 3);
  if (words.length === 0) throw new Error('no Segment was sent');
  const leaking = this.lines.filter((line) => words.some((word) => line.includes(word)));
  if (leaking.length > 0)
    throw new Error(`${leaking.length} log line(s) contain a word of the Segment`);
});

Then(
  'exactly one {string} event names the Session and Segment {string}',
  function (this: SessionWorld, event: string, segmentId: string) {
    const events = logLines(this).filter((line) => line['event'] === event);
    const [only] = events;
    if (events.length !== 1 || only === undefined)
      throw new Error(`expected one ${event} event, got ${events.length}`);
    if (only['sessionId'] !== this.sessionId || only['segmentId'] !== segmentId) {
      throw new Error(
        `the ${event} event names ${JSON.stringify({ sessionId: only['sessionId'], segmentId: only['segmentId'] })}`,
      );
    }
  },
);

/** True when a parsed log line, at any depth, has a key `speaker` or a string value equal to the label. */
function carriesLabel(value: unknown, label: string): boolean {
  if (value === label) return true;
  if (Array.isArray(value)) return value.some((item) => carriesLabel(item, label));
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, inner]) => key === 'speaker' || carriesLabel(inner, label),
  );
}

Then(
  'no log line carries the Speaker label {string}',
  function (this: SessionWorld, label: string) {
    // the raw line, parsed as written: nothing the logger nests escapes the check
    const carrying = this.lines.filter((line) => carriesLabel(JSON.parse(line), label));
    if (carrying.length > 0)
      throw new Error(`${carrying.length} log line(s) carry a Speaker label`);
  },
);

/** The block of one top-level service in compose.yml: from "  <name>:" to the next line at that indent. */
function serviceBlock(compose: string, name: string): string {
  const lines = compose.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) throw new Error(`compose.yml has no service ${name}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}\S/.test(line) || /^\S/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

Then(
  'the Redis service runs with {string} and {string}',
  function (this: SessionWorld, first: string, second: string) {
    const block = serviceBlock(this.compose ?? '', 'redis');
    for (const option of [first, second]) {
      if (!block.includes(`redis-server`) || !block.includes(option))
        throw new Error(`the redis service does not run with ${option}`);
    }
  },
);

Then(
  'its data directory {string} is on tmpfs and it mounts no volume',
  function (this: SessionWorld, dir: string) {
    const block = serviceBlock(this.compose ?? '', 'redis');
    if (!block.includes(`--dir ${dir}`)) throw new Error(`redis does not keep its data in ${dir}`);
    const tmpfs = /^\s{4}tmpfs:\s*(.*)$/m.exec(block)?.[1] ?? '';
    if (!tmpfs.includes(`'${dir}:`)) throw new Error(`${dir} is not on tmpfs`);
    if (/^\s{4}volumes:/m.test(block)) throw new Error('the redis service mounts a volume');
  },
);

Then(
  'the index of live Sessions is a sorted set of the ids of the {int} Sessions the client created and nothing else',
  async function (this: SessionWorld, count: number) {
    const created = new Set(this.earlierIds);
    if (this.sessionId !== undefined) created.add(this.sessionId);
    if (created.size !== count)
      throw new Error(`the client created ${created.size} Sessions, not ${count}`);
    const [type, members] = await withRedis(this, async (client) => [
      await client.type(LIVE_INDEX),
      await client.zrange(LIVE_INDEX, 0, '-1'),
    ]);
    if (type !== 'zset')
      throw new Error(`the index of live Sessions is a ${type}, not a sorted set`);
    // the members are not printed: a member that is not an id could carry a word of a Segment
    const strangers = members.filter((member) => !UUID.test(member) || !created.has(member));
    if (strangers.length > 0 || members.length !== count) {
      throw new Error(
        `the index lists ${members.length} member(s), ${strangers.length} of them not the id of a Session the client created`,
      );
    }
  },
);

Then(
  'the index of live Sessions expires in {int} seconds',
  async function (this: SessionWorld, seconds: number) {
    const ms = await withRedis(this, (client) => client.pttl(LIVE_INDEX));
    // the same slack as for the keys of a Session: integer seconds and the time the requests took
    if (!(ms <= seconds * 1000 && ms >= seconds * 1000 - 1500))
      throw new Error(`the index of live Sessions expires in ${ms} ms, not in ${seconds} s`);
  },
);
