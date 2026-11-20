// Stage 1, issue #26 (T1b), Task 1, AC1 to AC4: the model call record of the service kit and the Session counter
// (`.claude/rules/platform.md`, "Logging and health": every model call emits one log event and one metric with tokens
// and cost, counted per Session; `docs/spec/erkennung-modellrollen.md` section 9: fields per call).
//
// Public interface these tests define (built in Task 1, `packages/service-kit/src/model-call.ts`):
//   createModelCallRecorder({ service, write? }) -> { record(call), totals(sessionId) }
//   call: { sessionId, modelRole, modelId, adapter, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
//           thinkingTokens, durationMs, costUsd, outcome }
//   `write` receives each finished line (newline included) and defaults to stdout, as in createLogger.
//   record() writes one log line (through the logger, closed field set) and one metric line (an object `labels`)
//   and adds to the Session counter; a refused call throws an Error naming the field, writes nothing and leaves the
//   counter unchanged. totals() returns the summed token fields and costUsd of one Session; zero for an unknown one.
// The values of modelRole, modelId, adapter and outcome below are examples (their lists are T7's); the tests depend
// on none of their spellings. Owner decisions at gate 1 of #26 (2026-10-29): the log line is event `model.called` and
// carries the call fields (Q1, Q4), the metric line is event `metric` with name `model.call` (Q1), a missing token
// field is refused (Q5).
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createModelCallRecorder } from './model-call.ts';

type Recorder = ReturnType<typeof createModelCallRecorder>;
type ModelCall = Parameters<Recorder['record']>[0];

const NOW = new Date('2026-10-28T09:00:00.000Z');
const SERVICE = 'detection';
// Source: ticket #26 AC1 (token fields of a model call) and .claude/rules/platform.md (platform fields).
const TOKEN_FIELDS = [
  'inputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'outputTokens',
  'thinkingTokens',
] as const;
const PLATFORM_FIELDS = ['time', 'service', 'sessionId', 'event', 'durationMs', 'costUsd'] as const;
const CALL_FIELDS = ['modelRole', 'modelId', 'adapter', 'outcome'] as const;
const LOG_LINE_FIELDS: readonly string[] = [...PLATFORM_FIELDS, ...TOKEN_FIELDS, ...CALL_FIELDS];
const RECORD_FIELDS: readonly string[] = [
  'sessionId',
  'durationMs',
  'costUsd',
  ...TOKEN_FIELDS,
  ...CALL_FIELDS,
];
const SUMMED = [...TOKEN_FIELDS, 'costUsd'] as const;

let sessionCount = 0;
/** Own Session id per test: the counter may live in module state. */
function newSessionId(): string {
  sessionCount += 1;
  return `s-26-${String(sessionCount)}-${String(Math.floor(Math.random() * 1e9))}`;
}

// Through `untyped`: the overrides are plain values, whatever the record type of Task 1 narrows.
function call(sessionId: string, overrides: Readonly<Record<string, unknown>> = {}): ModelCall {
  return untyped({
    sessionId,
    modelRole: 'claim_extractor',
    modelId: 'claude-haiku-5-5',
    adapter: 'anthropic',
    inputTokens: 1840,
    cacheReadTokens: 1536,
    cacheWriteTokens: 0,
    outputTokens: 212,
    thinkingTokens: 0,
    durationMs: 1730,
    costUsd: 0.00214,
    outcome: 'ok',
    ...overrides,
  });
}

// The runtime check exists for callers the type system cannot see (spread objects, parsed provider answers).
function untyped(fields: Record<string, unknown>): ModelCall {
  return fields as unknown as ModelCall;
}

function capture(): { lines: string[]; recorder: Recorder } {
  const lines: string[] = [];
  const recorder = createModelCallRecorder({
    service: SERVICE,
    write: (line: string) => {
      lines.push(line);
    },
  });
  return { lines, recorder };
}

type Entry = Record<string, unknown>;

function parse(lines: readonly string[]): Entry[] {
  return lines.map((line) => {
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    const value: unknown = JSON.parse(line);
    expect(typeof value === 'object' && value !== null && !Array.isArray(value)).toBe(true);
    return value as Entry;
  });
}

function isMetric(entry: Entry): boolean {
  const labels = entry['labels'];
  return typeof labels === 'object' && labels !== null && !Array.isArray(labels);
}

/** The one log line and the one metric line a recorded call wrote. */
function split(lines: readonly string[]): { logLine: Entry; metric: Entry } {
  const entries = parse(lines);
  expect(entries).toHaveLength(2);
  const metrics = entries.filter(isMetric);
  const logs = entries.filter((entry) => !isMetric(entry));
  expect(metrics).toHaveLength(1);
  expect(logs).toHaveLength(1);
  return { logLine: logs[0] as Entry, metric: metrics[0] as Entry };
}

/** Every numeric value outside `labels`, by key, wherever it is nested in the metric line. */
function metricNumbers(metric: Entry): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === 'labels') continue;
      if (typeof inner === 'number') (found[key] ??= []).push(inner);
      else walk(inner);
    }
  };
  walk(metric);
  return found;
}

function totalsOf(recorder: Recorder, sessionId: string): Record<string, number> {
  const totals = recorder.totals(sessionId) as unknown as Record<string, number>;
  const picked: Record<string, number> = {};
  for (const key of SUMMED) picked[key] = totals[key] ?? Number.NaN;
  return picked;
}

const ZERO = Object.fromEntries(SUMMED.map((key) => [key, 0]));

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('record: one log line and one metric per model call (AC1)', () => {
  // Owner decision Q4 of the #26 test design (gate 1): the log line also carries the call fields.
  it('writes exactly one log line carrying the platform fields, the token fields and the call fields', () => {
    const { lines, recorder } = capture();
    const sessionId = newSessionId();
    recorder.record(call(sessionId));
    const { logLine } = split(lines);
    expect(logLine).toMatchObject({
      service: SERVICE,
      sessionId,
      durationMs: 1730,
      costUsd: 0.00214,
      inputTokens: 1840,
      cacheReadTokens: 1536,
      cacheWriteTokens: 0,
      outputTokens: 212,
      thinkingTokens: 0,
      modelRole: 'claim_extractor',
      modelId: 'claude-haiku-5-5',
      adapter: 'anthropic',
      outcome: 'ok',
    });
    expect(Date.parse(String(logLine['time']))).toBe(NOW.getTime());
    expect(typeof logLine['event']).toBe('string');
    expect(logLine['event']).not.toBe('');
  });

  it('writes no field into the log line outside the platform, token and call fields', () => {
    const { lines, recorder } = capture();
    recorder.record(call(newSessionId()));
    for (const key of Object.keys(split(lines).logLine)) expect(LOG_LINE_FIELDS).toContain(key);
  });

  it('emits exactly one metric with the same tokens and cost as the call', () => {
    const { lines, recorder } = capture();
    const recorded = call(newSessionId(), {
      inputTokens: 905,
      outputTokens: 77,
      thinkingTokens: 31,
      costUsd: 0.0009,
    });
    recorder.record(recorded);
    const numbers = metricNumbers(split(lines).metric);
    const expected = recorded as unknown as Record<string, number>;
    for (const key of SUMMED) expect(numbers[key], key).toEqual([expected[key]]);
  });

  it('labels the metric with the service, the model role and the model id of the call', () => {
    const { lines, recorder } = capture();
    recorder.record(call(newSessionId(), { modelRole: 'resolver', modelId: 'claude-sonnet-5-5' }));
    expect(split(lines).metric['labels']).toMatchObject({
      service: SERVICE,
      modelRole: 'resolver',
      modelId: 'claude-sonnet-5-5',
    });
  });

  it('uses one fixed event name for the log line and another for the metric, whatever the call holds', () => {
    const first = capture();
    first.recorder.record(call(newSessionId()));
    const second = capture();
    second.recorder.record(
      call(newSessionId(), {
        modelRole: 'verifier',
        modelId: 'claude-sonnet-5-5',
        adapter: 'bedrock',
        outcome: 'timeout',
      }),
    );
    const a = split(first.lines);
    const b = split(second.lines);
    expect(b.logLine['event']).toBe(a.logLine['event']);
    expect(b.metric['event']).toBe(a.metric['event']);
    expect(a.metric['event']).not.toBe(a.logLine['event']);
  });

  // Owner decision Q1 of the #26 test design (gate 1): the event names, pattern <subject>.<past participle> as
  // service.started; one event value for every metric line, the metric's own name beside it.
  it('names the log line model.called and the metric line metric with the name model.call', () => {
    const { lines, recorder } = capture();
    recorder.record(call(newSessionId()));
    const { logLine, metric } = split(lines);
    expect(logLine['event']).toBe('model.called');
    expect(metric).toMatchObject({ event: 'metric', name: 'model.call' });
  });

  it('accepts zero for every token count and for the cost, as for a call answered from the cache', () => {
    const { lines, recorder } = capture();
    const zeros = Object.fromEntries([...SUMMED, 'durationMs'].map((key) => [key, 0]));
    recorder.record(call(newSessionId(), zeros));
    expect(split(lines).logLine).toMatchObject(zeros);
  });

  it('writes stdout when no sink is given', () => {
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });
    createModelCallRecorder({ service: SERVICE }).record(call(newSessionId()));
    const lines = written.join('').split(/(?<=\n)/);
    split(lines);
  });

  it('writes one log line and one metric for every valid call, with no foreign field (property)', () => {
    const validCall = fc.record({
      inputTokens: fc.nat({ max: 1_000_000 }),
      cacheReadTokens: fc.nat({ max: 1_000_000 }),
      cacheWriteTokens: fc.nat({ max: 1_000_000 }),
      outputTokens: fc.nat({ max: 100_000 }),
      thinkingTokens: fc.nat({ max: 100_000 }),
      durationMs: fc.nat({ max: 600_000 }),
      costUsd: fc.double({ min: 0, max: 10, noNaN: true, noDefaultInfinity: true }),
    });
    fc.assert(
      fc.property(validCall, (values) => {
        const { lines, recorder } = capture();
        recorder.record(call(newSessionId(), values));
        const { logLine, metric } = split(lines);
        for (const key of Object.keys(logLine)) expect(LOG_LINE_FIELDS).toContain(key);
        const numbers = metricNumbers(metric);
        for (const key of SUMMED) {
          expect(logLine[key]).toBe(values[key]);
          expect(numbers[key]).toEqual([values[key]]);
        }
      }),
    );
  });
});

describe('totals: the Session counter (AC2)', () => {
  it('returns zero tokens and zero cost for a Session without calls', () => {
    const { recorder } = capture();
    expect(totalsOf(recorder, newSessionId())).toEqual(ZERO);
  });

  it('returns the tokens and cost of a single call', () => {
    const { recorder } = capture();
    const sessionId = newSessionId();
    recorder.record(call(sessionId));
    expect(totalsOf(recorder, sessionId)).toEqual({
      inputTokens: 1840,
      cacheReadTokens: 1536,
      cacheWriteTokens: 0,
      outputTokens: 212,
      thinkingTokens: 0,
      costUsd: 0.00214,
    });
  });

  it('returns the sum of several calls of the same Session across model roles', () => {
    const { recorder } = capture();
    const sessionId = newSessionId();
    recorder.record(
      call(sessionId, {
        modelRole: 'claim_extractor',
        inputTokens: 1000,
        outputTokens: 100,
        costUsd: 0.25,
      }),
    );
    recorder.record(
      call(sessionId, {
        modelRole: 'resolver',
        inputTokens: 3000,
        outputTokens: 300,
        thinkingTokens: 40,
        costUsd: 0.5,
      }),
    );
    recorder.record(
      call(sessionId, {
        modelRole: 'verifier',
        inputTokens: 500,
        outputTokens: 20,
        costUsd: 0.125,
      }),
    );
    expect(totalsOf(recorder, sessionId)).toMatchObject({
      inputTokens: 4500,
      outputTokens: 420,
      thinkingTokens: 40,
      cacheReadTokens: 3 * 1536,
      costUsd: 0.875,
    });
  });

  it('keeps the counters of two Sessions apart', () => {
    const { recorder } = capture();
    const [a, b] = [newSessionId(), newSessionId()];
    recorder.record(call(a, { inputTokens: 10, costUsd: 0.5 }));
    recorder.record(call(b, { inputTokens: 7, costUsd: 0.25 }));
    recorder.record(call(a, { inputTokens: 5, costUsd: 0.125 }));
    expect(totalsOf(recorder, a)).toMatchObject({ inputTokens: 15, costUsd: 0.625 });
    expect(totalsOf(recorder, b)).toMatchObject({ inputTokens: 7, costUsd: 0.25 });
  });

  it('sums every token field exactly and the cost to the micro-dollar, per Session, in any order (property)', () => {
    const recorded = fc.record({
      session: fc.constantFrom(0, 1),
      inputTokens: fc.nat({ max: 200_000 }),
      cacheReadTokens: fc.nat({ max: 200_000 }),
      cacheWriteTokens: fc.nat({ max: 200_000 }),
      outputTokens: fc.nat({ max: 20_000 }),
      thinkingTokens: fc.nat({ max: 20_000 }),
      costUsd: fc.double({ min: 0, max: 5, noNaN: true, noDefaultInfinity: true }),
    });
    fc.assert(
      fc.property(fc.array(recorded, { maxLength: 30 }), (calls) => {
        const { recorder } = capture();
        const ids = [newSessionId(), newSessionId()];
        const expected = ids.map((): Record<string, number> => ({ ...ZERO }));
        for (const { session, ...values } of calls) {
          recorder.record(call(ids[session] ?? '', values));
          const sum = expected[session] as Record<string, number>;
          for (const key of SUMMED) sum[key] = (sum[key] ?? 0) + values[key];
        }
        ids.forEach((id, index) => {
          const actual = totalsOf(recorder, id);
          const sum = expected[index] as Record<string, number>;
          for (const key of TOKEN_FIELDS) expect(actual[key]).toBe(sum[key]);
          expect(actual['costUsd']).toBeCloseTo(sum['costUsd'] ?? 0, 6);
        });
      }),
    );
  });
});

/** Records one valid call, then the refused one; returns what the refusal changed. */
function refuse(
  fields: Record<string, unknown>,
  sessionId: string,
): { error: unknown; lines: string[]; before: unknown; after: unknown } {
  const { lines, recorder } = capture();
  recorder.record(call(sessionId));
  const before = totalsOf(recorder, sessionId);
  lines.length = 0;
  let error: unknown;
  try {
    recorder.record(untyped(fields));
  } catch (caught) {
    error = caught;
  }
  return { error, lines, before, after: totalsOf(recorder, sessionId) };
}

function expectRefused(result: ReturnType<typeof refuse>, field: string): void {
  expect(result.error).toBeInstanceOf(Error);
  expect((result.error as Error).message).toContain(field);
  expect(result.lines).toEqual([]);
  expect(result.after).toEqual(result.before);
}

describe('record: a field outside the fixed list is refused (AC3)', () => {
  it.each([
    {
      what: 'prompt text',
      field: 'prompt',
      value: 'Extrahiere alle prüfbaren Behauptungen aus dem folgenden Turn.',
    },
    {
      what: 'model output',
      field: 'output',
      value: '{"claims":[{"sentence":"Die Inflation lag 2023 bei sechs Prozent."}]}',
    },
    {
      what: 'a Claim sentence',
      field: 'claim',
      value: 'Die Inflation lag 2023 bei sechs Prozent.',
    },
    { what: 'a Speaker name', field: 'speaker', value: 'Friedrich Ruvw' },
    // The event name, the time and the service are the recorder's, not the caller's (AC1; critic W4 of the #26
    // test design).
    { what: 'its own event name', field: 'event', value: 'service.started' },
    { what: 'its own time', field: 'time', value: '1999-01-01T00:00:00.000Z' },
    { what: 'its own service', field: 'service', value: 'someone-else' },
  ])(
    'refuses a call carrying $what, names "$field", writes nothing and leaves the counter unchanged',
    ({ field, value }) => {
      const sessionId = newSessionId();
      const result = refuse(
        { ...(call(sessionId) as unknown as Record<string, unknown>), [field]: value },
        sessionId,
      );
      expectRefused(result, field);
    },
  );

  it('never repeats the refused value in the error', () => {
    const sessionId = newSessionId();
    const sentence = 'Die Inflation lag 2023 bei sechs Prozent.';
    const result = refuse(
      { ...(call(sessionId) as unknown as Record<string, unknown>), claim: sentence },
      sessionId,
    );
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).not.toContain(sentence);
  });

  it('refuses any field outside the fixed list, names it and changes nothing (property)', () => {
    const foreignKey = fc
      .stringMatching(/^[a-z][A-Za-z0-9_]{0,24}$/)
      .filter((key) => !RECORD_FIELDS.includes(key) && !['__proto__', 'constructor'].includes(key));
    fc.assert(
      fc.property(foreignKey, fc.oneof(fc.string({ maxLength: 40 }), fc.nat()), (key, value) => {
        const sessionId = newSessionId();
        const result = refuse(
          { ...(call(sessionId) as unknown as Record<string, unknown>), [key]: value },
          sessionId,
        );
        expectRefused(result, key);
      }),
    );
  });
});

describe('record: a missing Session id, a bad token count or a bad cost is refused (AC4)', () => {
  const tokenRows = TOKEN_FIELDS.flatMap((field) => [
    { invalidClass: `negative ${field}`, field, value: -1 },
    { invalidClass: `non-integer ${field}`, field, value: 0.5 },
  ]);

  it.each([
    { invalidClass: 'empty sessionId', field: 'sessionId', value: '' },
    ...tokenRows,
    { invalidClass: 'NaN inputTokens', field: 'inputTokens', value: Number.NaN },
    {
      invalidClass: 'infinite outputTokens',
      field: 'outputTokens',
      value: Number.POSITIVE_INFINITY,
    },
    { invalidClass: 'inputTokens as a string', field: 'inputTokens', value: '12' },
    { invalidClass: 'negative costUsd', field: 'costUsd', value: -0.000001 },
    { invalidClass: 'NaN costUsd', field: 'costUsd', value: Number.NaN },
    { invalidClass: 'infinite costUsd', field: 'costUsd', value: Number.POSITIVE_INFINITY },
    {
      invalidClass: 'negative infinite costUsd',
      field: 'costUsd',
      value: Number.NEGATIVE_INFINITY,
    },
    { invalidClass: 'costUsd as a string', field: 'costUsd', value: '0.01' },
    // Gate 1 of #25, decision 4: durationMs is an integer.
    { invalidClass: 'non-integer durationMs', field: 'durationMs', value: 0.5 },
  ])(
    'refuses a call with $invalidClass, names "$field", writes nothing and leaves the counter unchanged',
    ({ field, value }) => {
      const sessionId = newSessionId();
      const fields = { ...(call(sessionId) as unknown as Record<string, unknown>), [field]: value };
      // The empty-id row checks the counter of the Session the valid call went to.
      expectRefused(refuse(fields, sessionId), field);
    },
  );

  // A missing token field is refused, not read as zero: owner decision Q5 of the #26 test design (gate 1).
  it.each(['sessionId', ...TOKEN_FIELDS])(
    'refuses a call without %s, names it, writes nothing and counts nothing',
    (field) => {
      const sessionId = newSessionId();
      const fields = Object.fromEntries(
        Object.entries(call(sessionId) as unknown as Record<string, unknown>).filter(
          ([key]) => key !== field,
        ),
      );
      expectRefused(refuse(fields, sessionId), field);
    },
  );
});
