// One model call, written once as a log line and once as a metric line on stdout, and added to its Session's counter
// (.claude/rules/platform.md, "Logging and health"; ticket #26). The log line and the metric carry the same tokens
// and cost that the counter adds; the counter is the running sum per Session. The quota per account (ADR 0005, #13)
// keeps its own counter in the account database and takes this record per call as its source. The record has a
// closed field list: a field outside it (a prompt, a model answer, a Claim, a name) or a missing field is refused
// with an Error naming the field, before anything is written or counted. There are no prices and no provider code
// here: the cost arrives in the record (T7).
import { formatLogLine, refuseField, writeStdout } from './logger.ts';

const TOKEN_FIELDS = [
  'inputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'outputTokens',
  'thinkingTokens',
] as const;
const CALL_FIELDS = ['modelRole', 'modelId', 'adapter', 'outcome'] as const;
const RECORD_FIELDS: ReadonlySet<string> = new Set([
  'sessionId',
  ...CALL_FIELDS,
  ...TOKEN_FIELDS,
  'durationMs',
  'costUsd',
]);

/** Event of the log line and name of the metric (owner decision Q1, gate 1 of #26). */
const LOG_EVENT = 'model.called';
const METRIC_EVENT = 'metric';
const METRIC_NAME = 'model.call';

type TokenField = (typeof TOKEN_FIELDS)[number];
type CallField = (typeof CALL_FIELDS)[number];

/** Everything recorded about one model call; every field is required. */
export type ModelCall = { readonly sessionId: string } & { readonly [F in CallField]: string } & {
  readonly [F in TokenField]: number;
} & { readonly durationMs: number; readonly costUsd: number };

/** What a Session has used so far: the summed token fields and cost of its model calls. */
export type SessionTotals = { readonly [F in TokenField]: number } & { readonly costUsd: number };

export interface ModelCallRecorder {
  /** Counts the call and writes the log line and the metric, or throws an Error naming the refused field. */
  record(call: ModelCall): void;
  /** The totals of one Session; zero for a Session without calls. */
  totals(sessionId: string): SessionTotals;
}

export interface ModelCallRecorderOptions {
  readonly service: string;
  /** Receives each finished line, newline included; stdout when not given. */
  readonly write?: ((line: string) => void) | undefined;
  /** Where the totals live; a counter in process memory when not given. */
  readonly counter?: SessionCounter | undefined;
}

/** Where the totals live: process memory for now, the Session state once a service runs in more than one replica. */
export interface SessionCounter {
  add(sessionId: string, used: SessionTotals): void;
  totals(sessionId: string): SessionTotals;
}

const ZERO: SessionTotals = Object.freeze({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  costUsd: 0,
});

function used(call: ModelCall): SessionTotals {
  return {
    inputTokens: call.inputTokens,
    cacheReadTokens: call.cacheReadTokens,
    cacheWriteTokens: call.cacheWriteTokens,
    outputTokens: call.outputTokens,
    thinkingTokens: call.thinkingTokens,
    costUsd: call.costUsd,
  };
}

function createMemoryCounter(): SessionCounter {
  const sessions = new Map<string, SessionTotals>();
  const totals = (sessionId: string): SessionTotals => sessions.get(sessionId) ?? ZERO;
  return {
    totals,
    add(sessionId, call) {
      const before = totals(sessionId);
      sessions.set(
        sessionId,
        Object.freeze({
          inputTokens: before.inputTokens + call.inputTokens,
          cacheReadTokens: before.cacheReadTokens + call.cacheReadTokens,
          cacheWriteTokens: before.cacheWriteTokens + call.cacheWriteTokens,
          outputTokens: before.outputTokens + call.outputTokens,
          thinkingTokens: before.thinkingTokens + call.thinkingTokens,
          costUsd: before.costUsd + call.costUsd,
        }),
      );
    },
  };
}

/**
 * The shape of a model call: only a plain object is taken, every own key counts (symbols and non-enumerable ones
 * included) and every field must be an own property, so nothing reaches the line, the metric or the counter that
 * the checks did not see.
 */
function checkShape(input: unknown): void {
  if (
    typeof input !== 'object' ||
    input === null ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error('a model call must be a plain object');
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !RECORD_FIELDS.has(key)) {
      refuseField(String(key), 'is not an allowed model call field');
    }
  }
  for (const field of RECORD_FIELDS) {
    if (!Object.hasOwn(input, field)) refuseField(field, 'is required');
  }
}

/**
 * Reads each field of a call of the right shape once into a flat copy (a getter runs once); the copy is what is
 * checked, written and counted. Its values are checked by formatLogLine before anything is written.
 */
function snapshot(input: ModelCall): ModelCall {
  const call: ModelCall = {
    sessionId: input.sessionId,
    modelRole: input.modelRole,
    modelId: input.modelId,
    adapter: input.adapter,
    inputTokens: input.inputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    outputTokens: input.outputTokens,
    thinkingTokens: input.thinkingTokens,
    durationMs: input.durationMs,
    costUsd: input.costUsd,
    outcome: input.outcome,
  };
  // An own field holding undefined would drop out of the log line instead of being refused.
  const values: Readonly<Record<string, unknown>> = call;
  for (const field of RECORD_FIELDS) {
    if (values[field] === undefined) refuseField(field, 'is required');
  }
  if (call.sessionId === '') refuseField('sessionId', 'must not be empty');
  return call;
}

export function createModelCallRecorder(options: ModelCallRecorderOptions): ModelCallRecorder {
  const write = options.write ?? writeStdout;
  const counter = options.counter ?? createMemoryCounter();
  return {
    totals: (sessionId) => counter.totals(sessionId),
    record(input) {
      checkShape(input);
      const call = snapshot(input);
      // Throws on a bad value before writing, so a refused call leaves no line, no metric and no count.
      const logLine = formatLogLine(options.service, { event: LOG_EVENT, ...call });
      const tokensAndCost = used(call);
      const labels = { service: options.service, modelRole: call.modelRole, modelId: call.modelId };
      const metricLine = `${JSON.stringify({
        time: new Date().toISOString(),
        service: options.service,
        event: METRIC_EVENT,
        name: METRIC_NAME,
        labels,
        values: tokensAndCost,
      })}\n`;
      // Counted before writing: a sink that throws may lose a line, never a count the quota needs.
      counter.add(call.sessionId, tokensAndCost);
      write(logLine);
      write(metricLine);
    },
  };
}
