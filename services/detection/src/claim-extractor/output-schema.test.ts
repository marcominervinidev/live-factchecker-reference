// Stage 1, issue #29 (T4), Task 2: output schema 4.1 of the Claim Extractor and its contract checks
// (docs/spec/erkennung-modellrollen.md 4.1 and 4.2), AC8. Reference: evals/src/harness/schemas.py (CLAIM, CANDIDATE,
// claim_extractor_schema(False), check_claim_contract, check_candidate_contract), util.py (norm_word, norm_tokens,
// find_tokens) and pipeline.py contract_reason. Expected normalisations were computed by that harness.
//
// Public interface these tests define (built in Task 2; pure):
//   src/claim-extractor/output-schema.ts
//     export const ClaimExtractorOutput   a Zod schema of the answer in product mode: strict objects, no `discarded`
//     export type ClaimExtractorOutput, OutputClaim, OutputCandidate   inferred types
//     export const claimExtractorJsonSchema: Readonly<Record<string, unknown>>   the strict JSON Schema the request
//                                                                                carries (AC18 "the output schema")
//     export function normTokens(text: string): string[]   the harness's norm_tokens
//     export function claimExtractorContract(context: {
//       readonly sentSegments: readonly Segment[];        // every Segment sent in this Turn's blocks, this call's too
//       readonly knownClaimIds: ReadonlySet<string>;      // ids of the Claim list and the delta Claims of this call
//     }): (answer: ClaimExtractorOutput) => ContractViolation[]   // ContractViolation of @lfc/providers
//   A violation's path names its element like the harness (`$.claims[<i>].<field>`, `$.candidates[<i>].segmentIds`)
//   and its reason is the harness's category (pipeline.py contract_reason): wortlaut, segment_ids, id_unbekannt,
//   refersTo_fehlt. Segment text: the words of the Segment joined by one space.
//   Wording and Segment ids fit together (owner decision for #48 of 2026-11-03, question 13: "jede genannte
//   Id muss Wörter des Wortlauts enthalten"; spec 4.1, `segmentIds`: "alle Segmente, aus denen die
//   Behauptung gebaut ist"), as schemas.py check_claim_contract_in_segments decides it: "Ein Vorkommen des
//   Wortlauts muss genau die genannten Segmente abdecken: jedes Wort in einem genannten Segment, jedes
//   genannte Segment mit mindestens einem Wort des Wortlauts." A Claim that fails it is one violation at
//   `$.claims[<i>].segmentIds` with reason segment_ids; the harness checks it only when wording and ids
//   pass on their own (`if any(".verbatim" in e or ".segmentIds" in e for e in errors): return errors`).
//   The harness rule is stricter than the owner's sentence for question 13 ("Strenger als der Wortlaut von
//   Frage 13, weil eine Behauptung ein Vorkommen ist"); the cases follow the harness.
//   The expected values of that describe block were printed on 2026-11-06 by Python 3.12.7
//   (`python3 -I` with evals/src on sys.path) calling harness.schemas.check_claim_contract_in_segments
//   with path "$.claims[0]" and harness.pipeline.contract_reason on each error.
import {
  claimExtractorContract,
  claimExtractorJsonSchema,
  ClaimExtractorOutput,
  normTokens,
} from './output-schema.ts';
import { describe, expect, it } from 'vitest';
import { seg } from '../testing/turns.ts';

const HARNESS_SCHEMA = JSON.parse(
  '{"type": "object", "properties": {"claims": {"type": "array", "items": {"type": "object", "properties": {"speaker": {"type": "string"}, "sentence": {"type": "string"}, "verbatim": {"type": "string"}, "segmentIds": {"type": "array", "items": {"type": "string"}}, "type": {"type": "string", "enum": ["zahl", "ereignis", "zitat", "ursache"]}, "checkworthiness": {"type": "string", "enum": ["hoch", "niedrig"]}, "kind": {"type": "string", "enum": ["tatsache", "widerspruch", "zustimmung", "meinung_mit_kern"]}, "refersTo": {"anyOf": [{"type": "string"}, {"type": "null"}]}, "repeatOf": {"anyOf": [{"type": "string"}, {"type": "null"}]}}, "required": ["speaker", "sentence", "verbatim", "segmentIds", "type", "checkworthiness", "kind", "refersTo", "repeatOf"], "additionalProperties": false}}, "candidates": {"type": "array", "items": {"type": "object", "properties": {"speaker": {"type": "string"}, "verbatim": {"type": "string"}, "segmentIds": {"type": "array", "items": {"type": "string"}}, "reason": {"type": "string", "enum": ["bezug_unklar", "kern_unklar", "sprecher_unklar"]}, "note": {"type": "string"}}, "required": ["speaker", "verbatim", "segmentIds", "reason", "note"], "additionalProperties": false}}}, "required": ["claims", "candidates"], "additionalProperties": false}',
) as unknown;

type Json = Record<string, unknown>;

const CLAIM_FIELDS = [
  'speaker',
  'sentence',
  'verbatim',
  'segmentIds',
  'type',
  'checkworthiness',
  'kind',
  'refersTo',
  'repeatOf',
];
const CANDIDATE_FIELDS = ['speaker', 'verbatim', 'segmentIds', 'reason', 'note'];

function claim(over: Json = {}): Json {
  return {
    speaker: 'Anna Müller',
    sentence:
      'Anna Müller behauptet, dass die Mieten in Berlin seit 2015 um 40 Prozent gestiegen sind.',
    verbatim: 'die Mieten hier in Berlin, die sind seit 2015',
    segmentIds: ['s-0412', 's-0413'],
    type: 'zahl',
    checkworthiness: 'hoch',
    kind: 'tatsache',
    refersTo: null,
    repeatOf: null,
    ...over,
  };
}

function candidate(over: Json = {}): Json {
  return {
    speaker: 'Jens Weber',
    verbatim: 'das stimmt so nicht',
    segmentIds: ['s-0413'],
    reason: 'bezug_unklar',
    note: 'Bezug auf eine Zahl außerhalb des Kontexts',
    ...over,
  };
}

/** A copy of `value` that lacks `field`: the "missing field" cases. */
function without(value: Json, field: string): Json {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== field));
}

function answer(claims: Json[] = [claim()], candidates: Json[] = [candidate()]): Json {
  return { claims, candidates };
}

describe('the output schema is schema 4.1 in product mode (AC8)', () => {
  it('is the strict JSON Schema the harness requests (claim_extractor_schema(False))', () => {
    expect(claimExtractorJsonSchema).toEqual(HARNESS_SCHEMA);
  });

  it('accepts the example of spec 4.1 without discarded', () => {
    expect(ClaimExtractorOutput.safeParse(answer()).success).toBe(true);
  });

  it('accepts empty lists and refersTo and repeatOf as strings', () => {
    expect(ClaimExtractorOutput.safeParse(answer([], [])).success).toBe(true);
    expect(
      ClaimExtractorOutput.safeParse(answer([claim({ refersTo: 'c-01', repeatOf: 'c-02' })]))
        .success,
    ).toBe(true);
  });

  it.each([
    ['discarded, the diagnostic field of spec 9', { ...answer(), discarded: [] }],
    ['an unknown field of a Claim', answer([claim({ speakerLabel: 'A' })])],
    ['an unknown field of a Candidate', answer([claim()], [candidate({ id: 'k-01' })])],
    ['type outside its enum', answer([claim({ type: 'meinung' })])],
    ['checkworthiness outside its enum', answer([claim({ checkworthiness: 'mittel' })])],
    ['kind outside its enum', answer([claim({ kind: 'prognose' })])],
    ['reason outside its enum', answer([claim()], [candidate({ reason: 'meinung' })])],
    ['refersTo as a number', answer([claim({ refersTo: 1 })])],
    ['repeatOf as a number', answer([claim({ repeatOf: 2 })])],
    ['segmentIds as a string', answer([claim({ segmentIds: 's-0412' })])],
    ['claims as an object', { claims: {}, candidates: [] }],
    ['candidates missing', { claims: [] }],
  ])('rejects %s', (_, value) => {
    expect(ClaimExtractorOutput.safeParse(value).success).toBe(false);
  });

  it.each(CLAIM_FIELDS)('rejects a Claim without %s', (field) => {
    const c = without(claim(), field);
    expect(ClaimExtractorOutput.safeParse(answer([c])).success).toBe(false);
  });

  it.each(CANDIDATE_FIELDS)('rejects a Candidate without %s', (field) => {
    const c = without(candidate(), field);
    expect(ClaimExtractorOutput.safeParse(answer([claim()], [c])).success).toBe(false);
  });
});

describe('normTokens normalises case and punctuation like the harness (spec 4.2)', () => {
  // [input, norm_tokens(input)] computed by evals/src/harness/util.py on 2026-11-03.
  it.each([
    [
      'Die Mieten sind seit 2015 um 40 Prozent gestiegen.',
      ['die', 'mieten', 'sind', 'seit', '2015', 'um', '40', 'prozent', 'gestiegen'],
    ],
    [
      '„Das stimmt so nicht“, sagt er – wirklich?',
      ['das', 'stimmt', 'so', 'nicht', 'sagt', 'er', 'wirklich'],
    ],
    ["E-Mail; wir's; Ökonomin…", ['email', 'wirs', 'ökonomin']],
    ['Straße STRASSE ẞ', ['straße', 'strasse', 'ß']],
    ['Café café', ['café', 'café']],
    ['½ ² x²', ['½', '²', 'x²']],
    ['  mehrere   Leerzeichen\tund\nZeilen ', ['mehrere', 'leerzeichen', 'und', 'zeilen']],
    ['...', []],
    ['AfD-Vorsitzende 3,5 % (SPD)', ['afdvorsitzende', '35', 'spd']],
  ])('normalises %j', (input, expected) => {
    expect(normTokens(input)).toEqual(expected);
  });
});

describe('claimExtractorContract checks each element against the Turn (AC8)', () => {
  const s412 = seg('s-0412', 'A', 10, 13, 13, 'also die Mieten hier in Berlin,');
  const s413 = seg('s-0413', 'A', 13, 17, 17, 'die sind seit 2015 um vierzig Prozent hoch');
  const contextOnly = seg('s-0300', 'A', 1, 3, 3, 'ein Satz aus dem Kontext-Turn');
  const check = claimExtractorContract({
    sentSegments: [s412, s413],
    knownClaimIds: new Set(['c-01', 'c-02']),
  });
  const violations = (a: Json) => check(ClaimExtractorOutput.parse(a));

  it('accepts a verbatim that is a contiguous passage of the sent Segments, across two Segments', () => {
    expect(violations(answer([claim({ segmentIds: ['s-0412', 's-0413'] })], []))).toEqual([]);
  });

  it('accepts a verbatim that differs only in case and punctuation', () => {
    expect(
      violations(
        answer([claim({ verbatim: 'DIE MIETEN hier in Berlin – die sind seit 2015!' })], []),
      ),
    ).toEqual([]);
  });

  it.each([
    ['words of a context Turn, never sent in this Turn', 'ein Satz aus dem Kontext-Turn'],
    ['a passage with a gap', 'die Mieten in Berlin'],
    ['words in another order', 'Berlin hier die Mieten'],
    ['nothing but punctuation', '…'],
    ['an empty verbatim', ''],
  ])('rejects a verbatim of %s, naming the element and wortlaut', (_, verbatim) => {
    const found = violations(answer([claim(), claim({ verbatim })], []));
    expect(found.map((v) => [v.path, v.reason])).toEqual([['$.claims[1].verbatim', 'wortlaut']]);
  });

  it('rejects empty segmentIds, naming segment_ids', () => {
    expect(
      violations(answer([claim({ segmentIds: [] })], [])).map((v) => [v.path, v.reason]),
    ).toEqual([['$.claims[0].segmentIds', 'segment_ids']]);
  });

  it('rejects a Segment id not sent in this Turn, naming segment_ids', () => {
    expect(
      violations(answer([claim({ segmentIds: ['s-0412', contextOnly.id] })], [])).map((v) => [
        v.path,
        v.reason,
      ]),
    ).toEqual([['$.claims[0].segmentIds', 'segment_ids']]);
  });

  it.each(['refersTo', 'repeatOf'])(
    'rejects %s naming an id the call did not show, as id_unbekannt',
    (field) => {
      expect(
        violations(answer([claim({ [field]: 'c-03' })], [])).map((v) => [v.path, v.reason]),
      ).toEqual([[`$.claims[0].${field}`, 'id_unbekannt']]);
    },
  );

  it('accepts refersTo and repeatOf naming ids of the Claim list or the delta Claims', () => {
    expect(violations(answer([claim({ refersTo: 'c-01', repeatOf: 'c-02' })], []))).toEqual([]);
  });

  it.each(['widerspruch', 'zustimmung'])(
    'rejects kind %s without refersTo, as refersTo_fehlt',
    (kind) => {
      expect(violations(answer([claim({ kind })], [])).map((v) => [v.path, v.reason])).toEqual([
        ['$.claims[0].refersTo', 'refersTo_fehlt'],
      ]);
    },
  );

  it('accepts kind widerspruch with a known refersTo', () => {
    expect(violations(answer([claim({ kind: 'widerspruch', refersTo: 'c-02' })], []))).toEqual([]);
  });

  it('rejects a Candidate Segment id not sent in this Turn, naming the Candidate', () => {
    const found = violations(
      answer([], [candidate(), candidate({ segmentIds: ['s-0412', 's-0300'] })]),
    );
    expect(found.map((v) => [v.path, v.reason])).toEqual([
      ['$.candidates[1].segmentIds', 'segment_ids'],
    ]);
  });

  it('accepts a Candidate whose Segments were sent in this Turn, and one without Segment ids (harness)', () => {
    expect(
      violations(
        answer([], [candidate({ segmentIds: ['s-0413'] }), candidate({ segmentIds: [] })]),
      ),
    ).toEqual([]);
  });

  it('names every violation of one Claim, each with its own path', () => {
    const found = violations(
      answer([claim({ verbatim: 'gar nicht gesagt', segmentIds: [], kind: 'zustimmung' })], []),
    );
    expect(found.map((v) => v.path).sort()).toEqual([
      '$.claims[0].refersTo',
      '$.claims[0].segmentIds',
      '$.claims[0].verbatim',
    ]);
  });
});

describe('claimExtractorContract ties the wording to the named Segments (AC8, #48 rule)', () => {
  const s412 = seg('s-0412', 'A', 10, 13, 13, 'also die Mieten hier in Berlin,');
  const s413 = seg('s-0413', 'A', 13, 17, 17, 'die sind seit 2015 um vierzig Prozent hoch');
  const s414 = seg('s-0414', 'A', 17, 20, 20, 'ja, die Mieten hier in Berlin');
  const check = claimExtractorContract({
    sentSegments: [s412, s413, s414],
    knownClaimIds: new Set(['c-01', 'c-02']),
  });
  const found = (over: Json) =>
    check(ClaimExtractorOutput.parse(answer([claim(over)], []))).map((v) => [v.path, v.reason]);
  const SPANNING = 'die Mieten hier in Berlin, die sind seit 2015';
  const INSIDE_413 = 'seit 2015 um vierzig Prozent';
  const SAID_TWICE = 'die Mieten hier in Berlin';

  it.each([
    ['across both named Segments, as the example of spec 4.1', SPANNING, ['s-0412', 's-0413']],
    ['inside the one named Segment', INSIDE_413, ['s-0413']],
    ['inside the one named Segment, its id named twice', INSIDE_413, ['s-0413', 's-0413']],
    ['said twice, the first occurrence named', SAID_TWICE, ['s-0412']],
    ['said twice, the later occurrence named', SAID_TWICE, ['s-0414']],
  ])('accepts a wording %s', (_, verbatim, segmentIds) => {
    expect(found({ verbatim, segmentIds })).toEqual([]);
  });

  it.each([
    ['too few Segments: the wording ends behind the last named one', SPANNING, ['s-0412']],
    ['only the later Segment: the wording starts before it', SPANNING, ['s-0413']],
    ['one Segment too many', INSIDE_413, ['s-0412', 's-0413']],
    ['both occurrences of a wording said twice at once', SAID_TWICE, ['s-0412', 's-0414']],
    ['a Segment that holds no word of the wording', SAID_TWICE, ['s-0413']],
  ])('rejects %s, naming segment_ids once', (_, verbatim, segmentIds) => {
    expect(found({ verbatim, segmentIds })).toEqual([['$.claims[0].segmentIds', 'segment_ids']]);
  });

  it('names the misfit before the other violations of the same Claim', () => {
    expect(found({ verbatim: SPANNING, segmentIds: ['s-0412'], kind: 'zustimmung' })).toEqual([
      ['$.claims[0].segmentIds', 'segment_ids'],
      ['$.claims[0].refersTo', 'refersTo_fehlt'],
    ]);
  });

  it('does not add the misfit to a wording that was not said', () => {
    expect(found({ verbatim: 'gar nicht gesagt', segmentIds: ['s-0412'] })).toEqual([
      ['$.claims[0].verbatim', 'wortlaut'],
    ]);
  });

  it('does not add the misfit to a Segment id not sent in this Turn', () => {
    expect(found({ verbatim: SAID_TWICE, segmentIds: ['s-0412', 's-0300'] })).toEqual([
      ['$.claims[0].segmentIds', 'segment_ids'],
    ]);
  });
});
