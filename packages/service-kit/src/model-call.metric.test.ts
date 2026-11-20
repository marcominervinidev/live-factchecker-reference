// Stage 1, issue #26 (T1b), Task 1, gate-1 addendum (owner, 2026-10-29): what model-call.test.ts leaves open and the
// reviewer (mutants M1, M4 to M7) and the security reviewer (S1 to S3, S5) showed with hand mutants: the metric of a
// call carries only that call's values and the metrics of a Session add up to its totals, the exact key sets of both
// lines, a missing mandatory field, empty and free-text labels, a record that is not a plain object or reads
// differently twice, a field name that is not an identifier, counting before writing, and the counter option.
// Sources: AC1 to AC4 of #26; `packages/service-kit/README.md`, "Contract" (the two lines, labels never hold the
// Session id, the counter adds exactly the metric's `values`); `.claude/rules/platform.md`, "Logging and health"
// (closed field set; the four labels match ^[a-z0-9][a-z0-9._:@/-]{0,63}$, no prose, no names); owner decisions of
// the gate-1 addendum (an empty label is refused like an empty sessionId; a refused field name that is not an
// identifier is not echoed). Black box: only createModelCallRecorder and the exported types of model-call.ts.
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createModelCallRecorder,
  type ModelCall,
  type ModelCallRecorder,
  type SessionCounter,
  type SessionTotals,
} from './model-call.ts';

const NOW = new Date('2026-10-29T09:00:00.000Z');
const SERVICE = 'detection';
// Source: ticket #26 AC1 and the README contract (the `values` of the metric line).
const TOKEN_FIELDS = [
  'inputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'outputTokens',
  'thinkingTokens',
] as const;
const VALUE_FIELDS = [...TOKEN_FIELDS, 'costUsd'] as const;
type ValueField = (typeof VALUE_FIELDS)[number];
type Values = Record<ValueField, number>;
const LABEL_FIELDS = ['modelRole', 'modelId', 'adapter', 'outcome'] as const;
// Source: .claude/rules/platform.md (closed field set of a model call's log line) and the README contract.
const LOG_LINE_KEYS = [
  'time',
  'service',
  'event',
  'sessionId',
  ...LABEL_FIELDS,
  ...TOKEN_FIELDS,
  'durationMs',
  'costUsd',
];
const METRIC_LINE_KEYS = ['time', 'service', 'event', 'name', 'labels', 'values'];
const METRIC_LABEL_KEYS = ['service', 'modelRole', 'modelId'];
// Owner decision of the gate-1 addendum: the label pattern of .claude/rules/platform.md.
const LABEL_PATTERN = /^[a-z0-9][a-z0-9._:@/-]{0,63}$/;
const CLAIM_SENTENCE = 'Die Inflation lag 2023 bei sechs Prozent.';
const SPEAKER_NAME = 'Friedrich Ruvw';
const PROMPT = 'Extrahiere alle prüfbaren Behauptungen aus dem folgenden Turn.';

let sessionCount = 0;
/** Own Session id per test: the default counter keeps a Session's totals for the recorder's lifetime. */
function newSessionId(): string {
  sessionCount += 1;
  return `s-26-metric-${String(sessionCount)}`;
}

function fieldsOf(
  sessionId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
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
  };
}

// The runtime checks exist for callers the type system cannot see (spread objects, parsed provider answers).
function asCall(value: unknown): ModelCall {
  return value as ModelCall;
}

function without(
  fields: Readonly<Record<string, unknown>>,
  field: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== field));
}

interface Harness {
  lines: string[];
  recorder: ModelCallRecorder;
}

function capture(counter?: SessionCounter): Harness {
  const lines: string[] = [];
  const write = (line: string): void => {
    lines.push(line);
  };
  const recorder =
    counter === undefined
      ? createModelCallRecorder({ service: SERVICE, write })
      : createModelCallRecorder({ service: SERVICE, write, counter });
  return { lines, recorder };
}

type Entry = Record<string, unknown>;

function isEntry(value: unknown): value is Entry {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLine(line: string): Entry {
  expect(line.endsWith('\n')).toBe(true);
  const value: unknown = JSON.parse(line);
  expect(isEntry(value)).toBe(true);
  return value as Entry;
}

interface Written {
  log: Entry;
  metric: Entry;
  metricLine: string;
}

/** The one log line and the one metric line (event `metric`, owner decision Q1) of one recorded call. */
function split(lines: readonly string[]): Written {
  expect(lines).toHaveLength(2);
  const metricLines = lines.filter((line) => parseLine(line)['event'] === 'metric');
  const logLines = lines.filter((line) => parseLine(line)['event'] !== 'metric');
  expect(metricLines).toHaveLength(1);
  expect(logLines).toHaveLength(1);
  const metricLine = metricLines[0] ?? '';
  return { log: parseLine(logLines[0] ?? ''), metric: parseLine(metricLine), metricLine };
}

function recordOne(harness: Harness, call: unknown): Written {
  const start = harness.lines.length;
  harness.recorder.record(asCall(call));
  return split(harness.lines.slice(start));
}

function objectAt(entry: Entry, key: string): Entry {
  const value = entry[key];
  expect(isEntry(value)).toBe(true);
  return value as Entry;
}

function totalsOf(recorder: ModelCallRecorder, sessionId: string): Values {
  const totals: SessionTotals = recorder.totals(sessionId);
  return Object.fromEntries(VALUE_FIELDS.map((key) => [key, totals[key]])) as Values;
}

function valuesFrom(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(VALUE_FIELDS.map((key) => [key, fields[key]]));
}

function zeroValues(): Values {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    costUsd: 0,
  };
}

/** Every key of a parsed line, nested ones included. */
function keysAtEveryDepth(value: unknown): string[] {
  if (!isEntry(value)) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysAtEveryDepth(inner)]);
}

function attempt(action: () => void): unknown {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
}

interface Refusal {
  error: unknown;
  written: string[];
  before: Values;
  after: Values;
}

/** Records one valid call of a Session, then the refused one; returns what the refusal changed. */
function refuse(build: (sessionId: string) => unknown): Refusal {
  const harness = capture();
  const sessionId = newSessionId();
  harness.recorder.record(asCall(fieldsOf(sessionId)));
  const before = totalsOf(harness.recorder, sessionId);
  const start = harness.lines.length;
  const error = attempt(() => {
    harness.recorder.record(asCall(build(sessionId)));
  });
  return {
    error,
    written: harness.lines.slice(start),
    before,
    after: totalsOf(harness.recorder, sessionId),
  };
}

/** The refusal threw an Error, wrote nothing and left the totals as they were; returns the message. */
function expectRefused(refusal: Refusal): string {
  expect(refusal.error).toBeInstanceOf(Error);
  expect(refusal.written).toEqual([]);
  expect(refusal.after).toEqual(refusal.before);
  return (refusal.error as Error).message;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('metric values: each call on its own, summing to the Session totals (AC1, AC2, README contract)', () => {
  it('gives the second call of a Session a metric with only its own tokens and cost, not the running sum', () => {
    const harness = capture();
    const sessionId = newSessionId();
    const first = {
      inputTokens: 1000,
      cacheReadTokens: 200,
      cacheWriteTokens: 30,
      outputTokens: 100,
      thinkingTokens: 4,
      costUsd: 0.25,
    };
    const second = {
      inputTokens: 3000,
      cacheReadTokens: 600,
      cacheWriteTokens: 90,
      outputTokens: 300,
      thinkingTokens: 12,
      costUsd: 0.5,
    };
    const firstMetric = recordOne(harness, fieldsOf(sessionId, first)).metric;
    const secondMetric = recordOne(harness, fieldsOf(sessionId, second)).metric;
    expect(objectAt(firstMetric, 'values')).toEqual(first);
    expect(objectAt(secondMetric, 'values')).toEqual(second);
    expect(totalsOf(harness.recorder, sessionId)).toEqual({
      inputTokens: 4000,
      cacheReadTokens: 800,
      cacheWriteTokens: 120,
      outputTokens: 400,
      thinkingTokens: 16,
      costUsd: 0.75,
    });
  });

  it('measures each of 1 to 10 calls on its own and sums the metrics of each of two Sessions to its totals (property)', () => {
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
      fc.property(fc.array(recorded, { minLength: 1, maxLength: 10 }), (calls) => {
        const harness = capture();
        const ids: readonly [string, string] = [newSessionId(), newSessionId()];
        const summed: [Values, Values] = [zeroValues(), zeroValues()];
        for (const { session, ...values } of calls) {
          const { metric } = recordOne(harness, fieldsOf(ids[session], values));
          const measured = objectAt(metric, 'values');
          expect(measured).toEqual(values);
          for (const key of VALUE_FIELDS) summed[session][key] += Number(measured[key]);
        }
        ids.forEach((sessionId, index) => {
          const totals = totalsOf(harness.recorder, sessionId);
          const sum = summed[index] ?? zeroValues();
          for (const key of TOKEN_FIELDS) expect(totals[key], key).toBe(sum[key]);
          expect(Math.abs(totals.costUsd - sum.costUsd)).toBeLessThanOrEqual(1e-6);
        });
      }),
    );
  });
});

describe('line shape: exact key sets (AC1, README contract)', () => {
  it('writes a log line with exactly the platform fields, the token fields and the call fields', () => {
    const { log } = recordOne(capture(), fieldsOf(newSessionId()));
    expect(Object.keys(log).sort()).toEqual([...LOG_LINE_KEYS].sort());
  });

  it('writes a metric line with exactly time, service, event, name, labels and values', () => {
    const { metric } = recordOne(capture(), fieldsOf(newSessionId()));
    expect(Object.keys(metric).sort()).toEqual([...METRIC_LINE_KEYS].sort());
    expect(metric['service']).toBe(SERVICE);
  });

  it('labels the metric with exactly service, modelRole and modelId', () => {
    const { metric } = recordOne(capture(), fieldsOf(newSessionId()));
    expect(Object.keys(objectAt(metric, 'labels')).sort()).toEqual([...METRIC_LABEL_KEYS].sort());
  });

  it('measures the metric with exactly the five token fields and costUsd', () => {
    const { metric } = recordOne(capture(), fieldsOf(newSessionId()));
    expect(Object.keys(objectAt(metric, 'values')).sort()).toEqual([...VALUE_FIELDS].sort());
  });

  it('keeps the Session id, the adapter and the outcome out of the metric line, as keys and as values', () => {
    const sessionId = newSessionId();
    const { metric, metricLine } = recordOne(
      capture(),
      fieldsOf(sessionId, { adapter: 'adapter-26-metric', outcome: 'outcome-26-metric' }),
    );
    const keys = keysAtEveryDepth(metric);
    for (const field of ['sessionId', 'adapter', 'outcome']) expect(keys).not.toContain(field);
    for (const value of [sessionId, 'adapter-26-metric', 'outcome-26-metric']) {
      expect(metricLine).not.toContain(value);
    }
  });
});

describe('record: a missing mandatory field is refused (AC4)', () => {
  const mandatory = ['costUsd', 'durationMs', 'modelRole', 'modelId', 'adapter', 'outcome'];

  it.each(mandatory)(
    'refuses a call without %s, names it, writes nothing and leaves the totals unchanged',
    (field) => {
      const message = expectRefused(refuse((sessionId) => without(fieldsOf(sessionId), field)));
      expect(message).toContain(field);
    },
  );

  it.each(mandatory)(
    'refuses a call whose %s is undefined, names it, writes nothing and leaves the totals unchanged',
    (field) => {
      const message = expectRefused(
        refuse((sessionId) => fieldsOf(sessionId, { [field]: undefined })),
      );
      expect(message).toContain(field);
    },
  );
});

describe('record: a label is an identifier (AC3, AC4, gate-1 addendum)', () => {
  // Owner decision of the gate-1 addendum: an empty label is refused like an empty sessionId.
  it.each(LABEL_FIELDS)(
    'refuses an empty %s like an empty Session id, names it, writes nothing and leaves the totals unchanged',
    (field) => {
      const message = expectRefused(refuse((sessionId) => fieldsOf(sessionId, { [field]: '' })));
      expect(message).toContain(field);
    },
  );

  const invalidClasses = [
    { invalidClass: 'a Claim sentence', value: CLAIM_SENTENCE },
    { invalidClass: 'a name with a space', value: 'friedrich merz' },
    { invalidClass: 'upper case', value: 'Claude-Haiku-5-5' },
    { invalidClass: '65 characters', value: `claude-${'x'.repeat(58)}` },
    { invalidClass: 'a leading punctuation mark', value: '_claim_extractor' },
  ];
  const invalidRows = LABEL_FIELDS.flatMap((field) =>
    invalidClasses.map((row) => ({ ...row, field })),
  );

  it.each(invalidRows)(
    'refuses $field as $invalidClass, names the field, never the value, and changes nothing',
    ({ field, value }) => {
      const message = expectRefused(refuse((sessionId) => fieldsOf(sessionId, { [field]: value })));
      expect(message).toContain(field);
      expect(message).not.toContain(value);
    },
  );

  it.each([
    { validClass: 'one letter', value: 'a' },
    { validClass: 'one digit', value: '0' },
    { validClass: '64 characters', value: `claude-${'x'.repeat(57)}` },
    { validClass: 'dots, dashes and a colon', value: 'us.anthropic.claude-haiku-5-5:0' },
    { validClass: 'a slash, an underscore and an at sign', value: 'models/gemini_2@001' },
  ])('accepts $validClass in all four labels', ({ value }) => {
    const { log, metric } = recordOne(
      capture(),
      fieldsOf(newSessionId(), {
        modelRole: value,
        modelId: value,
        adapter: value,
        outcome: value,
      }),
    );
    for (const field of LABEL_FIELDS) expect(log[field], field).toBe(value);
    expect(objectAt(metric, 'labels')).toMatchObject({ modelRole: value, modelId: value });
  });

  it('accepts every label inside the identifier pattern and refuses every one outside it (property)', () => {
    const label = fc.constantFrom(...LABEL_FIELDS);
    const inside = fc.stringMatching(LABEL_PATTERN);
    const outside = fc
      .oneof(
        fc.string({ maxLength: 80 }),
        fc.string({ unit: 'grapheme', maxLength: 20 }),
        fc.stringMatching(/^[a-z0-9][a-z0-9._:@/-]{64,70}$/),
      )
      .filter((value) => !LABEL_PATTERN.test(value));
    fc.assert(
      fc.property(label, inside, outside, (field, good, bad) => {
        const accepted = recordOne(capture(), fieldsOf(newSessionId(), { [field]: good }));
        expect(accepted.log[field]).toBe(good);
        const message = expectRefused(refuse((sessionId) => fieldsOf(sessionId, { [field]: bad })));
        expect(message).toContain(field);
      }),
    );
  });
});

/** A record as a class instance: the call fields are its own, a getter on its prototype holds a prompt. */
class CallWithPrompt {
  constructor(fields: Readonly<Record<string, unknown>>) {
    Object.assign(this, fields);
  }

  get prompt(): string {
    return PROMPT;
  }
}

describe('record: only a plain object is taken, and it is read once (AC3, security review)', () => {
  it.each([
    {
      shape: 'a class instance with a prompt getter',
      build: (sessionId: string): unknown => new CallWithPrompt(fieldsOf(sessionId)),
    },
    {
      shape: 'an object whose prototype carries a prompt',
      build: (sessionId: string): unknown =>
        Object.assign(Object.create({ prompt: PROMPT }) as object, fieldsOf(sessionId)),
    },
    {
      shape: 'a plain object with a non-enumerable prompt',
      build: (sessionId: string): unknown =>
        Object.defineProperty(fieldsOf(sessionId), 'prompt', { value: PROMPT, enumerable: false }),
    },
    {
      shape: 'a plain object with a symbol key',
      build: (sessionId: string): unknown => ({
        ...fieldsOf(sessionId),
        [Symbol('prompt')]: PROMPT,
      }),
    },
  ])('refuses $shape, writes nothing and counts nothing', ({ build }) => {
    const message = expectRefused(refuse(build));
    expect(message).not.toContain(PROMPT);
  });

  it('reads each getter once and logs, measures and counts its first value', () => {
    const harness = capture();
    const sessionId = newSessionId();
    let tokenReads = 0;
    let roleReads = 0;
    const call = {
      ...fieldsOf(sessionId),
      get inputTokens(): number {
        tokenReads += 1;
        return tokenReads === 1 ? 100 : 999_999;
      },
      get modelRole(): string {
        roleReads += 1;
        return roleReads === 1 ? 'claim_extractor' : CLAIM_SENTENCE;
      },
    };
    const { log, metric } = recordOne(harness, call);
    expect(tokenReads).toBe(1);
    expect(roleReads).toBe(1);
    expect(log['inputTokens']).toBe(100);
    expect(objectAt(metric, 'values')['inputTokens']).toBe(100);
    expect(totalsOf(harness.recorder, sessionId).inputTokens).toBe(100);
    expect(log['modelRole']).toBe('claim_extractor');
    expect(objectAt(metric, 'labels')['modelRole']).toBe('claim_extractor');
    expect(harness.lines.join('')).not.toContain(CLAIM_SENTENCE);
  });
});

describe('record: a field name that is not an identifier is not echoed (AC3, security review)', () => {
  it.each([
    { what: 'a Claim sentence', key: CLAIM_SENTENCE },
    { what: 'a Speaker name', key: SPEAKER_NAME },
  ])('refuses a field named with $what without repeating the name or its words', ({ key }) => {
    const message = expectRefused(refuse((sessionId) => ({ ...fieldsOf(sessionId), [key]: 1 })));
    expect(message).not.toContain(key);
    for (const word of key.split(' ')) {
      if (word.length > 3) expect(message).not.toContain(word);
    }
  });

  it('refuses a symbol field without repeating its description', () => {
    const message = expectRefused(
      refuse((sessionId) => ({ ...fieldsOf(sessionId), [Symbol(SPEAKER_NAME)]: 1 })),
    );
    expect(message).not.toContain('Friedrich');
    expect(message).not.toContain('Ruvw');
  });
});

describe('record: counted before written, fail-closed (AC2, security review)', () => {
  it.each([{ failingLine: 1 }, { failingLine: 2 }])(
    'keeps the call in the totals when the sink throws on line $failingLine',
    ({ failingLine }) => {
      let writes = 0;
      const recorder = createModelCallRecorder({
        service: SERVICE,
        write: () => {
          writes += 1;
          if (writes === failingLine) throw new Error('sink unavailable');
        },
      });
      const sessionId = newSessionId();
      const fields = fieldsOf(sessionId);
      attempt(() => {
        recorder.record(asCall(fields));
      });
      expect(writes).toBeGreaterThanOrEqual(failingLine);
      expect(totalsOf(recorder, sessionId)).toEqual(valuesFrom(fields));
    },
  );
});

/** A counter standing in for the Session state: it keeps what it receives and answers fixed totals. */
function keepingCounter(answer: SessionTotals): {
  counter: SessionCounter;
  added: { sessionId: string; used: Entry }[];
} {
  const added: { sessionId: string; used: Entry }[] = [];
  const counter: SessionCounter = {
    add(sessionId, used) {
      added.push({ sessionId, used: { ...used } });
    },
    totals: () => answer,
  };
  return { counter, added };
}

const ANSWER: SessionTotals = {
  inputTokens: 11,
  cacheReadTokens: 22,
  cacheWriteTokens: 33,
  outputTokens: 44,
  thinkingTokens: 55,
  costUsd: 0.66,
};

describe('counter option: where the totals live (AC2, README contract)', () => {
  it('hands an injected counter exactly the Session id and the metric values of each call', () => {
    const { counter, added } = keepingCounter(ANSWER);
    const harness = capture(counter);
    const [a, b] = [newSessionId(), newSessionId()];
    const first = recordOne(harness, fieldsOf(a, { inputTokens: 905, costUsd: 0.0009 }));
    const second = recordOne(harness, fieldsOf(b, { outputTokens: 77, thinkingTokens: 31 }));
    expect(added).toEqual([
      { sessionId: a, used: objectAt(first.metric, 'values') },
      { sessionId: b, used: objectAt(second.metric, 'values') },
    ]);
  });

  it('answers totals from an injected counter', () => {
    const { counter } = keepingCounter(ANSWER);
    const harness = capture(counter);
    const sessionId = newSessionId();
    harness.recorder.record(asCall(fieldsOf(sessionId)));
    expect(harness.recorder.totals(sessionId)).toEqual(ANSWER);
  });

  it('hands an injected counter nothing for a refused call', () => {
    const { counter, added } = keepingCounter(ANSWER);
    const harness = capture(counter);
    const error = attempt(() => {
      harness.recorder.record(asCall(fieldsOf(newSessionId(), { prompt: PROMPT })));
    });
    expect(error).toBeInstanceOf(Error);
    expect(added).toEqual([]);
    expect(harness.lines).toEqual([]);
  });

  it('keeps the totals in process memory when the counter option is undefined', () => {
    const lines: string[] = [];
    const recorder = createModelCallRecorder({
      service: SERVICE,
      write: (line: string) => {
        lines.push(line);
      },
      counter: undefined,
    });
    const sessionId = newSessionId();
    recorder.record(asCall(fieldsOf(sessionId, { inputTokens: 10, costUsd: 0.5 })));
    recorder.record(asCall(fieldsOf(sessionId, { inputTokens: 5, costUsd: 0.125 })));
    expect(lines).toHaveLength(4);
    expect(totalsOf(recorder, sessionId)).toMatchObject({ inputTokens: 15, costUsd: 0.625 });
  });
});
