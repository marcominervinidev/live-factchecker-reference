// Stage 1, issue #32 (T6), contract commit (skill `new-contract`, before any consumer): the Topic event, one validated
// result of the Topic Extractor that changed the tag list or the current Topics, on a Session's detection stream
// (ADR 0005, addendum 2026-10-25: "Claim- und Topic-Ereignisse der Erkennung gehen je Session in einen Redis-Stream";
// ticket #32 AC9 and decision 1, Marco 2026-10-27, "alles ja": Session id, Tick time, `current`, `new` with `tag` and
// `parent`, `returned`, `ended`, nothing else).
//
// Public interface these tests define (proposal of the test designer for gate 1, names marked (P)):
//   src/topic-event.ts        export const TopicEvent   a Zod strict object with .check(unknownFieldsNamed):
//                               schemaVersion  z.literal(1)                      (ticket, Contracts: "schemaVersion 1")
//                               tickAt (P)     AudioSeconds of src/common.ts      the time of the Tick (AC9), seconds
//                                                                                  of Session audio time like every
//                                                                                  time of the detection stream
//                               current        string[]                          the current Topics as the result
//                                                                                  gives them
//                               new            { tag: string; parent: string | null }[]   strict, as applied (AC7)
//                               returned       string[]                          as applied (AC8)
//                               ended          string[]                          as applied (AC8)
//                             The Session is named by the envelope (detection-event.ts), never here, as for the
//                             Claim event (packages/contracts/README.md: "nor a sessionId (the envelope names the
//                             Session)").
//                             export type TopicEvent
//   src/index.ts              exports TopicEvent (so scripts/generate-json-schema.ts writes
//                             json-schema/topic-event.schema.json, ADR 0012)
//   src/testing/fixtures.ts   export const topicEventFixture: TopicEvent   a valid example
//   A rejection names the failing field: the first element of an issue's path is that field, inside `new` the path
//   is ['new', <index>, <field>].
// Bounds (owner, gate 1 of #32, O3, 2026-11-18, "Tor 1 wie empfohlen": "Session-Id nur in der Hülle, Tag 1 bis 200
// Zeichen, Listen ohne Obergrenze"): every tag, in current, new[].tag, new[].parent (when not null), returned and
// ended, has 1 to 200 characters, counted in Unicode code points as the contracts count them (zod's min and max on a
// string, as the Claim event's speaker bound of 200, src/claim-event.limits.test.ts); the cases at the bounds use a
// character outside the BMP (two UTF-16 code units), so a count in code units fails them; a combining accent makes a
// count in graphemes fail too. No list has an upper bound.
import { describe, expect, it } from 'vitest';

import { generateJsonSchemas } from '../scripts/generate-json-schema.ts';
import { topicEventFixture } from './testing/fixtures.ts';
import { TopicEvent } from './topic-event.ts';

type Json = Record<string, unknown>;

function valid(): Json {
  return {
    schemaVersion: 1,
    tickAt: 73.705,
    current: ['Mieten Berlin', 'Mietpreisbremse'],
    new: [{ tag: 'Mietpreisbremse', parent: 'Mieten Berlin' }],
    returned: [],
    ended: [],
  };
}

function without(event: Json, field: string): Json {
  return Object.fromEntries(Object.entries(event).filter(([name]) => name !== field));
}

function paths(value: unknown): (string | number)[][] {
  const result = TopicEvent.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => [...issue.path] as (string | number)[]);
}

function expectRejected(value: unknown, field: string): void {
  expect(TopicEvent.safeParse(value).success).toBe(false);
  expect(paths(value).map((path) => path[0])).toContain(field);
}

describe('TopicEvent accepts a Topic event with the fields of AC9', () => {
  it('parses a Topic event unchanged', () => {
    const result = TopicEvent.safeParse(valid());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(valid());
  });

  it('parses the fixture of @lfc/contracts/testing', () => {
    expect(TopicEvent.safeParse(topicEventFixture).success).toBe(true);
  });

  it('survives a JSON round trip unchanged', () => {
    const parsed = TopicEvent.parse(JSON.parse(JSON.stringify(topicEventFixture)) as unknown);
    expect(parsed).toEqual(topicEventFixture);
  });

  it('accepts a new tag without parent (a Topic of its own)', () => {
    const event = { ...valid(), new: [{ tag: 'Neubau', parent: null }] };
    expect(TopicEvent.safeParse(event).success).toBe(true);
  });

  it('accepts an event whose only change is the current Topics (empty new, returned and ended)', () => {
    const event = { ...valid(), current: ['Mieten Berlin'], new: [] };
    expect(TopicEvent.safeParse(event).success).toBe(true);
  });

  it('accepts returned and ended tags', () => {
    const event = { ...valid(), new: [], returned: ['Neubau'], ended: ['Mietpreisbremse'] };
    expect(TopicEvent.safeParse(event).success).toBe(true);
  });

  it.each([0, 86_400])('accepts tickAt = %d, the bounds of AudioSeconds', (tickAt) => {
    expect(TopicEvent.safeParse({ ...valid(), tickAt }).success).toBe(true);
  });
});

describe('TopicEvent rejects an invalid Topic event and names the field', () => {
  it.each(['schemaVersion', 'tickAt', 'current', 'new', 'returned', 'ended'])(
    'rejects a Topic event without %s',
    (field) => {
      expectRejected(without(valid(), field), field);
    },
  );

  it.each([
    ['schemaVersion', 2],
    ['tickAt', -0.001],
    ['tickAt', 86_400.001],
    ['tickAt', '73.705'],
    ['current', 'Mieten Berlin'],
    ['returned', null],
    ['ended', 'Neubau'],
    ['new', { tag: 'Neubau', parent: null }],
  ])('rejects %s = %j', (field, value) => {
    expectRejected({ ...valid(), [field]: value }, field);
  });

  it('rejects a tag that is no string inside current, naming current and the index', () => {
    expect(paths({ ...valid(), current: ['Mieten Berlin', 7] })).toContainEqual(['current', 1]);
  });

  it.each([
    ['sessionId', '32a0c0de-0000-4000-8000-000000000001'],
    ['turnId', 't-001'],
    ['window', 'Fenster'],
  ])(
    'rejects the unknown field %s and names it (the envelope names the Session)',
    (field, value) => {
      expectRejected({ ...valid(), [field]: value }, field);
    },
  );

  it('rejects a new entry without parent, naming new, the index and parent', () => {
    const event = { ...valid(), new: [{ tag: 'Neubau' }] };
    expect(TopicEvent.safeParse(event).success).toBe(false);
    expect(paths(event)).toContainEqual(['new', 0, 'parent']);
  });

  it('rejects a new entry with an unknown field, naming new, the index and the field', () => {
    const event = { ...valid(), new: [{ tag: 'Neubau', parent: null, status: 'aktiv' }] };
    expect(TopicEvent.safeParse(event).success).toBe(false);
    expect(paths(event)).toContainEqual(['new', 0, 'status']);
  });

  it('rejects a new entry whose tag is no string, naming new, the index and tag', () => {
    const event = { ...valid(), new: [{ tag: null, parent: null }] };
    expect(paths(event)).toContainEqual(['new', 0, 'tag']);
  });
});

/** A tag of `length` code points, each U+1F5FA (two UTF-16 code units). */
function wide(length: number): string {
  return '\u{1F5FA}'.repeat(length);
}

/** Places one tag into one tag position of a valid event; `new` keeps its other field valid. */
const POSITIONS: readonly [string, (tag: string) => Json, (string | number)[]][] = [
  ['current', (tag) => ({ ...valid(), current: [tag] }), ['current', 0]],
  ['new[].tag', (tag) => ({ ...valid(), new: [{ tag, parent: null }] }), ['new', 0, 'tag']],
  [
    'new[].parent',
    (tag) => ({ ...valid(), new: [{ tag: 'Neubau', parent: tag }] }),
    ['new', 0, 'parent'],
  ],
  ['returned', (tag) => ({ ...valid(), returned: [tag] }), ['returned', 0]],
  ['ended', (tag) => ({ ...valid(), ended: [tag] }), ['ended', 0]],
];

describe('TopicEvent bounds a tag to 1 to 200 characters in code points (O3)', () => {
  const VALID: readonly [string, string][] = [
    ['1 character (one code point outside the BMP)', wide(1)],
    ['200 characters (200 code points outside the BMP, 400 UTF-16 code units)', wide(200)],
    ['200 ASCII characters', 'x'.repeat(200)],
  ];
  const INVALID: readonly [string, string][] = [
    ['empty', ''],
    ['201 ASCII characters', 'x'.repeat(201)],
    ['201 code points outside the BMP', wide(201)],
    [
      '201 code points that form 101 graphemes (a letter with a combining accent, 100 times, plus one)',
      'e\u0301'.repeat(100) + 'x',
    ],
  ];

  describe.each(POSITIONS)('a tag in %s', (_, place, path) => {
    it.each(VALID)('is accepted with %s', (__, tag) => {
      expect(TopicEvent.safeParse(place(tag)).success).toBe(true);
    });

    it.each(INVALID)('is rejected when %s, naming its path', (__, tag) => {
      const event = place(tag);
      expect(TopicEvent.safeParse(event).success).toBe(false);
      expect(paths(event)).toEqual([path]);
    });
  });
});

describe('TopicEvent sets no upper bound on its lists (O3)', () => {
  const MANY = 1000;
  const tags = Array.from({ length: MANY }, (_, index) => `Thema ${String(index + 1)}`);

  it.each(['current', 'returned', 'ended'])('accepts %s with 1000 tags', (field) => {
    expect(TopicEvent.safeParse({ ...valid(), new: [], [field]: tags }).success).toBe(true);
  });

  it('accepts new with 1000 entries', () => {
    const entries = tags.map((tag) => ({ tag, parent: 'Mieten Berlin' }));
    expect(TopicEvent.safeParse({ ...valid(), new: entries }).success).toBe(true);
  });

  it.each(['current', 'new', 'returned', 'ended'])('accepts an empty %s', (field) => {
    expect(TopicEvent.safeParse({ ...valid(), [field]: [] }).success).toBe(true);
  });
});

describe('the generated JSON Schema of the Topic event (ADR 0012)', () => {
  const ARTIFACT = 'json-schema/topic-event.schema.json';

  it('is generated from the export of src/index.ts', () => {
    expect(Object.keys(generateJsonSchemas())).toContain(ARTIFACT);
  });

  it('describes a closed object that requires every field', () => {
    const text = generateJsonSchemas()[ARTIFACT] ?? '{}';
    const schema = JSON.parse(text) as Json;
    expect(schema['additionalProperties']).toBe(false);
    expect([...((schema['required'] as string[] | undefined) ?? [])].sort()).toEqual(
      ['current', 'ended', 'new', 'returned', 'schemaVersion', 'tickAt'].sort(),
    );
  });
});
