// Stage 1, implementer's test for an internal of #27 task 1: `unknownFieldsNamed` (src/common.ts) names an unknown
// field even when another field fails too, and names it with its full path inside a list. The frozen contract tests
// (src/segment.test.ts) cover the single-failure cases. Also pins the rejection of non-objects and the path and
// message of each refinement (surviving mutants otherwise).
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { unknownFieldsNamed, Word } from './common.ts';
import { Segment } from './segment.ts';
import { segmentFixture } from './testing/fixtures.ts';

const Pair = z.strictObject({ a: z.number(), words: z.array(Word) }).check(unknownFieldsNamed);

function paths(value: unknown): unknown[][] {
  const result = Pair.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

describe('unknownFieldsNamed', () => {
  it("adds one issue per unknown field with the field as its path and keeps Zod's own issue", () => {
    expect(paths({ a: 1, words: [], x: 1, y: 2 })).toEqual([[], ['x'], ['y']]);
  });

  it('still names an unknown field when another field has the wrong type', () => {
    expect(paths({ a: 'one', words: [], x: 1 })).toEqual(expect.arrayContaining([['a'], ['x']]));
  });

  it('names an unknown field of a word with its full path', () => {
    expect(paths({ a: 1, words: [{ w: 'ja', start: 0, end: 0.2, confidence: 0.9 }] })).toEqual([
      ['words', 0],
      ['words', 0, 'confidence'],
    ]);
  });

  it('lets the rules across fields still run next to an unknown field', () => {
    const result = Segment.safeParse({ ...segmentFixture, text: 'x', start: 0.1 });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([['text'], ['start']]),
    );
  });

  it('leaves a value without unknown fields untouched', () => {
    expect(Pair.safeParse({ a: 1, words: [{ w: 'ja', start: 0, end: 0.2 }] }).success).toBe(true);
  });
});

describe('Segment and Word with a value that is not an object', () => {
  it.each([{ value: null }, { value: 'x' }, { value: [] }, { value: 5 }])(
    'reject $value with invalid_type and never throw',
    ({ value }) => {
      for (const schema of [Segment, Word]) {
        const result = schema.safeParse(value);
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((issue) => issue.code)).toEqual(['invalid_type']);
      }
    },
  );
});

describe('Segment refinements name their path and message', () => {
  const words = [
    { w: 'die', start: 0.12, end: 0.25 },
    { w: 'Mieten', start: 0.25, end: 0.71 },
  ];

  function issues(value: unknown): { path: unknown[]; message: string }[] {
    const result = Segment.safeParse(value);
    return result.success
      ? []
      : result.error.issues.map(({ path, message }) => ({ path, message }));
  }

  it.each([
    {
      rule: 'a word that ends before it starts',
      value: {
        ...segmentFixture,
        words: [words[0], { w: 'Mieten', start: 0.71, end: 0.7 }],
        end: 0.7,
      },
      expected: { path: ['words', 1, 'end'], message: 'a word ends before it starts' },
    },
    {
      rule: 'start before the first word',
      value: { ...segmentFixture, start: 0.1 },
      expected: { path: ['start'], message: 'start is not the start of the first word' },
    },
    {
      rule: 'end after the last word',
      value: { ...segmentFixture, end: 0.8 },
      expected: { path: ['end'], message: 'end is not the end of the last word' },
    },
    {
      rule: 'a word starting before the word in front of it',
      value: {
        ...segmentFixture,
        start: 0.25,
        words: [words[1], { w: 'die', start: 0.12, end: 0.71 }],
      },
      expected: { path: ['words'], message: 'a word starts before the word in front of it' },
    },
    {
      rule: 'finalizedAt before end',
      value: { ...segmentFixture, finalizedAt: 0.7 },
      expected: { path: ['finalizedAt'], message: 'finalizedAt is earlier than end' },
    },
    {
      rule: 'an unknown field',
      value: { ...segmentFixture, text: 'x' },
      expected: { path: ['text'], message: 'unknown field' },
    },
  ])('$rule', ({ value, expected }) => {
    expect(issues(value)).toContainEqual(expected);
  });
});

describe('unknownFieldsNamed issue code', () => {
  it('marks a named unknown field as a custom issue', () => {
    const result = Pair.safeParse({ a: 1, words: [], x: 1 });
    expect(result.error?.issues.map((issue) => issue.code)).toEqual([
      'unrecognized_keys',
      'custom',
    ]);
  });
});
