// Stage 1, issue #27 (T2), Task 1: the segment contract (docs/spec/inputs.md 4.1 and 4.2, ADR 0005 with its addenda
// of 2026-10-25 and of T2), AC1 to AC4, plus the fixture and the JSON round trip of skill `new-contract` step 5.
//
// Public interface these tests define (built in Task 1):
//   src/segment.ts           export const Segment   a Zod schema (z.strictObject, schemaVersion: z.literal(1))
//                            export type Segment    its inferred type
//   src/testing/fixtures.ts  export const segmentFixture: Segment   a valid example
//   Segment.safeParse(value) -> { success: true, data } | { success: false, error: { issues: [{ path, ... }] } }
//   A rejection names the failing field: the first element of an issue's path is that field.
//
// Boundary precision: audio seconds in this repo carry up to six decimals (Deepgram word times); the boundary rows
// use 0.001 s, the precision the Python harness rounds finalizedAt to (evals/src/harness/mitschnitt.py).
// Word order (AC3 "words out of time order"; Owner decision gate 1 2026-10-29: variant (a), sorting): a word that starts
// before the word in front of it starts is out of order and rejected; the Inputs sort the words of a Segment by start.
// Golden Set (recordings deepgram-nova3-v1, reference transcripts): 13 such pairs in the final blocks, 15 in the Turns.
// Overlapping words (a word starting before the previous one ends, not before it starts) are valid: 30 such pairs in
// those final blocks, 108 in those Turns.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Segment } from './segment.ts';
import { segmentFixture } from './testing/fixtures.ts';

type Json = Record<string, unknown>;

const FIELDS = [
  'schemaVersion',
  'id',
  'sessionId',
  'speaker',
  'start',
  'end',
  'finalizedAt',
  'language',
  'words',
] as const;
const WORD_FIELDS = ['w', 'start', 'end'] as const;

/** A valid Segment after inputs 4.1 (times made consistent with the word times). */
function valid(): Json {
  return {
    schemaVersion: 1,
    id: 's-0412',
    sessionId: '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10',
    speaker: 'A',
    start: 0.12,
    end: 0.71,
    finalizedAt: 14.01,
    language: 'de',
    words: [
      { w: 'die', start: 0.12, end: 0.25 },
      { w: 'Mieten', start: 0.25, end: 0.71 },
    ],
  };
}

function withField(name: string, value: unknown): Json {
  return { ...valid(), [name]: value };
}

function without(name: string): Json {
  const segment = valid();
  delete segment[name];
  return segment;
}

function withWords(words: Json[], extra: Json = {}): Json {
  const first = words[0];
  const last = words.at(-1);
  return { ...valid(), start: first?.['start'], end: last?.['end'], words, ...extra };
}

function issuePaths(value: unknown): (string | number)[][] {
  const result = Segment.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => [...issue.path] as (string | number)[]);
}

function expectRejected(value: unknown, field: string): void {
  const result = Segment.safeParse(value);
  expect(result.success).toBe(false);
  const firsts = issuePaths(value).map((path) => path[0]);
  expect(firsts).toContain(field);
}

describe('Segment accepts a valid Segment (AC1)', () => {
  it('parses the inputs 4.1 example unchanged', () => {
    const result = Segment.safeParse(valid());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(valid());
  });

  it('parses the exported fixture', () => {
    expect(Segment.safeParse(segmentFixture).success).toBe(true);
  });

  it.each([
    {
      validClass: 'a single word',
      value: withWords([{ w: 'Ja.', start: 3, end: 3.4 }], { finalizedAt: 3.4 }),
    },
    {
      validClass: 'finalizedAt equal to end (text mode, boundary)',
      value: withField('finalizedAt', 0.71),
    },
    {
      validClass: 'start 0 (lowest audio second, boundary)',
      value: withWords([{ w: 'Guten', start: 0, end: 0.3 }]),
    },
    {
      validClass: 'a word that ends where it starts (boundary, 10 in the Golden Set)',
      value: withWords([{ w: 'äh', start: 2, end: 2 }]),
    },
    {
      validClass: 'overlapping words, the next starts before the previous ends (Golden Set)',
      value: withWords([
        { w: 'nicht', start: 1.0, end: 1.4 },
        { w: 'so', start: 1.2, end: 1.5 },
      ]),
    },
    {
      validClass: 'two words starting at the same time (boundary of the order rule)',
      value: withWords([
        { w: 'und', start: 1.0, end: 1.2 },
        { w: 'dann', start: 1.0, end: 1.5 },
      ]),
    },
    {
      validClass:
        'a last word ending before an earlier word (end is the last word, not the latest end)',
      value: withWords([
        { w: 'eigentlich', start: 5.0, end: 5.9 },
        { w: 'ja', start: 5.1, end: 5.3 },
      ]),
    },
    { validClass: 'speaker B', value: withField('speaker', 'B') },
    { validClass: 'speaker Z', value: withField('speaker', 'Z') },
    { validClass: 'speaker AA (the 27th label)', value: withField('speaker', 'AA') },
    { validClass: 'id s-0', value: withField('id', 's-0') },
    { validClass: 'id s-0001 (harness form)', value: withField('id', 's-0001') },
    { validClass: 'id s-10000 (more than four digits)', value: withField('id', 's-10000') },
  ])('accepts $validClass', ({ value }) => {
    expect(issuePaths(value)).toEqual([]);
    expect(Segment.safeParse(value).success).toBe(true);
  });
});

describe('Segment rejects a missing, unknown or wrongly typed field (AC2)', () => {
  it.each(FIELDS.map((field) => ({ field })))(
    'rejects a Segment without $field and names it',
    ({ field }) => {
      expectRejected(without(field), field);
    },
  );

  it.each([
    { field: 'schemaVersion', value: '1' },
    { field: 'id', value: 412 },
    { field: 'sessionId', value: 5 },
    { field: 'speaker', value: 1 },
    { field: 'start', value: '0.12' },
    { field: 'end', value: null },
    { field: 'finalizedAt', value: '14.01' },
    { field: 'language', value: 7 },
    { field: 'words', value: { w: 'die', start: 0.12, end: 0.71 } },
  ])('rejects $field of the wrong type ($value) and names it', ({ field, value }) => {
    expectRejected(withField(field, value), field);
  });

  it('rejects schemaVersion 2 (the contract is version 1)', () => {
    expectRejected(withField('schemaVersion', 2), 'schemaVersion');
  });

  it('rejects an empty words list', () => {
    expectRejected(withField('words', []), 'words');
  });

  it('rejects a negative audio second', () => {
    expectRejected(withWords([{ w: 'die', start: -0.001, end: 0.25 }]), 'start');
  });

  it('rejects an unknown top-level field and names it', () => {
    expectRejected(withField('text', 'die Mieten'), 'text');
  });

  it('rejects an unknown field in a word', () => {
    expectRejected(withWords([{ w: 'die', start: 0.12, end: 0.25, confidence: 0.9 }]), 'words');
  });

  it.each(WORD_FIELDS.map((field) => ({ field })))('rejects a word without $field', ({ field }) => {
    const word: Json = { w: 'die', start: 0.12, end: 0.25 };
    delete word[field];
    expectRejected({ ...valid(), start: 0.12, end: 0.25, words: [word] }, 'words');
  });

  it.each([
    { field: 'w', value: 7 },
    { field: 'start', value: '0.12' },
    { field: 'end', value: null },
  ])('rejects a word whose $field has the wrong type', ({ field, value }) => {
    const word: Json = { w: 'die', start: 0.12, end: 0.25, [field]: value };
    expectRejected({ ...valid(), start: 0.12, end: 0.25, words: [word] }, 'words');
  });
});

describe('Segment rejects inconsistent times (AC3)', () => {
  it.each([
    {
      rule: 'start 0.001 s before the first word',
      field: 'start',
      value: withField('start', 0.119),
    },
    {
      rule: 'start 0.001 s after the first word',
      field: 'start',
      value: withField('start', 0.121),
    },
    { rule: 'end 0.001 s before the last word ends', field: 'end', value: withField('end', 0.709) },
    { rule: 'end 0.001 s after the last word ends', field: 'end', value: withField('end', 0.711) },
    {
      rule: 'a word that ends 0.001 s before it starts',
      field: 'words',
      value: withWords([{ w: 'die', start: 0.25, end: 0.249 }]),
    },
    {
      rule: 'a word that starts 0.001 s before the word in front of it',
      field: 'words',
      value: withWords([
        { w: 'die', start: 0.25, end: 0.4 },
        { w: 'Mieten', start: 0.249, end: 0.71 },
      ]),
    },
    {
      rule: 'finalizedAt 0.001 s before end',
      field: 'finalizedAt',
      value: withField('finalizedAt', 0.709),
    },
  ])('rejects $rule and names $field', ({ field, value }) => {
    expectRejected(value, field);
  });
});

describe('Segment rejects a name as speaker, a malformed id and an overlap field (AC4)', () => {
  it.each([
    { invalid: 'a name', value: 'Kallac Haqy' },
    { invalid: 'a lower-case label', value: 'a' },
    { invalid: 'a provider label', value: 'dg-0' },
    { invalid: 'an empty label', value: '' },
    { invalid: 'a label with a digit', value: 'A1' },
    { invalid: 'a label with a trailing space', value: 'A ' },
  ])('rejects $invalid as speaker', ({ value }) => {
    expectRejected(withField('speaker', value), 'speaker');
  });

  it.each([
    { invalid: 'digits only', value: '0412' },
    { invalid: 'no digits', value: 's-' },
    { invalid: 'a letter after the digits', value: 's-12a' },
    { invalid: 'an upper-case prefix', value: 'S-0412' },
    { invalid: 'another prefix', value: 'seg-412' },
    { invalid: 'a trailing space', value: 's-0412 ' },
  ])('rejects id with $invalid', ({ value }) => {
    expectRejected(withField('id', value), 'id');
  });

  it.each([{ value: true }, { value: false }])(
    'rejects an overlap field ($value) as unknown',
    ({ value }) => {
      expectRejected(withField('overlap', value), 'overlap');
    },
  );
});

describe('Segment survives a JSON round trip', () => {
  it('parses the JSON text of a parsed Segment to the same Segment', () => {
    const parsed = Segment.parse(valid());
    expect(Segment.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
});

// ---- properties ------------------------------------------------------------------------------------------------

/** 0 -> A, 25 -> Z, 26 -> AA (inputs 4.1, harness letter_label). */
function letterLabel(index: number): string {
  let label = '';
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26))
    label = String.fromCharCode(65 + ((i - 1) % 26)) + label;
  return label;
}

const ms = (value: number): number => value / 1000;

const wordsArb = fc
  .array(
    fc.record({
      w: fc.string({ minLength: 1, maxLength: 12 }),
      step: fc.integer({ min: 0, max: 2000 }),
      duration: fc.integer({ min: 0, max: 1500 }),
    }),
    { minLength: 1, maxLength: 30 },
  )
  .chain((raw) =>
    fc.integer({ min: 0, max: 3_600_000 }).map((origin) => {
      let at = origin;
      return raw.map(({ w, step, duration }, i) => {
        if (i > 0) at += step;
        return { w, start: ms(at), end: ms(at + duration) };
      });
    }),
  );

const segmentArb = fc
  .record({
    digits: fc.nat({ max: 9_999_999 }),
    pad: fc.integer({ min: 1, max: 8 }),
    sessionId: fc.uuid(),
    label: fc.nat({ max: 701 }),
    language: fc.constantFrom('de', 'en'),
    words: wordsArb,
    delay: fc.integer({ min: 0, max: 30_000 }),
  })
  .map(({ digits, pad, sessionId, label, language, words, delay }) => {
    const first = words[0];
    const last = words.at(-1);
    if (first === undefined || last === undefined)
      throw new Error('wordsArb yields at least one word');
    return {
      schemaVersion: 1,
      id: `s-${String(digits).padStart(pad, '0')}`,
      sessionId,
      speaker: letterLabel(label),
      start: first.start,
      end: last.end,
      finalizedAt: ms(Math.round(last.end * 1000) + delay),
      language,
      words,
    } as Json;
  });

describe('Segment properties (fast-check)', () => {
  it('accepts every generated valid Segment and returns it unchanged', () => {
    fc.assert(
      fc.property(segmentArb, (segment) => {
        const result = Segment.safeParse(segment);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toEqual(segment);
      }),
    );
  });

  it('rejects a generated valid Segment once any one field is removed', () => {
    fc.assert(
      fc.property(segmentArb, fc.constantFrom(...FIELDS), (segment, field) => {
        const copy = { ...segment };
        delete copy[field];
        expect(Segment.safeParse(copy).success).toBe(false);
      }),
    );
  });

  it('rejects a generated valid Segment once any unknown field is added', () => {
    const known = new Set<string>(FIELDS);
    const unknownKey = fc
      .string({ minLength: 1, maxLength: 16 })
      .filter((key) => !known.has(key) && key !== '__proto__');
    fc.assert(
      fc.property(segmentArb, unknownKey, fc.jsonValue(), (segment, key, value) => {
        expect(Segment.safeParse({ ...segment, [key]: value }).success).toBe(false);
      }),
    );
  });

  it('keeps every generated valid Segment through a JSON round trip', () => {
    fc.assert(
      fc.property(segmentArb, (segment) => {
        expect(Segment.parse(JSON.parse(JSON.stringify(segment)))).toEqual(segment);
      }),
    );
  });
});
