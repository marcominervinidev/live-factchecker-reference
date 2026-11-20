// Sessions in the no-disk Redis (ticket #27; ADR 0009, docs/spec/datenschutz.md 2). A Session is two keys, both
// named by its id only, never by a word or a Speaker label (sessionKeys): the state hash `session:<id>:state`, which
// holds only what does not follow from the stream (that the Session exists, when it was created, the bytes of its
// Segments so far), and the stream `session:<id>:segments`, one entry per accepted Segment with its id, its
// `finalizedAt` and the contract-valid Segment as JSON. Count and last Segment are read from the stream (XLEN,
// XREVRANGE COUNT 1). Creating a Session and accepting a Segment set the lifetime on every key of the Session in
// the same script, so they expire together; a rejected Segment touches nothing. The checks of an accepted Segment
// (Session known, id after the last one, room left in the byte budget) and its writes are one atomic step.
// The Claim Extractor (ticket #29) adds two keys of a Session: the detection stream `session:<id>:detection` (one entry
// per detection event, field `event`, the envelope as JSON) and the list `session:<id>:candidates` (one Candidate
// record as JSON per entry). A record is written only while the Session lives and takes the remaining lifetime of its
// state hash, so the keys expire together (AC16); a later Segment renews them all.
// One key belongs to no Session: the index LIVE_INDEX of the live Sessions (member: the id, score: when it expires,
// in ms), which bounds how many Sessions live at once (MAX_SESSIONS). It holds ids only, and it expires with the
// latest Session it lists, so it never outlives the Sessions either.
import { randomUUID } from 'node:crypto';

import type { DetectionEvent, Segment } from '@lfc/contracts';
import type { Redis } from 'ioredis';

import type { CandidateRecord } from '../claim-extractor/claims.ts';

export interface SessionState {
  readonly id: string;
  readonly segments: number;
  readonly lastSegmentId: string | null;
  readonly lastFinalizedAt: number | null;
  readonly remainingSeconds: number;
}

/**
 * `unknown`: no such Session (never created or expired); `not-after`: the id is not after the last one; `full`:
 * the Segment would take the Session's Segments past the byte budget.
 */
export type AppendOutcome = 'accepted' | 'unknown' | 'not-after' | 'full';

export interface SessionStore {
  /** `full` when MAX_SESSIONS Sessions already live. */
  create(): Promise<SessionState | 'full'>;
  append(sessionId: string, segment: Segment): Promise<AppendOutcome>;
  /** `undefined` when the Session is unknown. */
  state(sessionId: string): Promise<SessionState | undefined>;
}

export interface SessionStoreOptions {
  /** Whole seconds; every key of a Session expires this long after its creation or its last Segment. */
  readonly lifetimeSeconds: number;
  /** Whole bytes; the Segments of one Session, as JSON, add up to at most this much (SESSION_BYTE_BUDGET). */
  readonly byteBudget: number;
  /** At most this many Sessions live at once (MAX_SESSIONS). */
  readonly maxSessions: number;
}

/** The index of the live Sessions; the one key outside sessionKeys. */
const LIVE_INDEX = 'sessions:live';

// Lua: register the Session ARGV[idArg] in the index (last key) until now + lifetime, and let the index expire with
// its latest Session. Needs the locals `index` and `nowMs`.
function registerLive(lifetimeArg: number, idArg: number): string {
  return `
redis.call('ZADD', index, nowMs + tonumber(ARGV[${lifetimeArg}]) * 1000, ARGV[${idArg}])
redis.call('PEXPIREAT', index, redis.call('ZRANGE', index, -1, -1, 'WITHSCORES')[2])`;
}

const NOW = `
local index = KEYS[#KEYS]
local now = redis.call('TIME')
local nowMs = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)`;

// The writing scripts start with `#!lua`: Redis then treats them as writes and refuses them whole at maxmemory
// (noeviction), instead of letting a script run on once its first write (ZREMRANGEBYSCORE) went through.

// KEYS: sessionKeys, then LIVE_INDEX; ARGV: lifetime in seconds, MAX_SESSIONS, the Session id. 0 when full.
const CREATE = `#!lua${NOW}
redis.call('ZREMRANGEBYSCORE', index, '-inf', nowMs)
if redis.call('ZCARD', index) >= tonumber(ARGV[2]) then return 0 end
redis.call('HSET', KEYS[1], 'created', now[1], 'bytes', 0)
for i = 1, #KEYS - 1 do redis.call('EXPIRE', KEYS[i], ARGV[1]) end
${registerLive(1, 3)}
return 1`;

// KEYS: sessionKeys, then LIVE_INDEX; ARGV: number of the id, the id, finalizedAt, Segment JSON, lifetime, byte
// budget, the Session id.
// The ids compare as numbers (s-0412 equals s-412; s-10000 is after s-9999); 15 digits fit a Lua double exactly.
// An entry's fields are written in the order id, finalizedAt, segment, so entry[2][2] is the id, entry[2][4] the
// finalizedAt (as written, a string: no rounding on the way back).
const APPEND = `#!lua${NOW}
if redis.call('EXISTS', KEYS[1]) == 0 then return 'unknown' end
local last = redis.call('XREVRANGE', KEYS[2], '+', '-', 'COUNT', 1)[1]
if last and tonumber(ARGV[1]) <= tonumber(string.sub(last[2][2], 3)) then return 'not-after' end
if tonumber(redis.call('HGET', KEYS[1], 'bytes')) + #ARGV[4] > tonumber(ARGV[6]) then return 'full' end
redis.call('XADD', KEYS[2], '*', 'id', ARGV[2], 'finalizedAt', ARGV[3], 'segment', ARGV[4])
redis.call('HINCRBY', KEYS[1], 'bytes', #ARGV[4])
for i = 1, #KEYS - 1 do redis.call('EXPIRE', KEYS[i], ARGV[5]) end
${registerLive(5, 7)}
return 'accepted'`;

// KEYS: sessionKeys; nil when the Session is unknown.
const STATE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return nil end
local last = redis.call('XREVRANGE', KEYS[2], '+', '-', 'COUNT', 1)[1]
local id, finalizedAt = false, false
if last then id, finalizedAt = last[2][2], last[2][4] end
return {redis.call('XLEN', KEYS[2]), id, finalizedAt, redis.call('PTTL', KEYS[1])}`;

// KEYS: the state hash, the key written; ARGV: `stream` or `list`, the JSON. 0 when the Session is unknown.
const RECORD = `#!lua
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return 0 end
if ARGV[1] == 'stream' then redis.call('XADD', KEYS[2], '*', 'event', ARGV[2])
else redis.call('RPUSH', KEYS[2], ARGV[2]) end
redis.call('PEXPIRE', KEYS[2], ttl)
return 1`;

const OUTCOMES: readonly AppendOutcome[] = ['accepted', 'unknown', 'not-after', 'full'];

/**
 * Every key of a Session, in the order the scripts read them as KEYS: KEYS[1] the state hash, KEYS[2] the stream.
 * A new key of a Session is registered here and nowhere else, so every script sets its lifetime (it loops over
 * KEYS) and no key outlives the Session.
 */
const SESSION_KEYS = ['state', 'segments', 'detection', 'candidates'] as const;

function keyOf(sessionId: string, name: (typeof SESSION_KEYS)[number]): string {
  return `session:${sessionId}:${name}`;
}

function sessionKeys(sessionId: string): string[] {
  return SESSION_KEYS.map((name) => keyOf(sessionId, name));
}

/** What the Claim Extractor of a Session writes; rejects when the Session is unknown (expired). */
export interface SessionRecords {
  detection(sessionId: string, event: DetectionEvent): Promise<void>;
  candidate(sessionId: string, record: CandidateRecord): Promise<void>;
}

export function createSessionRecords(redis: Redis): SessionRecords {
  const write = async (sessionId: string, kind: 'stream' | 'list', json: string) => {
    const target = keyOf(sessionId, kind === 'stream' ? 'detection' : 'candidates');
    const written = await redis.eval(RECORD, 2, keyOf(sessionId, 'state'), target, kind, json);
    if (written !== 1) throw new Error('Session unknown');
  };
  return {
    detection: (sessionId, event) => write(sessionId, 'stream', JSON.stringify(event)),
    candidate: (sessionId, record) => write(sessionId, 'list', JSON.stringify(record)),
  };
}

function isOutcome(value: unknown): value is AppendOutcome {
  return OUTCOMES.some((outcome) => outcome === value);
}

function toState(sessionId: string, reply: unknown): SessionState | undefined {
  if (!Array.isArray(reply)) return undefined;
  const [segments, lastSegmentId, lastFinalizedAt, pttl] = reply as unknown[];
  return {
    id: sessionId,
    segments: Number(segments),
    lastSegmentId: typeof lastSegmentId === 'string' ? lastSegmentId : null,
    lastFinalizedAt: typeof lastFinalizedAt === 'string' ? Number(lastFinalizedAt) : null,
    remainingSeconds: Math.max(0, Math.ceil(Number(pttl) / 1000)),
  };
}

export function createSessionStore(redis: Redis, options: SessionStoreOptions): SessionStore {
  const lifetime = String(options.lifetimeSeconds);
  return {
    async create() {
      const id = randomUUID();
      const keys = [...sessionKeys(id), LIVE_INDEX];
      const created = await redis.eval(
        CREATE,
        keys.length,
        ...keys,
        lifetime,
        String(options.maxSessions),
        id,
      );
      if (created === 0) return 'full';
      return {
        id,
        segments: 0,
        lastSegmentId: null,
        lastFinalizedAt: null,
        remainingSeconds: options.lifetimeSeconds,
      };
    },

    async append(sessionId, segment) {
      const keys = [...sessionKeys(sessionId), LIVE_INDEX];
      const reply = await redis.eval(
        APPEND,
        keys.length,
        ...keys,
        String(Number(segment.id.slice(2))),
        segment.id,
        String(segment.finalizedAt),
        JSON.stringify(segment),
        lifetime,
        String(options.byteBudget),
        sessionId,
      );
      if (!isOutcome(reply)) throw new Error('unexpected reply of the append script');
      return reply;
    },

    async state(sessionId) {
      const keys = sessionKeys(sessionId);
      return toState(sessionId, await redis.eval(STATE, keys.length, ...keys));
    },
  };
}
