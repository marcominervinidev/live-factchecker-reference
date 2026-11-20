// Stage 1, issue #29 (T4), Task 1: the Claim event, the internal contract of one accepted Claim on a Session's
// detection stream (ADR 0005, addendum 2026-10-25: Claim and Topic events per Session on an internal Redis stream,
// schema in packages/contracts). AC11 names what the event carries; the field list follows the ticket's decision 1
// (Marco, 2026-10-27, "alles ja", confirmed again at gate 1 of #29): { schemaVersion, id, turnId, source, speaker,
// speakerLabel, sentence, verbatim, segmentIds, type, checkworthiness, kind, refersTo, start, end, lastWordEnd,
// emittedAt }, `source` one of claim_extractor and resolver, times in seconds of Session audio time.
//
// Public interface these tests define (built in Task 1, skill `new-contract`, its own commit):
//   src/claim-event.ts       export const ClaimEvent   a Zod schema (z.strictObject, schemaVersion: z.literal(1),
//                                                      .check(unknownFieldsNamed))
//                            export type ClaimEvent    its inferred type
//   src/index.ts             exports ClaimEvent (so scripts/generate-json-schema.ts writes json-schema/claim-event.schema.json)
//   src/testing/fixtures.ts  export const claimEventFixture: ClaimEvent   a valid example
//   A rejection names the failing field: the first element of an issue's path is that field.
//
// Field rules and where they come from (where the ticket names no rule: gate 1, owner 2026-11-03, question 8 "Angenommen"):
//   id            `c-` and at least two digits: spec 4.1 "c-<laufende Nummer je Conversation>", AC11 `c-01`, `c-02`
//   turnId        `t-` and at least three digits: the Turn ids of #28 (harness format t-001)
//   speakerLabel  the Session label of the segment contract (`^[A-Z]+$`), never a name (packages/contracts README)
//   segmentIds    at least one Segment id of the segment contract (AC8: `segmentIds` is not empty)
//   type, checkworthiness, kind   the enums of spec 4.1 (evals/src/harness/schemas.py TYPES, CHECKWORTHINESS, KINDS)
//   refersTo      a Claim id or null; set when kind is widerspruch or zustimmung (spec 4.1, AC8)
//   repeatOf      never part of the event (AC11 "without repeatOf"; a repeat gets no event, AC12)
//   start <= end, start <= lastWordEnd <= end (the last word of verbatim lies in its Segments, AC11)
//   emittedAt >= lastWordEnd (AC20: "a time not earlier than the end of its last word")
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ClaimEvent } from './claim-event.ts';
import { claimEventFixture } from './testing/fixtures.ts';

type Json = Record<string, unknown>;

const FIELDS = [
  'schemaVersion',
  'id',
  'turnId',
  'source',
  'speaker',
  'speakerLabel',
  'sentence',
  'verbatim',
  'segmentIds',
  'type',
  'checkworthiness',
  'kind',
  'refersTo',
  'start',
  'end',
  'lastWordEnd',
  'emittedAt',
] as const;

/** A valid Claim event after spec 4.1's example, with the fields AC11 adds. */
function valid(): Json {
  return {
    schemaVersion: 1,
    id: 'c-01',
    turnId: 't-002',
    source: 'claim_extractor',
    speaker: 'Anna Müller',
    speakerLabel: 'A',
    sentence:
      'Anna Müller behauptet, dass die Mieten in Berlin seit 2015 um 40 Prozent gestiegen sind.',
    verbatim: 'also die Mieten hier in Berlin, die sind seit 2015 um vierzig Prozent hoch',
    segmentIds: ['s-0412', 's-0413'],
    type: 'zahl',
    checkworthiness: 'hoch',
    kind: 'tatsache',
    refersTo: null,
    start: 12.5,
    end: 17.25,
    lastWordEnd: 17.25,
    emittedAt: 19.75,
  };
}

function withField(name: string, value: unknown): Json {
  return { ...valid(), [name]: value };
}

function without(name: string): Json {
  const event = valid();
  delete event[name];
  return event;
}

function firstPathElements(value: unknown): unknown[] {
  const result = ClaimEvent.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path[0]);
}

function expectRejected(value: unknown, field: string): void {
  expect(ClaimEvent.safeParse(value).success).toBe(false);
  expect(firstPathElements(value)).toContain(field);
}

describe('ClaimEvent accepts a valid Claim event (AC11)', () => {
  it('parses the spec 4.1 example with the fields of AC11 unchanged', () => {
    const result = ClaimEvent.safeParse(valid());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(valid());
  });

  it('parses the fixture of @lfc/contracts/testing', () => {
    expect(ClaimEvent.safeParse(claimEventFixture).success).toBe(true);
  });

  it('accepts a Claim of the Resolver as source', () => {
    expect(ClaimEvent.safeParse(withField('source', 'resolver')).success).toBe(true);
  });

  it.each([
    ['widerspruch', 'c-01'],
    ['zustimmung', 'c-07'],
  ])('accepts kind %s with refersTo %s', (kind, refersTo) => {
    const event = { ...valid(), id: 'c-08', kind, refersTo };
    expect(ClaimEvent.safeParse(event).success).toBe(true);
  });

  it('accepts a Claim id past c-99 and a Turn id past t-999', () => {
    expect(ClaimEvent.safeParse({ ...valid(), id: 'c-100', turnId: 't-1000' }).success).toBe(true);
  });

  it('accepts the boundaries: lastWordEnd at start, emittedAt at lastWordEnd, start equal to end', () => {
    const event = { ...valid(), start: 3, end: 3, lastWordEnd: 3, emittedAt: 3 };
    expect(ClaimEvent.safeParse(event).success).toBe(true);
  });

  it('survives a JSON round trip unchanged', () => {
    const parsed = ClaimEvent.parse(JSON.parse(JSON.stringify(claimEventFixture)) as unknown);
    expect(parsed).toEqual(claimEventFixture);
  });
});

describe('ClaimEvent rejects a missing or unknown field and names it (strict object)', () => {
  it.each(FIELDS)('rejects a Claim event without %s', (field) => {
    expectRejected(without(field), field);
  });

  it('rejects repeatOf: a repeat never becomes a Claim event (AC11, AC12)', () => {
    expectRejected(withField('repeatOf', null), 'repeatOf');
  });

  it('rejects an unknown field and names it, also when another field is wrong too', () => {
    expectRejected({ ...valid(), note: 'frei', type: 'meinung' }, 'note');
  });

  it('rejects a sessionId: the Session is named by the envelope, not by the Claim (decision 1)', () => {
    expectRejected(withField('sessionId', '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10'), 'sessionId');
  });
});

describe('ClaimEvent rejects one invalid value per rule and names the field', () => {
  it.each([
    ['schemaVersion', 2],
    ['id', 'c-1'],
    ['id', 'k-01'],
    ['id', 'C-01'],
    ['turnId', 't-01'],
    ['turnId', 'turn-001'],
    ['source', 'verifier'],
    ['speaker', ''],
    ['speakerLabel', 'Kallac Haqy'],
    ['speakerLabel', 'a'],
    ['sentence', ''],
    ['verbatim', ''],
    ['segmentIds', []],
    ['segmentIds', ['0412']],
    ['type', 'meinung'],
    ['checkworthiness', 'mittel'],
    ['kind', 'prognose'],
    ['refersTo', 'synt-2026-10-06-a-01'],
    ['refersTo', ''],
    ['start', -0.001],
    ['emittedAt', Number.NaN],
    ['lastWordEnd', '17.25'],
  ])('rejects %s = %j', (field, value) => {
    expectRejected(withField(field, value), field);
  });

  it.each(['widerspruch', 'zustimmung'])(
    'rejects kind %s without refersTo, naming refersTo (spec 4.1, AC8)',
    (kind) => {
      expectRejected({ ...valid(), kind, refersTo: null }, 'refersTo');
    },
  );
});

describe('ClaimEvent keeps its times in order (AC11, AC20)', () => {
  it('rejects end 0.001 s before start, naming end', () => {
    expectRejected({ ...valid(), start: 12.5, end: 12.499, lastWordEnd: 12.499 }, 'end');
  });

  it('rejects lastWordEnd 0.001 s after end, naming lastWordEnd', () => {
    expectRejected({ ...valid(), lastWordEnd: 17.251, emittedAt: 19.75 }, 'lastWordEnd');
  });

  it('rejects lastWordEnd 0.001 s before start, naming lastWordEnd', () => {
    expectRejected({ ...valid(), lastWordEnd: 12.499 }, 'lastWordEnd');
  });

  it('rejects emittedAt 0.001 s before lastWordEnd, naming emittedAt', () => {
    expectRejected({ ...valid(), emittedAt: 17.249 }, 'emittedAt');
  });

  it('accepts every ordered time quadruple and rejects every emittedAt before lastWordEnd (property)', () => {
    const seconds = fc.integer({ min: 0, max: 86_400 * 8 }).map((n) => n / 8);
    fc.assert(
      fc.property(fc.array(seconds, { minLength: 4, maxLength: 4 }), (times) => {
        const [start, lastWordEnd, end, emittedAt] = [...times].sort((a, b) => a - b) as [
          number,
          number,
          number,
          number,
        ];
        const ordered = { ...valid(), start, end, lastWordEnd, emittedAt };
        expect(ClaimEvent.safeParse(ordered).success).toBe(true);
        if (emittedAt > lastWordEnd) {
          const early = { ...ordered, emittedAt: lastWordEnd, lastWordEnd: emittedAt, end: emittedAt };
          expect(firstPathElements(early)).toContain('emittedAt');
        }
      }),
      { seed: 290101, numRuns: 200 },
    );
  });
});
