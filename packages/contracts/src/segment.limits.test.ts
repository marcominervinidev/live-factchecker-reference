// Stage 1, issue #27 (T2), Task 1, gate-1 addendum of 2026-10-29 (owner Marco, after the review chain of Task 1:
// reviewer m4, security review F1, F4 and F5): the upper bounds of the segment contract v1, the word order with
// three and more words, the anchors of the id and speaker patterns, and hostile input as JSON.parse delivers it.
//
// Sources (ticket #27, comment "Tor-1-Nachtrag (2026-10-29)"):
//   words at most 500 entries; w at most 100 characters and may be empty (the rule min(1) had no source);
//   id ^s-[0-9]{1,15}$; sessionId at most 64 characters; language at most 35 characters;
//   AudioSeconds (start, end, finalizedAt and the word times) at most 86 400 s; speaker stays ^[A-Z]+$.
//   Word order and the other rules: segment.test.ts (gate 1 of 2026-10-29, variant (a)).
// A rejection names the failing field (.claude/rules/contracts.md); a word's field by its full path
// ['words', <index>, <field>]. Every string here is ASCII, so a character is one UTF-16 code unit. Time boundaries
// step by 0.001 s, as in segment.test.ts. Black box: only Segment.safeParse.
import { Segment } from './segment.ts';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;
type Field = string | number;

const MAX_SECONDS = 86_400;
const OVER_SECONDS = 86_400.001;

function word(w: string, start: unknown, end: unknown): Json {
  return { w, start, end };
}

/** A Segment around the given words: start, end and finalizedAt follow from them (inputs 4.1). */
function segmentOf(words: readonly Json[], extra: Json = {}): Json {
  return {
    schemaVersion: 1,
    id: 's-0412',
    sessionId: '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10',
    speaker: 'A',
    start: words[0]?.['start'],
    end: words.at(-1)?.['end'],
    finalizedAt: words.at(-1)?.['end'],
    language: 'de',
    words,
    ...extra,
  };
}

/** The inputs 4.1 example, finalized at 14.01 s; `extra` replaces fields. */
function valid(extra: Json = {}): Json {
  return segmentOf([word('die', 0.12, 0.25), word('Mieten', 0.25, 0.71)], {
    finalizedAt: 14.01,
    ...extra,
  });
}

/** ASCII text of exactly `length` characters, `unit` repeated. */
function textOf(length: number, unit = 'abcdefghij'): string {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
}

/** `count` words 0.1 s apart, in order. */
function wordsOf(count: number): Json[] {
  return Array.from({ length: count }, (_, i) => word('ja', i / 10, i / 10 + 0.05));
}

/** A placeholder replaced by a raw JSON literal that JSON.stringify cannot write (1e400, -0). */
const SLOT = '__slot__';

function jsonWith(value: Json, literal: string): string {
  return JSON.stringify(value).replaceAll(`"${SLOT}"`, literal);
}

function issuesOf(value: unknown) {
  const result = Segment.safeParse(value);
  return result.success ? [] : result.error.issues;
}

function expectAccepted(value: unknown): void {
  expect(issuesOf(value)).toEqual([]);
  expect(Segment.safeParse(value).success).toBe(true);
}

/** Rejected, and one issue's path starts with `field`: the rejection names that field. */
function expectRejected(value: unknown, ...field: Field[]): void {
  expect(Segment.safeParse(value).success).toBe(false);
  expect(issuesOf(value).map((issue) => issue.path.slice(0, field.length))).toContainEqual(field);
}

describe('Segment upper bounds (gate-1 addendum 2026-10-29)', () => {
  const bounds: { field: string; bound: string; path: Field[]; atMax: Json; overMax: Json }[] = [
    {
      field: 'words',
      bound: '500 entries',
      path: ['words'],
      atMax: segmentOf(wordsOf(500)),
      overMax: segmentOf(wordsOf(501)),
    },
    {
      field: 'w',
      bound: '100 characters',
      path: ['words', 0, 'w'],
      atMax: segmentOf([word(textOf(100), 1, 1.5)]),
      overMax: segmentOf([word(textOf(101), 1, 1.5)]),
    },
    {
      field: 'id',
      bound: '15 digits',
      path: ['id'],
      atMax: valid({ id: `s-${'9'.repeat(15)}` }),
      overMax: valid({ id: `s-${'9'.repeat(16)}` }),
    },
    {
      field: 'sessionId',
      bound: '64 characters',
      path: ['sessionId'],
      atMax: valid({ sessionId: textOf(64) }),
      overMax: valid({ sessionId: textOf(65) }),
    },
    {
      field: 'language',
      bound: '35 characters',
      path: ['language'],
      atMax: valid({ language: textOf(35) }),
      overMax: valid({ language: textOf(36) }),
    },
    {
      field: 'start',
      bound: '86 400 s',
      path: ['start'],
      atMax: segmentOf([word('ja', MAX_SECONDS, MAX_SECONDS)]),
      overMax: segmentOf([word('ja', OVER_SECONDS, OVER_SECONDS)]),
    },
    {
      field: 'end',
      bound: '86 400 s',
      path: ['end'],
      atMax: segmentOf([word('ja', 86_399.5, MAX_SECONDS)]),
      overMax: segmentOf([word('ja', 86_399.5, OVER_SECONDS)]),
    },
    {
      field: 'finalizedAt',
      bound: '86 400 s',
      path: ['finalizedAt'],
      atMax: valid({ finalizedAt: MAX_SECONDS }),
      overMax: valid({ finalizedAt: OVER_SECONDS }),
    },
    {
      field: 'the start of a later word',
      bound: '86 400 s',
      path: ['words', 1, 'start'],
      atMax: segmentOf([word('nein', 86_399, 86_399.5), word('doch', MAX_SECONDS, MAX_SECONDS)]),
      overMax: segmentOf([
        word('nein', 86_399, 86_399.5),
        word('doch', OVER_SECONDS, OVER_SECONDS),
      ]),
    },
    {
      field: 'the end of a word that is not the last',
      bound: '86 400 s',
      path: ['words', 0, 'end'],
      atMax: segmentOf([word('eigentlich', 5, MAX_SECONDS), word('ja', 5.1, 5.3)]),
      overMax: segmentOf([word('eigentlich', 5, OVER_SECONDS), word('ja', 5.1, 5.3)]),
    },
  ];

  it.each(bounds)('accepts $field at its upper bound of $bound', ({ atMax }) => {
    expectAccepted(atMax);
  });

  it.each(bounds)('rejects $field one over $bound and names it', ({ overMax, path }) => {
    expectRejected(overMax, ...path);
  });

  it('accepts an empty w', () => {
    expectAccepted(segmentOf([word('', 1, 1.2)]));
  });
});

describe('Segment word order with three and more words (gate-1 addendum, reviewer m4)', () => {
  it('rejects a third word that starts 0.001 s before the second, after the first, and names words', () => {
    expectRejected(
      segmentOf([word('nicht', 1.0, 1.2), word('so', 1.3, 1.5), word('schnell', 1.299, 1.8)]),
      'words',
    );
  });

  it('accepts three words that start at the same time', () => {
    expectAccepted(
      segmentOf([word('und', 1.0, 1.1), word('dann', 1.0, 1.2), word('so', 1.0, 1.3)]),
    );
  });

  it('rejects 3 to 20 ordered words once any one word starts before the word in front of it', () => {
    // Whole milliseconds from 1 s on; starts never fall (equal starts included) and words may overlap. `back` moves
    // word k to start 1 to 1000 ms before word k - 1: (k - 1, k) is then the only pair out of order, and start, end
    // and finalizedAt stay those of the first and the last word.
    const caseArb = fc
      .tuple(
        fc.integer({ min: 1000, max: 3_600_000 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 0, max: 1500 })), {
          minLength: 3,
          maxLength: 20,
        }),
      )
      .map(([origin, steps]) => {
        let at = origin;
        return steps.map(([step, duration], i) => {
          if (i > 0) at += step;
          return { start: at, end: at + duration };
        });
      })
      .chain((times) =>
        fc.tuple(
          fc.constant(times),
          fc.integer({ min: 1, max: times.length - 1 }),
          fc.integer({ min: 1, max: 1000 }),
        ),
      );
    const toWords = (times: readonly { start: number; end: number }[]): Json[] =>
      times.map(({ start, end }, i) => word(`w${i}`, start / 1000, end / 1000));

    fc.assert(
      fc.property(caseArb, ([times, k, back]) => {
        const moved = times.map((time, i) =>
          i === k ? { ...time, start: (times[k - 1]?.start ?? 0) - back } : time,
        );
        expectAccepted(segmentOf(toWords(times)));
        expectRejected(segmentOf(toWords(moved)), 'words');
      }),
    );
  });
});

describe('Segment patterns are anchored at both ends (gate-1 addendum)', () => {
  it.each([
    { anchor: 'a prefix before s-', value: 'xs-1' },
    { anchor: 'a suffix after the digits', value: 's-1x' },
    { anchor: 'a trailing line break', value: 's-1\n' },
  ])('rejects id with $anchor', ({ value }) => {
    expectRejected(valid({ id: value }), 'id');
  });

  it.each([
    { anchor: 'a lower-case prefix', value: 'xA' },
    { anchor: 'a lower-case suffix', value: 'Ax' },
    { anchor: 'a trailing line break', value: 'A\n' },
  ])('rejects speaker with $anchor', ({ value }) => {
    expectRejected(valid({ speaker: value }), 'speaker');
  });
});

describe('Segment rejects hostile JSON input without harm (gate-1 addendum, security review)', () => {
  const prototypeKeys = ['__proto__', 'constructor', 'toString'];
  const payload = '{"polluted":"yes","prototype":{"polluted":"yes"}}';

  it.each(prototypeKeys)(
    'rejects %s as an unknown top-level field and leaves Object.prototype unchanged',
    (key) => {
      const before = Object.getOwnPropertyDescriptors(Object.prototype);
      const value: unknown = JSON.parse(`{"${key}":${payload},${JSON.stringify(valid()).slice(1)}`);
      expectRejected(value, key);
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
      expect(Reflect.get({}, 'polluted')).toBeUndefined();
    },
  );

  it.each(prototypeKeys)(
    'rejects %s as an unknown field of a word and leaves Object.prototype unchanged',
    (key) => {
      const before = Object.getOwnPropertyDescriptors(Object.prototype);
      const text = JSON.stringify(valid()).replace('{"w":"die"', `{"${key}":${payload},"w":"die"`);
      const value: unknown = JSON.parse(text);
      expectRejected(value, 'words', 0, key);
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
      expect(Reflect.get({}, 'polluted')).toBeUndefined();
    },
  );

  it.each([
    { kind: 'null', text: 'null' },
    { kind: 'a string', text: '"s-0412"' },
    { kind: 'an empty array', text: '[]' },
    { kind: 'an array holding a valid Segment', text: `[${JSON.stringify(valid())}]` },
    { kind: 'a number', text: '412' },
  ])('answers $kind with an invalid_type issue at the top and does not throw', ({ text }) => {
    const value: unknown = JSON.parse(text);
    expect(() => Segment.safeParse(value)).not.toThrow();
    expect(Segment.safeParse(value).success).toBe(false);
    const issues = issuesOf(value);
    expect(issues.map((issue) => [issue.code, issue.path])).toContainEqual(['invalid_type', []]);
    expect(issues.every((issue) => issue.path.length === 0)).toBe(true);
  });

  const timeFields: { name: string; path: Field[]; at: (value: unknown) => Json }[] = [
    { name: 'start', path: ['start'], at: (value) => valid({ start: value }) },
    { name: 'end', path: ['end'], at: (value) => valid({ end: value }) },
    { name: 'finalizedAt', path: ['finalizedAt'], at: (value) => valid({ finalizedAt: value }) },
    {
      name: 'a word start',
      path: ['words', 0, 'start'],
      at: (value) => valid({ words: [word('die', value, 0.25), word('Mieten', 0.25, 0.71)] }),
    },
    {
      name: 'a word end',
      path: ['words', 1, 'end'],
      at: (value) => valid({ words: [word('die', 0.12, 0.25), word('Mieten', 0.25, value)] }),
    },
  ];

  it.each(timeFields)('rejects 1e400 (Infinity after JSON.parse) as $name', ({ path, at }) => {
    const value: unknown = JSON.parse(jsonWith(at(SLOT), '1e400'));
    expectRejected(value, ...path);
  });

  it.each(timeFields)('rejects NaN as $name', ({ path, at }) => {
    expectRejected(at(Number.NaN), ...path);
  });

  it('accepts -0 as start, end, finalizedAt and word times', () => {
    const value: unknown = JSON.parse(jsonWith(segmentOf([word('ja', SLOT, SLOT)]), '-0'));
    expect(value).toHaveProperty('start', -0);
    expectAccepted(value);
  });

  it('rejects schemaVersion true', () => {
    const value: unknown = JSON.parse(jsonWith(valid({ schemaVersion: SLOT }), 'true'));
    expectRejected(value, 'schemaVersion');
  });

  it('answers 10 000 unknown fields with success false and does not throw', () => {
    const unknownFields = Array.from({ length: 10_000 }, (_, i) => `"x${i}":0`).join(',');
    const value: unknown = JSON.parse(`{${unknownFields},${JSON.stringify(valid()).slice(1)}`);
    expect(() => Segment.safeParse(value)).not.toThrow();
    expect(Segment.safeParse(value).success).toBe(false);
  });

  it('never throws for a valid Segment with one field or one word field replaced by any JSON value', () => {
    const fields = Object.keys(valid());
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...fields).map((field) => ({ field, inWord: false })),
          fc.constantFrom('w', 'start', 'end').map((field) => ({ field, inWord: true })),
        ),
        fc.jsonValue(),
        ({ field, inWord }, replacement) => {
          const value = inWord
            ? valid({
                words: [
                  { ...word('die', 0.12, 0.25), [field]: replacement },
                  word('Mieten', 0.25, 0.71),
                ],
              })
            : valid({ [field]: replacement });
          expect(() => Segment.safeParse(value)).not.toThrow();
        },
      ),
    );
  });
});

describe('Segment rejections never echo the rejected value (gate-1 addendum, security review)', () => {
  it.each([
    {
      field: 'w',
      secret: 'Mietpreisbremse',
      value: valid({
        words: [word(textOf(101, 'Mietpreisbremse'), 0.12, 0.25), word('Mieten', 0.25, 0.71)],
      }),
    },
    { field: 'speaker', secret: 'Haqy', value: valid({ speaker: 'Kallac Haqy' }) },
    {
      field: 'sessionId',
      secret: 'geheime-sitzung',
      value: valid({ sessionId: textOf(65, 'geheime-sitzung-') }),
    },
  ])('rejects a bad $field without its value in any issue', ({ secret, value }) => {
    const issues = issuesOf(value);
    expect(issues).not.toEqual([]);
    expect(issues.map((issue) => issue.message).join('\n')).not.toContain(secret);
    expect(JSON.stringify(issues)).not.toContain(secret);
  });
});
