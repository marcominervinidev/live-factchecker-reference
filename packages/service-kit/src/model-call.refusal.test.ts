// Stage 1, issue #26 task 1 (implementer-owned): the refusal paths of the model call record, each refused with an
// Error that names the refused field (and no other) without echoing its value, no line written and nothing counted
// (README, model-call.ts). Closes the behavioural Stryker survivors of model-call.ts that the frozen tests leave open
// (they never pass null, undefined or an inherited field); the wording of the sentence is not asserted. Goes through
// the public createModelCallRecorder interface only, with a counter that records every add.
import { describe, expect, it } from 'vitest';

import {
  createModelCallRecorder,
  type ModelCall,
  type SessionCounter,
  type SessionTotals,
} from './model-call.ts';

const SESSION = 's-26-refusal';

function validFields(): Record<string, unknown> {
  return {
    sessionId: SESSION,
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
  };
}

/** Every field a model call has, and the foreign field the cases below add. */
const FIELDS = [...Object.keys(validFields()), 'prompt'];

function withoutCostUsd(): Record<string, unknown> {
  const fields = validFields();
  Reflect.deleteProperty(fields, 'costUsd');
  return fields;
}

/** The message of the Error the call throws; fails the test when it throws nothing or something else. */
function refusalOf(call: () => void): string {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error instanceof Error ? error.message : '';
  }
  throw new Error('expected a refusal, but nothing was thrown');
}

/** The model call fields that the message names as a whole word. */
function namedFields(message: string): string[] {
  const words = new Set(message.match(/[A-Za-z_][A-Za-z0-9_]*/g));
  return FIELDS.filter((field) => words.has(field));
}

/** An untyped caller: the cases below pass values the ModelCall type would reject. */
function setup(): {
  lines: string[];
  adds: { sessionId: string; used: SessionTotals }[];
  record: (input: unknown) => void;
} {
  const lines: string[] = [];
  const adds: { sessionId: string; used: SessionTotals }[] = [];
  const counter: SessionCounter = {
    add(sessionId, used) {
      adds.push({ sessionId, used });
    },
    totals() {
      throw new Error('totals is not read by record');
    },
  };
  const recorder = createModelCallRecorder({
    service: 'detection',
    write: (line: string) => {
      lines.push(line);
    },
    counter,
  });
  return {
    lines,
    adds,
    record: (input) => {
      recorder.record(input as ModelCall);
    },
  };
}

describe('createModelCallRecorder: a refused model call', () => {
  it('records a valid call (control: the setup writes and counts)', () => {
    const { lines, adds, record } = setup();
    record(validFields());
    expect(lines).toHaveLength(2);
    expect(adds).toHaveLength(1);
  });

  it.each([
    { name: 'null', input: null },
    { name: 'undefined', input: undefined },
  ])(
    'refuses $name as not a plain object, names no field, writes and counts nothing',
    ({ input }) => {
      const { lines, adds, record } = setup();
      const message = refusalOf(() => {
        record(input);
      });
      expect(namedFields(message)).toEqual([]);
      expect(lines).toEqual([]);
      expect(adds).toEqual([]);
    },
  );

  it.each([
    { name: 'a missing field', fields: withoutCostUsd(), field: 'costUsd', value: [] },
    {
      name: 'a field set to undefined',
      fields: { ...validFields(), costUsd: undefined },
      field: 'costUsd',
      value: [],
    },
    {
      name: 'a foreign field prompt',
      fields: { ...validFields(), prompt: 'Is the claim true?' },
      field: 'prompt',
      value: ['Is the claim true?'],
    },
    {
      name: 'an empty sessionId',
      fields: { ...validFields(), sessionId: '' },
      field: 'sessionId',
      value: [],
    },
  ])('refuses $name, names only $field, writes and counts nothing', ({ fields, field, value }) => {
    const { lines, adds, record } = setup();
    const message = refusalOf(() => {
      record(fields);
    });
    expect(namedFields(message)).toEqual([field]);
    // The refused value, where it is text that could be echoed; none of it appears in the message.
    expect(value.filter((text) => message.includes(text))).toEqual([]);
    expect(lines).toEqual([]);
    expect(adds).toEqual([]);
  });

  it('refuses a field inherited from a polluted Object.prototype as missing, writes and counts nothing', () => {
    const { lines, adds, record } = setup();
    const fields = withoutCostUsd();
    // Writable like a field set by plain assignment: a read-only one would make any later `x.costUsd = …` throw a
    // TypeError of its own, which would pass this test even without the own-property check.
    Object.defineProperty(Object.prototype, 'costUsd', {
      value: 0.5,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    try {
      const message = refusalOf(() => {
        record(fields);
      });
      expect(namedFields(message)).toEqual(['costUsd']);
      expect(message).not.toContain('0.5');
    } finally {
      Reflect.deleteProperty(Object.prototype, 'costUsd');
    }
    expect(Object.prototype).not.toHaveProperty('costUsd');
    expect(lines).toEqual([]);
    expect(adds).toEqual([]);
  });
});
