// Stage 1, issue #29 task 2, internals of output-schema.ts the frozen tests leave open: Python's whitespace in
// norm_tokens, passages at the edges of the sent Segments, and the harness's violation messages (schemas.py
// check_claim_contract, check_candidate_contract). Expected tokens were printed by evals/src/harness/util.py
// norm_tokens and schemas.py on 2026-11-05 (Python 3.12.7, `python3 -I` in evals/src importing `harness`).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { seg } from '../testing/turns.ts';
import {
  claimExtractorContract,
  ClaimExtractorOutput,
  findTokens,
  normTokens,
} from './output-schema.ts';

type Sent = ReturnType<typeof seg>[];

/** A Claim of the answer with the given wording and ids; `over` sets any other field. */
const claimOf = (verbatim: string, segmentIds: string[], over: Record<string, unknown> = {}) => ({
  speaker: 'A',
  sentence: 's',
  verbatim,
  segmentIds,
  type: 'zahl',
  checkworthiness: 'hoch',
  kind: 'tatsache',
  refersTo: null,
  repeatOf: null,
  ...over,
});

/** The violations of one answer, each as [path, message, reason]. */
const violationsOf = (
  sent: Sent,
  claims: unknown[],
  candidates: unknown[] = [],
  knownClaimIds = new Set<string>(),
) =>
  claimExtractorContract({ sentSegments: sent, knownClaimIds })(
    ClaimExtractorOutput.parse({ claims, candidates }),
  ).map((v) => [v.path, v.message, v.reason]);

describe('normTokens splits where Python str.split() does', () => {
  it.each([
    ['a\x1cb\x1dc\x1ed\x1fe\x85f', ['a', 'b', 'c', 'd', 'e', 'f']],
    ['a﻿b c', ['ab', 'c']],
  ])('normalises %j', (input, expected) => {
    expect(normTokens(input)).toEqual(expected);
  });
});

describe('claimExtractorContract at the edges and with the harness messages', () => {
  const sent = [
    seg('s-0001', 'A', 0, 2, 2, 'Die Mieten steigen'),
    seg('s-0002', 'A', 2, 4, 4, 'seit 2015 stark'),
  ];
  const claim = (over: Record<string, unknown>) => claimOf('Die Mieten', ['s-0001'], over);
  const run = (claims: unknown[], candidates: unknown[] = []) =>
    violationsOf(sent, claims, candidates, new Set(['c-01']));

  it('accepts a passage at the start and one at the end of the sent Segments', () => {
    expect(
      run([claim({}), claim({ verbatim: 'seit 2015 stark', segmentIds: ['s-0002'] })]),
    ).toEqual([]);
  });

  // The messages repeat what the model wrote in `segmentIds` and `repeatOf`: callers log `path` and `reason` only.
  it('writes the harness messages', () => {
    const found = run(
      [
        claim({ verbatim: 'nie gesagt', segmentIds: [], kind: 'zustimmung', repeatOf: 'c-09' }),
        claim({ segmentIds: ['s-0300'] }),
      ],
      [{ speaker: 'A', verbatim: 'x', segmentIds: ['s-0301'], reason: 'kern_unklar', note: 'n' }],
    );
    expect(found.map(([path, message]) => `${path}: ${message}`)).toEqual([
      '$.claims[0].verbatim: Wortlaut steht nicht in den Turn-Blöcken',
      '$.claims[0].segmentIds: leer',
      '$.claims[0].repeatOf: c-09 stand weder in der Behauptungsliste noch in den Delta-Behauptungen',
      '$.claims[0].refersTo: Pflicht bei zustimmung',
      '$.claims[1].segmentIds: s-0300 ist kein Segment dieses Turns',
      '$.candidates[0].segmentIds: s-0301 ist kein Segment dieses Turns',
    ]);
  });
});

// #48 rule at edges the frozen block does not have. Expected values printed on 2026-11-06 by Python 3.12.7
// (`python3 -I` in evals/src) calling harness.schemas.check_claim_contract_in_segments with path "$.claims[0]",
// harness.pipeline.contract_reason on each error, and check_candidate_contract for the Candidate.
describe('claimExtractorContract ties the wording to the named Segments at the edges (#48 rule)', () => {
  const sent = [
    seg('s-0001', 'A', 0, 3, 3, 'eins zwei drei'),
    seg('s-0002', 'A', 3, 5, 5, 'vier fünf'),
    seg('s-0003', 'A', 5, 7, 7, 'sechs sieben'),
    seg('s-0004', 'A', 7, 11, 11, 'ja ja ja nein'),
    seg('s-0005', 'A', 11, 13, 13, 'ja ja'),
  ];
  const found = (verbatim: string, segmentIds: string[]) =>
    violationsOf(sent, [claimOf(verbatim, segmentIds)], [], new Set(['c-01']));

  it.each([
    ['across three Segments, all named', 'drei vier fünf sechs', ['s-0001', 's-0002', 's-0003']],
    ['with a named id repeated', 'drei vier fünf sechs', ['s-0001', 's-0002', 's-0003', 's-0002']],
    ['of repeated words inside one Segment', 'ja ja', ['s-0004']],
    ['of the same words in another Segment', 'ja ja', ['s-0005']],
    ['across a boundary after repeated words', 'nein ja ja', ['s-0004', 's-0005']],
  ])('accepts a wording %s', (_, verbatim, segmentIds) => {
    expect(found(verbatim, segmentIds)).toEqual([]);
  });

  it('names the misfit with the harness message, the ids as given and every occurrence', () => {
    expect(found('drei vier fünf sechs', ['s-0003', 's-0001'])).toEqual([
      [
        '$.claims[0].segmentIds',
        'genannte Ids s-0003, s-0001 passen zu keinem Vorkommen des Wortlauts (Vorkommen in s-0001, s-0002, s-0003)',
        'segment_ids',
      ],
    ]);
    expect(found('ja ja', ['s-0004', 's-0005'])).toEqual([
      [
        '$.claims[0].segmentIds',
        'genannte Ids s-0004, s-0005 passen zu keinem Vorkommen des Wortlauts (Vorkommen in s-0004; s-0005)',
        'segment_ids',
      ],
    ]);
  });

  it('keeps empty segmentIds a violation of its own, without the misfit', () => {
    expect(found('vier fünf', [])).toEqual([['$.claims[0].segmentIds', 'leer', 'segment_ids']]);
  });

  it('leaves a Candidate untouched: its Segment ids need not hold its wording', () => {
    const candidate = {
      speaker: 'A',
      verbatim: 'vier fünf',
      segmentIds: ['s-0001'],
      reason: 'kern_unklar',
      note: 'n',
    };
    expect(violationsOf(sent, [], [candidate])).toEqual([]);
  });
});

// Python sorts the ids as text (`sorted(c)`), so "s-10000" comes before "s-9999", although the contract puts it after.
// Expected values printed like the block above.
describe('the #48 rule across the id boundary s-9999 / s-10000', () => {
  const sent = [seg('s-9999', 'A', 0, 2, 2, 'eins ja'), seg('s-10000', 'A', 2, 4, 4, 'zwei ja')];
  const found = (verbatim: string) =>
    violationsOf(sent, [claimOf(verbatim, ['s-9999', 's-10000'])]);

  it('accepts a wording across both, named in seam order', () => {
    expect(found('eins ja zwei')).toEqual([]);
  });

  it('lists the occurrences in the harness order', () => {
    expect(found('ja')).toEqual([
      [
        '$.claims[0].segmentIds',
        'genannte Ids s-9999, s-10000 passen zu keinem Vorkommen des Wortlauts (Vorkommen in s-10000; s-9999)',
        'segment_ids',
      ],
    ]);
  });
});

// The occurrence search at its edges: an occurrence overlapping an earlier one, a Segment without tokens between
// two others, covers that move on at one end only, and the number of covers a misfit lists. Expected values printed
// like the blocks above (the two cases of one end moving on by Python 3.11.2 in the toolbox, `python3 -B -I`),
// except the case marked "own rule".
describe('the #48 rule walks every occurrence and names its covers', () => {
  const run = (sent: Sent, verbatim: string, segmentIds: string[]) =>
    violationsOf(sent, [claimOf(verbatim, segmentIds)]);
  const turnOf = (texts: string[], first = 1) =>
    texts.map((text, i) =>
      seg(`s-${String(first + i).padStart(4, '0')}`, 'A', i, i + 1, i + 1, text),
    );
  const jaSegments = (count: number) => turnOf(Array.from({ length: count }, () => 'ja'));

  it('finds an occurrence that overlaps an earlier one', () => {
    expect(run(turnOf(['x ja ja', 'ja y']), 'ja ja', ['s-0001', 's-0002'])).toEqual([]);
  });

  it('never counts a Segment without tokens as covered', () => {
    const sent = turnOf(['eins', '…', 'zwei']);
    expect(run(sent, 'eins zwei', ['s-0001', 's-0003'])).toEqual([]);
    expect(run(sent, 'eins zwei', ['s-0001', 's-0002', 's-0003'])).toEqual([
      [
        '$.claims[0].segmentIds',
        'genannte Ids s-0001, s-0002, s-0003 passen zu keinem Vorkommen des Wortlauts (Vorkommen in s-0001, s-0003)',
        'segment_ids',
      ],
    ]);
  });

  it.each([
    ['its first', ['a', 'a a', 'b'], '(Vorkommen in s-0001, s-0002; s-0002)'],
    ['its last', ['a a', 'a', 'b'], '(Vorkommen in s-0001; s-0001, s-0002)'],
  ])('lists a cover whose Segment moves on at %s end only', (_, texts, occurrences) => {
    expect(run(turnOf(texts), 'a a', ['s-0003'])).toEqual([
      [
        '$.claims[0].segmentIds',
        `genannte Ids s-0003 passen zu keinem Vorkommen des Wortlauts ${occurrences}`,
        'segment_ids',
      ],
    ]);
  });

  it('lists twenty covers as the harness does', () => {
    const covers = Array.from({ length: 20 }, (_, i) => {
      const id = (n: number) => `s-${String(n).padStart(4, '0')}`;
      return `${id(i + 1)}, ${id(i + 2)}`;
    }).join('; ');
    expect(run(jaSegments(21), 'ja ja', ['s-0001'])).toEqual([
      [
        '$.claims[0].segmentIds',
        `genannte Ids s-0001 passen zu keinem Vorkommen des Wortlauts (Vorkommen in ${covers})`,
        'segment_ids',
      ],
    ]);
  });

  // Own rule, no harness counterpart: beyond twenty covers the message counts them, so its size stays bounded.
  it('counts the covers beyond twenty instead of listing them', () => {
    expect(run(jaSegments(22), 'ja ja', ['s-0001'])).toEqual([
      [
        '$.claims[0].segmentIds',
        'genannte Ids s-0001 passen zu keinem Vorkommen des Wortlauts (Vorkommen in 21 Segmentfolgen)',
        'segment_ids',
      ],
    ]);
  });

  // Own rule as above. Security review S6 of 2026-11-06: 200,000 named ids threw a RangeError (a spread call).
  it('checks a Claim naming 200,000 Segments without throwing', () => {
    const sent = jaSegments(200_000);
    const ids = sent.map((s) => s.id);
    expect(run(sent, 'ja ja', ids)).toEqual([
      [
        '$.claims[0].segmentIds',
        `genannte Ids ${ids.join(', ')} passen zu keinem Vorkommen des Wortlauts (Vorkommen in 199999 Segmentfolgen)`,
        'segment_ids',
      ],
    ]);
  });
});

// find_tokens of evals/src/harness/util.py on needles whose search must fall back inside a partial match
// (Knuth-Morris-Pratt), printed on 2026-11-06 by Python 3.12.7.
describe('findTokens falls back inside a partial match as find_tokens finds it', () => {
  it.each([
    ['a a a b', 'a a b', 1],
    ['a b a b a b c', 'a b a b c', 2],
    ['a a b a a a b', 'a a a b', 3],
    ['x y x x y x y y', 'x y x y y', 3],
    ['a a b a a c a a b a a b', 'a a b a a b', 6],
    ['a b', 'a b c', -1],
    ['c a b', 'a b', 1],
    // A needle whose prefix table needs a fallback while it is built (found by search, value of find_tokens).
    ['a a b a a a b a a a a', 'a a b a a a a', 4],
  ])('searches %j for %j and finds the harness index', (hay, needle, at) => {
    expect(findTokens(hay.split(' '), needle.split(' '))).toBe(at);
  });

  const run = (texts: [string, string][], verbatim: string, segmentIds: string[]) =>
    violationsOf(
      texts.map(([id, text], i) => seg(id, 'A', i, i + 1, i + 1, text)),
      [claimOf(verbatim, segmentIds)],
    );

  it.each([
    [
      [
        ['s-0001', 'a'],
        ['s-0002', 'a'],
        ['s-0003', 'a'],
        ['s-0004', 'a'],
      ] as [string, string][],
      'a a a',
      ['s-0001'],
      'genannte Ids s-0001 passen zu keinem Vorkommen des Wortlauts (Vorkommen in s-0001, s-0002, s-0003; s-0002, s-0003, s-0004)',
    ],
    [
      [
        ['s-0001', 'a a'],
        ['s-0002', 'b a a'],
        ['s-0003', 'b'],
      ] as [string, string][],
      'a a b',
      ['s-0003'],
      'genannte Ids s-0003 passen zu keinem Vorkommen des Wortlauts (Vorkommen in s-0001, s-0002; s-0002, s-0003)',
    ],
    [
      [
        ['s-9999', 'eins ja'],
        ['s-10000', 'zwei ja'],
      ] as [string, string][],
      'eins ja zwei',
      ['s-9999'],
      'genannte Ids s-9999 passen zu keinem Vorkommen des Wortlauts (Vorkommen in s-10000, s-9999)',
    ],
  ])(
    'lists every occurrence of a misfit, overlapping ones included (%#)',
    (texts, verbatim, ids, message) => {
      expect(run(texts, verbatim, ids)).toEqual([
        ['$.claims[0].segmentIds', message, 'segment_ids'],
      ]);
    },
  );
});

// The oracle is the harness ported line by line: util.py find_tokens, schemas.py check_claim_contract_in_segments
// with check_claim_contract's wording and id checks and _check_wording_in_segments, and pipeline.py contract_reason.
// Left out are refersTo, repeatOf and kind (null and tatsache here). Lists compare through `join('\u0000')`, which
// for tokens of normTokens equals Python's list comparison.
const same = (left: readonly string[], right: readonly string[]) =>
  left.join('\u0000') === right.join('\u0000');

function findTokensOfHarness(hay: readonly string[], needle: readonly string[]): number {
  const n = needle.length;
  if (n === 0) return -1;
  for (let i = 0; i < hay.length - n + 1; i += 1) {
    if (same(hay.slice(i, i + n), needle)) return i;
  }
  return -1;
}

function checkWordingInSegmentsOfHarness(
  verb: string[],
  ids: string[],
  segmentTokens: [string, string[]][],
  path: string,
): string[] {
  const flat: string[] = [];
  const owner: string[] = [];
  for (const [sid, toks] of segmentTokens) {
    flat.push(...toks);
    owner.push(...toks.map(() => sid));
  }
  const named = new Set(ids);
  const n = verb.length;
  const covers: Set<string>[] = [];
  for (let i = 0; i < flat.length - n + 1; i += 1) {
    if (same(flat.slice(i, i + n), verb)) covers.push(new Set(owner.slice(i, i + n)));
  }
  if (covers.some((c) => c.size === named.size && [...c].every((id) => named.has(id)))) return [];
  const found = [...new Set(covers.map((c) => [...c].sort().join(', ')))].sort().join('; ');
  return [
    `${path}.segmentIds: genannte Ids ${ids.join(', ')} passen zu keinem Vorkommen des Wortlauts ` +
      `(Vorkommen in ${found})`,
  ];
}

function checkClaimContractInSegmentsOfHarness(
  claim: { verbatim: string; segmentIds: string[] },
  path: string,
  segmentTokens: [string, string[]][],
): string[] {
  const turnTokens = segmentTokens.flatMap(([, toks]) => toks);
  const segmentIds = new Set(segmentTokens.map(([sid]) => sid));
  const errors: string[] = [];
  const verb = normTokens(claim.verbatim);
  if (verb.length === 0 || findTokensOfHarness(turnTokens, verb) < 0) {
    errors.push(`${path}.verbatim: Wortlaut steht nicht in den Turn-Blöcken`);
  }
  const ids = claim.segmentIds;
  if (ids.length === 0) errors.push(`${path}.segmentIds: leer`);
  for (const sid of ids) {
    if (!segmentIds.has(sid))
      errors.push(`${path}.segmentIds: ${sid} ist kein Segment dieses Turns`);
  }
  if (errors.some((e) => e.includes('.verbatim') || e.includes('.segmentIds'))) return errors;
  return [...checkWordingInSegmentsOfHarness(verb, ids, segmentTokens, path), ...errors];
}

function contractReason(error: string): string {
  if (error.includes('.verbatim')) return 'wortlaut';
  if (error.includes('.segmentIds')) return 'segment_ids';
  return 'sonst';
}

describe('findTokens and the #48 rule equal the harness on any Turn', () => {
  const tokens = fc.array(fc.constantFrom('a', 'b'), { maxLength: 14 });

  it('finds the first index find_tokens finds, the needle mostly cut from the hay', () => {
    fc.assert(
      fc.property(
        tokens,
        tokens,
        fc.nat(),
        fc.nat(),
        fc.nat(3),
        (hay, other, start, length, mode) => {
          const from = start % (hay.length + 1);
          const needle = mode > 0 ? hay.slice(from, from + 1 + (length % 8)) : other;
          expect(findTokens(hay, needle)).toBe(findTokensOfHarness(hay, needle));
        },
      ),
      { seed: 294801, numRuns: 3000 },
    );
  });

  // Up to six Segments of up to three words over {a, b, …} („…“ has no token), ids across s-9999 / s-10000. The
  // wording is mostly cut from the Turn, so most runs find it, often more than once; the ids are the Segments of the
  // cut, any run of Segments, the cut's reordered with a duplicate, or with an unknown id or none. A cover's first and
  // last Segment only move forward from one occurrence to the next, so a misfit here has at most 2 x 6 - 1 = 11
  // covers: the limit of 20 hangs on the examples above.
  it('gives the violations of check_claim_contract_in_segments for every occurrence', () => {
    const words = fc.array(fc.constantFrom('a', 'b', '…'), { minLength: 1, maxLength: 3 });
    const turn = fc.array(words, { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(
        turn,
        tokens,
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        (texts, other, cut, length, lo, hi) => {
          const sent = texts.map((words, i) =>
            seg(`s-${String(9996 + i)}`, 'A', i, i + 1, i + 1, words.join(' ')),
          );
          const segmentTokens = sent.map((s): [string, string[]] => [
            s.id,
            normTokens(s.words.map((w) => w.w).join(' ')),
          ]);
          const owners = segmentTokens.flatMap(([id, toks]) => toks.map(() => id));
          const flat = segmentTokens.flatMap(([, toks]) => toks);
          const from = cut % Math.max(flat.length, 1);
          const take = flat.length > 0 && cut % 4 > 0 ? 1 + (length % (flat.length - from)) : 0;
          const verbatim = (take > 0 ? flat.slice(from, from + take) : other).join(' ');
          const cover = [...new Set(owners.slice(from, from + Math.max(take, 1)))];
          const [a, b] = [lo % sent.length, hi % sent.length].sort((x, y) => x - y);
          const segmentIds =
            [
              cover,
              sent.slice(a, (b ?? 0) + 1).map((s) => s.id),
              [...cover].reverse().concat(cover.slice(0, 1)),
              lo % 3 === 0 ? [] : [...cover, 's-0300'],
            ][hi % 4] ?? [];
          const harness = checkClaimContractInSegmentsOfHarness(
            { verbatim, segmentIds },
            '$.claims[0]',
            segmentTokens,
          ).map((error) => {
            const at = error.indexOf(': ');
            return [error.slice(0, at), error.slice(at + 2), contractReason(error)];
          });
          expect(violationsOf(sent, [claimOf(verbatim, segmentIds)])).toEqual(harness);
        },
      ),
      { seed: 294801, numRuns: 3000 },
    );
  });
});
