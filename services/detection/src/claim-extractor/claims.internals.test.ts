// Stage 1, issue #29 task 2, internals of claims.ts the frozen tests leave open: a passage at the first word of the
// Turn (pipeline.py last_word_end, `pos >= 0`), the duplicate key, which joins the normalised words with a space
// (emit_claim: `" ".join(norm_tokens(claim["sentence"]))`), and Claims whose event would break the Claim event contract
// (packages/contracts/src/claim-event.ts: `speaker` 1 to 200, `sentence` and `verbatim` 1 to 1000 characters,
// `lastWordEnd` within start and end, times finite; AC11: "the event validates against its contract schema").
import { describe, expect, it } from 'vitest';

import { seg } from '../testing/turns.ts';
import { createSessionClaims, lastWordEnd } from './claims.ts';
import type { OutputClaim } from './output-schema.ts';

const S1 = seg('s-0001', 'A', 0, 3, 3, 'eins zwei drei');
const S2 = seg('s-0002', 'A', 3, 6, 6, 'vier fünf sechs');
const CONTEXT = { turnId: 't-001', speakerLabel: 'A', turnSegments: [S1, S2], emittedAt: 7 };

function claim(over: Partial<OutputClaim> = {}): OutputClaim {
  return {
    speaker: 'A',
    sentence: 'A behauptet etwas.',
    verbatim: 'eins',
    segmentIds: ['s-0001'],
    type: 'zahl',
    checkworthiness: 'hoch',
    kind: 'tatsache',
    refersTo: null,
    repeatOf: null,
    ...over,
  };
}

describe('lastWordEnd at the first word of the Turn', () => {
  it('takes the end of that word, not the end of its Segment', () => {
    expect(lastWordEnd('eins', [S1], ['s-0001'])).toBe(1);
  });
});

describe('the duplicate key keeps word boundaries', () => {
  it('accepts sentences whose words differ only in where they split', () => {
    const claims = createSessionClaims();
    expect(claims.accept(claim({ sentence: 'ab c' }), CONTEXT).kind).toBe('claim');
    expect(claims.accept(claim({ sentence: 'a bc' }), CONTEXT).kind).toBe('claim');
    expect(claims.duplicates).toBe(0);
  });
});

describe('a Claim whose event would break the Claim event contract gets no id (fail closed before the Claim list)', () => {
  // With the #48 rule, claimExtractorContract already drops the two passages outside their named Segment, the ids
  // outside the Turn or the contract and the verbatim not in the Turn; these cases test accept(), the last gate,
  // directly. The bounds of speaker and sentence, and of a verbatim over 1000 characters that the Turn holds, are
  // reachable through the contract check.
  it.each([
    [
      'a passage reaching beyond the named Segment',
      claim({ verbatim: 'drei vier' }),
      ['lastWordEnd'],
    ],
    ['a passage in a Segment it does not name', claim({ verbatim: 'fünf' }), ['lastWordEnd']],
    ['named Segments outside the Turn', claim({ segmentIds: ['s-0009'] }), ['end', 'start']],
    ['an empty speaker', claim({ speaker: '' }), ['speaker']],
    ['a speaker of 201 characters', claim({ speaker: 'x'.repeat(201) }), ['speaker']],
    ['a sentence of 1001 characters', claim({ sentence: 'x'.repeat(1001) }), ['sentence']],
    ['an empty sentence', claim({ sentence: '' }), ['sentence']],
    ['a verbatim of 1001 characters', claim({ verbatim: 'x'.repeat(1001) }), ['verbatim']],
    // A violation below the first level (`segmentIds[1]`) is named by its top-level field only.
    [
      'a named Segment id outside the contract',
      claim({ segmentIds: ['s-0001', 'x-1'] }),
      ['segmentIds'],
    ],
  ])('reports %s as invalid, naming contract fields only', (_, input, fields) => {
    const claims = createSessionClaims();
    const outcome = claims.accept(input, CONTEXT);
    expect(outcome.kind).toBe('invalid');
    expect(outcome.kind === 'invalid' ? [...outcome.fields].sort() : []).toEqual(fields);
    expect(claims.claimList).toEqual([]);
  });

  it('reports a wording said twice with its later Segment named, which the #48 rule lets pass', () => {
    // lastWordEnd takes the first occurrence (pipeline.py last_word_end), start the named later Segment.
    const twice = seg('s-0003', 'A', 6, 9, 9, 'eins zwei drei');
    const outcome = createSessionClaims().accept(claim({ segmentIds: ['s-0003'] }), {
      ...CONTEXT,
      turnSegments: [S1, S2, twice],
      emittedAt: 10,
    });
    expect(outcome).toEqual({ kind: 'invalid', fields: ['lastWordEnd'] });
  });

  it('keeps the next id and the sentence free for a later valid Claim', () => {
    const claims = createSessionClaims();
    claims.accept(claim({ speaker: '' }), CONTEXT);
    const outcome = claims.accept(claim(), CONTEXT);
    expect(outcome.kind === 'claim' ? outcome.event.id : outcome.kind).toBe('c-01');
    expect(claims.duplicates).toBe(0);
  });

  it('accepts the bounds themselves: speaker of 200, sentence of 1000 characters', () => {
    const outcome = createSessionClaims().accept(
      claim({ speaker: 'x'.repeat(200), sentence: 'y'.repeat(1000) }),
      CONTEXT,
    );
    expect(outcome.kind).toBe('claim');
  });
});
