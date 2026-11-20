// Stage 1, issue #29 (T4), Task 2: Claims, repeats, duplicates and Candidates of a Session (docs/spec/
// erkennung-modellrollen.md 4.1: ids assigned by the pipeline; ADR 0002: dedup within the Turn mandatory), AC11 to
// AC14 without I/O. Reference: evals/src/harness/pipeline.py emit_claim, make_card, last_word_end, process_claims.
//
// Public interface these tests define (built in Task 2; pure, in memory):
//   src/claim-extractor/claims.ts
//     export function lastWordEnd(verbatim: string, turnSegments: readonly Segment[],
//                                 segmentIds: readonly string[]): number
//       // end of the word holding the last token of the first occurrence of the normalised verbatim in the Turn's
//       // words (normTokens of output-schema.ts); if it is not found, the latest end of the named Segments (harness)
//     export interface CandidateRecord { readonly id: string; readonly turnId: string; readonly speaker: string;
//       readonly verbatim: string; readonly segmentIds: readonly string[]; readonly reason: string; readonly note: string }
//     export type ClaimOutcome =
//       | { readonly kind: 'claim'; readonly event: ClaimEvent }         // ClaimEvent of @lfc/contracts
//       | { readonly kind: 'repeat'; readonly repeatOf: string }
//       | { readonly kind: 'duplicate' };
//     export function createSessionClaims(): {
//       accept(claim: OutputClaim, context: { readonly turnId: string; readonly speakerLabel: string;
//              readonly turnSegments: readonly Segment[]; readonly emittedAt: number }): ClaimOutcome;
//       candidate(candidate: OutputCandidate, turnId: string): CandidateRecord;
//       readonly claimList: readonly ClaimShort[];   // every Claim with an id, in order of acceptance (prompt.ts)
//       readonly repeats: number;
//       readonly duplicates: number;
//     }
// Duplicate rule (AC13, ticket Assumptions: kept as the measured arm had it, harness_dedup_exact_sentence): the key is
// the Turn's Speaker label and the normalised sentence (pipeline.py emit_claim: turn.speaker, norm_tokens(sentence)).
import { createSessionClaims, lastWordEnd } from './claims.ts';
import { describe, expect, it } from 'vitest';
import { ClaimEvent } from '@lfc/contracts';
import { seg } from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';

type Json = Record<string, unknown>;

/** A Segment with the given word times (contract-valid: start and end from its words, finalizedAt after end). */
function spoken(
  id: string,
  speaker: string,
  words: readonly (readonly [string, number, number])[],
  finalizedAt: number,
): Segment {
  const first = words[0];
  const last = words.at(-1);
  if (first === undefined || last === undefined) throw new Error('a Segment needs a word');
  return {
    schemaVersion: 1,
    id,
    sessionId: '29a0c0de-0000-4000-8000-000000000031',
    speaker,
    start: first[1],
    end: last[2],
    finalizedAt,
    language: 'de',
    words: words.map(([w, start, end]) => ({ w, start, end })),
  };
}

// golden: synt-2026-10-06-a 01:10-01:55, Segments s-0002 and s-0003 as the harness cuts the recording (word times of
// evals/golden/synt-2026-10-06-a/mitschnitt/deepgram-nova3-v1.jsonl).
const S2 = spoken(
  's-0002',
  'B',
  [
    ['Yugxu', 68.93, 69.33],
    ['as', 69.33, 69.49],
    ['daehov', 69.49, 69.89],
    ['Cioso', 69.89, 70.13],
    ['pavivbn', 70.13, 70.45],
    ['fujg.', 70.45, 70.69],
    ['Tapiw?', 70.69, 71.01],
    ['Rob', 71.01, 71.17],
    ['qutc', 71.17, 71.33],
    ['baoj', 71.33, 71.57],
  ],
  73.705,
);
const S3 = spoken(
  's-0003',
  'B',
  [
    ['rob', 71.82001, 72.060005],
    ['qutc', 72.060005, 72.22],
    ['baoj', 72.22, 72.46001],
    ['2017', 72.46001, 73.26],
    ['os', 73.26, 73.5],
    ['Fiydulvuv.', 73.5, 74.060005],
    ['Xatsuc', 73.98, 74.22],
    ['Loe', 74.22, 74.380005],
    ['keka', 74.380005, 74.62],
    ['keka', 74.62, 75.100006],
    ['Sige', 75.100006, 75.420006],
    ['ig.', 75.420006, 75.58],
    ['Uwgu', 75.79, 76.19],
    ['Lmikyampadez,', 76.19, 76.99],
    ['rob', 76.99, 77.07],
    ['fodoz.', 77.07, 77.31],
  ],
  80.828,
);
const TURN = { turnId: 't-002', speakerLabel: 'B', turnSegments: [S2, S3] };

function claim(over: Json = {}): Json {
  return {
    speaker: 'Hukgl Suubayy',
    sentence: 'Hukgl Suubayy facuajkiz, noxl vee AsQ baoj 2017 os Fiydulvuv ovp.',
    verbatim: 'Rob qutc baoj rob qutc baoj 2017 os Fiydulvuv.',
    segmentIds: ['s-0002', 's-0003'],
    type: 'zahl',
    checkworthiness: 'hoch',
    kind: 'tatsache',
    refersTo: null,
    repeatOf: null,
    ...over,
  };
}

function sentence(n: number): string {
  return `Hukgl Suubayy behauptet Sachverhalt ${n}.`;
}

type Accept = ReturnType<typeof createSessionClaims>['accept'];
const asClaim = (value: Json) => value as unknown as Parameters<Accept>[0];

describe('an accepted Claim without repeatOf becomes one Claim event (AC11)', () => {
  it('gets c-01 and carries the fields of 4.1 without repeatOf, the Turn, its times and the return time', () => {
    const claims = createSessionClaims();
    const outcome = claims.accept(asClaim(claim()), { ...TURN, emittedAt: 81.328 });
    expect(outcome.kind).toBe('claim');
    if (outcome.kind !== 'claim') return;
    expect(outcome.event).toEqual({
      schemaVersion: 1,
      id: 'c-01',
      turnId: 't-002',
      source: 'claim_extractor',
      speaker: 'Hukgl Suubayy',
      speakerLabel: 'B',
      sentence: 'Hukgl Suubayy facuajkiz, noxl vee AsQ baoj 2017 os Fiydulvuv ovp.',
      verbatim: 'Rob qutc baoj rob qutc baoj 2017 os Fiydulvuv.',
      segmentIds: ['s-0002', 's-0003'],
      type: 'zahl',
      checkworthiness: 'hoch',
      kind: 'tatsache',
      refersTo: null,
      start: 68.93,
      end: 77.31,
      lastWordEnd: 74.060005,
      emittedAt: 81.328,
    });
  });

  it('builds an event that validates against the Claim event contract', () => {
    const outcome = createSessionClaims().accept(asClaim(claim()), { ...TURN, emittedAt: 81.328 });
    expect(outcome.kind === 'claim' && ClaimEvent.safeParse(outcome.event).success).toBe(true);
  });

  it('numbers the Claims of the Session c-01, c-02, c-03 in order of acceptance, across Turns', () => {
    const claims = createSessionClaims();
    const ids = [1, 2, 3].map((n) => {
      const outcome = claims.accept(asClaim(claim({ sentence: sentence(n) })), {
        ...TURN,
        turnId: `t-00${n}`,
        emittedAt: 80 + n,
      });
      return outcome.kind === 'claim' ? outcome.event.id : outcome.kind;
    });
    expect(ids).toEqual(['c-01', 'c-02', 'c-03']);
  });

  it('numbers the hundredth Claim c-100 (the harness format c-<number with at least two digits>)', () => {
    const claims = createSessionClaims();
    let last = '';
    for (let n = 1; n <= 100; n += 1) {
      const outcome = claims.accept(asClaim(claim({ sentence: sentence(n) })), {
        ...TURN,
        emittedAt: 81,
      });
      if (outcome.kind === 'claim') last = outcome.event.id;
    }
    expect(last).toBe('c-100');
  });

  it('enters each Claim into the Claim list in short form, oldest first', () => {
    const claims = createSessionClaims();
    claims.accept(asClaim(claim({ sentence: sentence(1) })), { ...TURN, emittedAt: 81 });
    claims.accept(asClaim(claim({ sentence: sentence(2), speaker: 'Kallac Haqy' })), {
      ...TURN,
      speakerLabel: 'A',
      emittedAt: 82,
    });
    expect(claims.claimList).toEqual([
      { id: 'c-01', speaker: 'Hukgl Suubayy', sentence: sentence(1) },
      { id: 'c-02', speaker: 'Kallac Haqy', sentence: sentence(2) },
    ]);
  });

  it('keeps refersTo of a contradiction in the event', () => {
    const claims = createSessionClaims();
    claims.accept(asClaim(claim()), { ...TURN, emittedAt: 81 });
    const outcome = claims.accept(
      asClaim(claim({ sentence: sentence(2), kind: 'widerspruch', refersTo: 'c-01' })),
      {
        ...TURN,
        emittedAt: 82,
      },
    );
    expect(outcome.kind === 'claim' ? outcome.event.refersTo : null).toBe('c-01');
  });
});

describe('lastWordEnd finds the end of the last word of the verbatim (AC11)', () => {
  it('takes the word holding the last token of the passage, across two Segments', () => {
    expect(
      lastWordEnd('Rob qutc baoj rob qutc baoj 2017 os Fiydulvuv.', [S2, S3], ['s-0002', 's-0003']),
    ).toBe(74.060005);
  });

  it('takes the first occurrence of a passage that occurs twice', () => {
    expect(lastWordEnd('keka', [S2, S3], ['s-0003'])).toBe(74.62);
  });

  it('matches regardless of case and punctuation', () => {
    expect(lastWordEnd('TAPIW rob qutc', [S2, S3], ['s-0002'])).toBe(71.33);
  });

  it('falls back to the latest end of the named Segments when the passage is not in the Turn (harness)', () => {
    expect(lastWordEnd('gar nicht gesagt', [S2, S3], ['s-0002'])).toBe(71.57);
    expect(lastWordEnd('gar nicht gesagt', [S2, S3], ['s-0002', 's-0003'])).toBe(77.31);
  });
});

describe('an accepted Claim with repeatOf gets no id and no event (AC12)', () => {
  it('reports the repeat with the referenced id only, counts it and leaves ids and Claim list unchanged', () => {
    const claims = createSessionClaims();
    claims.accept(asClaim(claim()), { ...TURN, emittedAt: 81 });
    const outcome = claims.accept(asClaim(claim({ sentence: sentence(9), repeatOf: 'c-01' })), {
      ...TURN,
      emittedAt: 90,
    });
    expect(outcome).toEqual({ kind: 'repeat', repeatOf: 'c-01' });
    expect(claims.repeats).toBe(1);
    expect(claims.claimList.map((c) => c.id)).toEqual(['c-01']);
    const next = claims.accept(asClaim(claim({ sentence: sentence(10) })), {
      ...TURN,
      emittedAt: 91,
    });
    expect(next.kind === 'claim' ? next.event.id : next.kind).toBe('c-02');
  });
});

describe('an accepted Claim of the same Speaker with the same normalised sentence is a duplicate (AC13)', () => {
  it('gets no id and no event, is counted, and leaves the Claim list unchanged', () => {
    const claims = createSessionClaims();
    claims.accept(asClaim(claim()), { ...TURN, emittedAt: 81 });
    const again = claim({
      sentence: 'HUKGL SUUBAYY facuajkiz: noxl vee AsQ baoj 2017 os Fiydulvuv ovp!',
    });
    const outcome = claims.accept(asClaim(again), { ...TURN, turnId: 't-009', emittedAt: 101 });
    expect(outcome).toEqual({ kind: 'duplicate' });
    expect(claims.duplicates).toBe(1);
    expect(claims.claimList.map((c) => c.id)).toEqual(['c-01']);
  });

  it('accepts the same sentence from another Speaker label as a new Claim', () => {
    const claims = createSessionClaims();
    claims.accept(asClaim(claim()), { ...TURN, emittedAt: 81 });
    const outcome = claims.accept(asClaim(claim()), {
      ...TURN,
      speakerLabel: 'A',
      turnId: 't-003',
      emittedAt: 85,
    });
    expect(outcome.kind === 'claim' ? outcome.event.id : outcome.kind).toBe('c-02');
    expect(claims.duplicates).toBe(0);
  });

  it('accepts a sentence that differs in one word as a new Claim', () => {
    const claims = createSessionClaims();
    claims.accept(asClaim(claim()), { ...TURN, emittedAt: 81 });
    const outcome = claims.accept(
      asClaim(
        claim({ sentence: 'Hukgl Suubayy facuajkiz, noxl vee AsQ baoj 2013 os Fiydulvuv ovp.' }),
      ),
      {
        ...TURN,
        emittedAt: 82,
      },
    );
    expect(outcome.kind).toBe('claim');
  });
});

describe('an accepted Candidate becomes a Candidate record with the next Candidate id (AC14)', () => {
  const cand = (n: number): Json => ({
    speaker: 'Hukgl Suubayy',
    verbatim: `das stimmt so nicht ${n}`,
    segmentIds: ['s-0003'],
    reason: n === 1 ? 'bezug_unklar' : 'kern_unklar',
    note: `Notiz ${n}`,
  });
  type CandidateInput = Parameters<ReturnType<typeof createSessionClaims>['candidate']>[0];

  it('numbers the Candidates of the Session k-01, k-02 across Turns and keeps their fields and Turn id', () => {
    const claims = createSessionClaims();
    const first = claims.candidate(cand(1) as unknown as CandidateInput, 't-002');
    const second = claims.candidate(cand(2) as unknown as CandidateInput, 't-010');
    expect(first).toEqual({ id: 'k-01', turnId: 't-002', ...cand(1) });
    expect(second).toEqual({ id: 'k-02', turnId: 't-010', ...cand(2) });
  });

  it('never gives a Candidate a Claim id or a Claim list entry', () => {
    const claims = createSessionClaims();
    claims.candidate(cand(1) as unknown as CandidateInput, 't-002');
    const outcome = claims.accept(asClaim(claim()), { ...TURN, emittedAt: 81 });
    expect(claims.claimList.map((c) => c.id)).toEqual(['c-01']);
    expect(outcome.kind === 'claim' ? outcome.event.id : outcome.kind).toBe('c-01');
  });
});

describe('Claim times come from the named Segments of the Turn (AC11)', () => {
  it('takes start and end from the Segments the Claim names, not from the whole Turn', () => {
    const later = seg('s-0004', 'B', 77.55, 80, 81, 'und noch mehr');
    const outcome = createSessionClaims().accept(
      asClaim(claim({ verbatim: 'rob qutc baoj 2017 os Fiydulvuv', segmentIds: ['s-0003'] })),
      {
        ...TURN,
        turnSegments: [S2, S3, later],
        emittedAt: 82,
      },
    );
    expect(
      outcome.kind === 'claim'
        ? [outcome.event.start, outcome.event.end, outcome.event.lastWordEnd]
        : [],
    ).toEqual([71.82001, 77.31, 74.060005]);
  });
});
