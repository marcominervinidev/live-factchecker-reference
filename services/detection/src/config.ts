// Configuration of the detection service: the kit's settings plus its single dependency, Redis, and the Session
// lifetime. The password comes only from REDIS_PASSWORD_FILE (default user, ACL in compose.yml). REDIS_URL names
// the server only: no credentials, no query, no fragment, at most a database number, so nothing in it can
// override the connection options set in main.ts. SESSION_LIFETIME_SECONDS is how long every key of a Session
// lives after its last Segment (ADR 0009, docs/spec/datenschutz.md 2: 15 minutes); unset or empty means 900.
// SESSION_BYTE_BUDGET and MAX_SESSIONS bound what Sessions may hold in Redis (owner decision 2026-10-29): the
// defaults, 20 Sessions of at most 3 MiB of Segments each, fit the Redis cap of 96 MB in compose.yml.
// The Turn parameters are the start values of docs/spec/erkennung-modellrollen.md 8 (ticket #28), each a number of
// whole seconds from 1 under the spec's parameter name in upper case.
// The Claim Extractor (ticket #29) runs only with a model adapter: MODEL_ADAPTER unset or empty runs the service as
// before #29, `mock` needs the prompt file and the mock's expectations, read at startup (gate 1 of #29, question 3:
// „`MODEL_ADAPTER` leer: Dienst läuft ohne Claim Extractor; mit `mock` sind Anweisungsdatei und Erwartungen Pflicht“).
// The prompt is never compiled in (AC17); model id and thinking come from here (AC18); the parameters default to the
// start values of spec 8. An error names the variable, never its value or a path.
// The Topic Extractor (ticket #32) runs only with a model adapter and TOPIC_EXTRACTOR_PROMPT_FILE set; unset or empty
// runs the Session with the Claim Extractor alone (gate 1 of #32, O2). Its model, window and mock come from here too.
import { readFile } from 'node:fs/promises';

import {
  ConfigError,
  loadServiceConfig,
  readSecretFile,
  requireEnv,
  type Env,
  type ServiceConfig,
} from '@lfc/service-kit';

import type { TurnParameters } from './turns/types.ts';

export interface RedisTarget {
  readonly host: string;
  readonly port: number;
  readonly db: number;
  readonly tls: boolean;
}

export interface DetectionConfig extends ServiceConfig {
  /** `redis://host:port[/db]`, as given. */
  readonly redisUrl: string;
  /** The same server, parsed; main.ts connects with this, never with the URL string. */
  readonly redis: RedisTarget;
  readonly redisPassword: string;
  /** Whole seconds from 1; every key of a Session expires this long after its last Segment. */
  readonly sessionLifetimeSeconds: number;
  /** Whole bytes from 1: the Segments of one Session (as JSON) may add up to this much. */
  readonly sessionByteBudget: number;
  /** Whole number from 1: at most this many Sessions live at once. */
  readonly maxSessions: number;
  /** Whole seconds from 1, the start values of spec 8 by default (ticket #28). */
  readonly turnParameters: TurnParameters;
  /** Present only with a model adapter (MODEL_ADAPTER). */
  readonly claimExtractor?: ClaimExtractorConfig;
  /** Present only with a model adapter and TOPIC_EXTRACTOR_PROMPT_FILE (#32, O2). */
  readonly topicExtractor?: TopicExtractorConfig;
}

export interface TopicMockConfig {
  /** 0 to 1, the share of calls that open a sub-topic. */
  readonly newRate: number;
  readonly latencySeconds: number;
  /** 1-based numbers of the adapter's calls that answer no JSON. */
  readonly invalidCalls: readonly number[];
}

export interface TopicExtractorConfig {
  readonly instruction: string;
  readonly model: string;
  readonly thinking: 'off' | 'low';
  readonly maxTokens: number;
  readonly deadlineSeconds: number;
  /** topic_window_seconds of spec 8. */
  readonly windowSeconds: number;
  readonly schemaRetries: number;
  readonly mock?: TopicMockConfig;
}

export interface MockConfig {
  /** The text of a Golden Set labels.jsonl, parsed by the mock adapter at startup. */
  readonly expectations: string;
  readonly latencySeconds: number;
  /** 1-based numbers of the adapter's calls that answer no JSON. */
  readonly invalidCalls: readonly number[];
}

export interface ClaimExtractorConfig {
  readonly adapter: 'mock';
  readonly instruction: string;
  readonly model: string;
  readonly thinking: 'off' | 'low';
  readonly maxTokens: number;
  readonly deadlineSeconds: number;
  readonly tokensPerWord: number;
  readonly contextTurns: number;
  readonly contextTokenCap: number;
  readonly claimListCap: number;
  readonly schemaRetries: number;
  readonly cacheBlockBreakpoint: number;
  readonly mock?: MockConfig;
}

/** 15 minutes after the last Segment (ADR 0009). */
const DEFAULT_SESSION_LIFETIME_SECONDS = 900;
/**
 * The budget counts the JSON bytes of the Segments; in Redis a stream entry costs up to about 1.3 times that
 * (entry overhead, allocator rounding). 20 Sessions x 3 MiB x 1.3 is about 78 MB, below the cap of 96 MB.
 */
const DEFAULT_SESSION_BYTE_BUDGET = 3 * 1024 * 1024;
const DEFAULT_MAX_SESSIONS = 20;
/** docs/spec/erkennung-modellrollen.md section 8. */
const DEFAULT_TURN_PARAMETERS: TurnParameters = {
  tickSeconds: 5,
  turnPauseEndSeconds: 3,
  turnMaxSeconds: 180,
  interjectionMaxSeconds: 2,
};

const PROTOCOLS: Readonly<Record<string, boolean>> = { 'redis:': false, 'rediss:': true };

function invalid(problem: string): never {
  throw new ConfigError('REDIS_URL', problem);
}

function parseUrl(value: string): URL {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url === undefined || !Object.hasOwn(PROTOCOLS, url.protocol) || url.hostname === '') {
    invalid('must be a redis:// URL');
  }
  if (url.username !== '' || url.password !== '') {
    invalid('must not carry credentials; the password comes from REDIS_PASSWORD_FILE');
  }
  if (url.search !== '' || url.hash !== '') invalid('must not carry a query or a fragment');
  return url;
}

function redisTarget(value: string): RedisTarget {
  const url = parseUrl(value);
  const db = /^(?:\/(\d{1,2})?)?$/.exec(url.pathname);
  if (db === null) invalid('may carry only a database number as its path');
  const port = url.port === '' ? 6379 : Number(url.port);
  if (port < 1) invalid('must name a port from 1 to 65535');
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port,
    db: Number(db[1] ?? '0'),
    tls: PROTOCOLS[url.protocol] === true,
  };
}

/** A whole number from 1, no upper bound (gate 1 of #27); missing and empty mean the default. */
function wholeNumber(env: Env, name: string, unit: string, fallback: number): number {
  // Anchored /^\d+$/: one quantifier over one character class, matched in linear time, no ReDoS.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : 0;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ConfigError(name, `must be a whole number of ${unit} of at least 1`);
  }
  return value;
}

/** Whole seconds from 1, as spec 8 gives them: a fraction is refused, so a tiny tickSeconds cannot stall the Tick plan. */
function turnParameters(env: Env): TurnParameters {
  const d = DEFAULT_TURN_PARAMETERS;
  const seconds = (name: string, fallback: number) => wholeNumber(env, name, 'seconds', fallback);
  return {
    tickSeconds: seconds('TICK_SECONDS', d.tickSeconds),
    turnPauseEndSeconds: seconds('TURN_PAUSE_END_SECONDS', d.turnPauseEndSeconds),
    turnMaxSeconds: seconds('TURN_MAX_SECONDS', d.turnMaxSeconds),
    interjectionMaxSeconds: seconds('INTERJECTION_MAX_SECONDS', d.interjectionMaxSeconds),
  };
}

/** The text of the file the variable names; missing, unreadable or a directory names the variable only. */
async function readTextFile(env: Env, name: string): Promise<string> {
  try {
    return await readFile(requireEnv(env, name), 'utf8');
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(name, 'must name a readable file');
  }
}

/** A finite number above 0 (or from 0 with `zero`); missing and empty mean the default. */
function positive(env: Env, name: string, fallback: number, zero = false): number {
  // Anchored /^\d+(?:\.\d+)?$/: two quantifiers over one character class each, separated by a literal dot, no
  // nesting: matched in linear time, no ReDoS.
  // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
  const raw = optional(env, name);
  if (raw === undefined) return fallback;
  const value = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : -1;
  if (!Number.isFinite(value) || value < 0 || (value === 0 && !zero)) {
    throw new ConfigError(
      name,
      zero ? 'must be a number of at least 0' : 'must be a number above 0',
    );
  }
  return value;
}

/** A whole number from 0 (SCHEMA_RETRIES). */
function wholeFromZero(env: Env, name: string, fallback: number): number {
  if (env[name] === '0') return 0;
  return wholeNumber(env, name, 'repeats', fallback);
}

/** The value, or undefined when it is missing or empty. */
function optional(env: Env, name: string): string | undefined {
  const raw = env[name];
  return raw === '' ? undefined : raw;
}

function thinking(env: Env, name = 'CLAIM_EXTRACTOR_THINKING'): 'off' | 'low' {
  const raw = optional(env, name) ?? 'off';
  if (raw === 'off') return 'off';
  if (raw === 'low') return 'low';
  throw new ConfigError(name, 'must be off or low');
}

/** MOCK_INVALID_CALLS (or the Topic mock's): comma-separated call numbers from 1. */
function invalidCalls(env: Env, name = 'MOCK_INVALID_CALLS'): number[] {
  const raw = optional(env, name);
  if (raw === undefined) return [];
  return raw.split(',').map((part) => {
    const value = /^\d{1,9}$/.test(part.trim()) ? Number(part.trim()) : 0;
    if (value < 1) throw new ConfigError(name, 'must list call numbers from 1');
    return value;
  });
}

async function mockConfig(env: Env): Promise<MockConfig> {
  return {
    expectations: await readTextFile(env, 'MOCK_EXPECTATIONS_FILE'),
    latencySeconds: positive(env, 'MOCK_LATENCY_SECONDS', 0, true),
    invalidCalls: invalidCalls(env),
  };
}

/** Spec 8 start values; the model and its token estimate per word: ADR 0004 addendum 2026-10-25, pricing.json. */
async function claimExtractorConfig(env: Env): Promise<ClaimExtractorConfig | undefined> {
  const adapter = optional(env, 'MODEL_ADAPTER');
  if (adapter === undefined) return undefined;
  if (adapter !== 'mock') throw new ConfigError('MODEL_ADAPTER', 'must be empty or mock');
  const whole = (name: string, fallback: number) => wholeNumber(env, name, 'units', fallback);
  return {
    adapter,
    instruction: await readTextFile(env, 'CLAIM_EXTRACTOR_PROMPT_FILE'),
    model: optional(env, 'CLAIM_EXTRACTOR_MODEL') ?? 'claude-haiku-5-5',
    thinking: thinking(env),
    maxTokens: whole('CLAIM_EXTRACTOR_MAX_TOKENS', 2048),
    deadlineSeconds: positive(env, 'CLAIM_EXTRACTOR_DEADLINE_SECONDS', 15),
    tokensPerWord: positive(env, 'CLAIM_EXTRACTOR_TOKENS_PER_WORD', 2.1),
    contextTurns: whole('CONTEXT_TURNS', 2),
    contextTokenCap: whole('CONTEXT_TOKEN_CAP', 600),
    claimListCap: whole('CLAIM_LIST_CAP', 100),
    schemaRetries: wholeFromZero(env, 'SCHEMA_RETRIES', 1),
    cacheBlockBreakpoint: whole('CACHE_BLOCK_BREAKPOINT', 20),
    mock: await mockConfig(env),
  };
}

/** A number from 0 to 1 (MOCK_TOPIC_NEW_RATE); missing and empty mean the default. */
function rate(env: Env, name: string, fallback: number): number {
  const value = positive(env, name, fallback, true);
  if (value > 1) throw new ConfigError(name, 'must be a number from 0 to 1');
  return value;
}

/** Spec 8 start values (topic_window_seconds 60); model Haiku 5.5 thinking off (ADR 0004, addendum 2026-10-25). */
async function topicExtractorConfig(env: Env): Promise<TopicExtractorConfig | undefined> {
  if (optional(env, 'MODEL_ADAPTER') === undefined) return undefined;
  if (optional(env, 'TOPIC_EXTRACTOR_PROMPT_FILE') === undefined) return undefined;
  return {
    instruction: await readTextFile(env, 'TOPIC_EXTRACTOR_PROMPT_FILE'),
    model: optional(env, 'TOPIC_EXTRACTOR_MODEL') ?? 'claude-haiku-5-5',
    thinking: thinking(env, 'TOPIC_EXTRACTOR_THINKING'),
    maxTokens: wholeNumber(env, 'TOPIC_EXTRACTOR_MAX_TOKENS', 'tokens', 1024),
    deadlineSeconds: positive(env, 'TOPIC_EXTRACTOR_DEADLINE_SECONDS', 15),
    windowSeconds: wholeNumber(env, 'TOPIC_WINDOW_SECONDS', 'seconds', 60),
    schemaRetries: wholeFromZero(env, 'SCHEMA_RETRIES', 1),
    mock: {
      newRate: rate(env, 'MOCK_TOPIC_NEW_RATE', 0.05),
      latencySeconds: positive(env, 'MOCK_TOPIC_LATENCY_SECONDS', 0, true),
      invalidCalls: invalidCalls(env, 'MOCK_TOPIC_INVALID_CALLS'),
    },
  };
}

export async function loadConfig(env: Env): Promise<DetectionConfig> {
  const service = loadServiceConfig(env);
  const redisUrl = requireEnv(env, 'REDIS_URL');
  const claimExtractor = await claimExtractorConfig(env);
  const topicExtractor = await topicExtractorConfig(env);
  return {
    ...service,
    redisUrl,
    redis: redisTarget(redisUrl),
    redisPassword: await readSecretFile(env, 'REDIS_PASSWORD'),
    sessionLifetimeSeconds: wholeNumber(
      env,
      'SESSION_LIFETIME_SECONDS',
      'seconds',
      DEFAULT_SESSION_LIFETIME_SECONDS,
    ),
    sessionByteBudget: wholeNumber(
      env,
      'SESSION_BYTE_BUDGET',
      'bytes',
      DEFAULT_SESSION_BYTE_BUDGET,
    ),
    maxSessions: wholeNumber(env, 'MAX_SESSIONS', 'Sessions', DEFAULT_MAX_SESSIONS),
    turnParameters: turnParameters(env),
    ...(claimExtractor === undefined ? {} : { claimExtractor }),
    ...(topicExtractor === undefined ? {} : { topicExtractor }),
  };
}
