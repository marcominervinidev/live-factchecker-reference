// Output schema 4.1 of the Claim Extractor in product mode (no `discarded`) and its contract checks 4.2
// (docs/spec/erkennung-modellrollen.md; #29 AC8). Port of evals/src/harness/schemas.py (CLAIM, CANDIDATE,
// claim_extractor_schema(False), check_claim_contract_in_segments, check_candidate_contract) and util.py (norm_word,
// norm_tokens, find_tokens); the reasons are pipeline.py contract_reason's categories. Pure.
import { z } from 'zod';

import type { Segment } from '@lfc/contracts';
import type { ContractViolation } from '@lfc/providers';

const TYPES = ['zahl', 'ereignis', 'zitat', 'ursache'] as const;
const CHECKWORTHINESS = ['hoch', 'niedrig'] as const;
const KINDS = ['tatsache', 'widerspruch', 'zustimmung', 'meinung_mit_kern'] as const;
const CANDIDATE_REASONS = ['bezug_unklar', 'kern_unklar', 'sprecher_unklar'] as const;

const OutputClaim = z.strictObject({
  speaker: z.string(),
  sentence: z.string(),
  verbatim: z.string(),
  segmentIds: z.array(z.string()),
  type: z.enum(TYPES),
  checkworthiness: z.enum(CHECKWORTHINESS),
  kind: z.enum(KINDS),
  refersTo: z.string().nullable(),
  repeatOf: z.string().nullable(),
});

const OutputCandidate = z.strictObject({
  speaker: z.string(),
  verbatim: z.string(),
  segmentIds: z.array(z.string()),
  reason: z.enum(CANDIDATE_REASONS),
  note: z.string(),
});

export const ClaimExtractorOutput = z.strictObject({
  claims: z.array(OutputClaim),
  candidates: z.array(OutputCandidate),
});

export type OutputClaim = z.infer<typeof OutputClaim>;
export type OutputCandidate = z.infer<typeof OutputCandidate>;
export type ClaimExtractorOutput = z.infer<typeof ClaimExtractorOutput>;

// The JSON Schema as the harness writes it (null through anyOf); Zod's generator writes `type: [..., "null"]`.
const STRING = { type: 'string' };
const NULLABLE_STRING = { anyOf: [STRING, { type: 'null' }] };
const STRINGS = { type: 'array', items: STRING };
const oneOf = (values: readonly string[]) => ({ type: 'string', enum: [...values] });

function strictJson(properties: Readonly<Record<string, unknown>>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export const claimExtractorJsonSchema: Readonly<Record<string, unknown>> = strictJson({
  claims: {
    type: 'array',
    items: strictJson({
      speaker: STRING,
      sentence: STRING,
      verbatim: STRING,
      segmentIds: STRINGS,
      type: oneOf(TYPES),
      checkworthiness: oneOf(CHECKWORTHINESS),
      kind: oneOf(KINDS),
      refersTo: NULLABLE_STRING,
      repeatOf: NULLABLE_STRING,
    }),
  },
  candidates: {
    type: 'array',
    items: strictJson({
      speaker: STRING,
      verbatim: STRING,
      segmentIds: STRINGS,
      reason: oneOf(CANDIDATE_REASONS),
      note: STRING,
    }),
  },
});

/** Python's str.isspace() holds these beyond JS's `\s`; `\s` holds U+FEFF, which Python does not split on. */
const PYTHON_ONLY_SPACES = new Set(['\x1c', '\x1d', '\x1e', '\x1f', '\x85']);
/** Everything but Python's str.isalnum(): letters and numbers. */
const NOT_ALPHANUMERIC = /[^\p{L}\p{N}]/gu;

/** Python's text.split(): the words between whitespace, none empty. */
export function splitWords(text: string): string[] {
  const spaced = Array.from(text, (char) => (PYTHON_ONLY_SPACES.has(char) ? ' ' : char)).join('');
  return spaced.split(/[^\S\ufeff]/u).filter((word) => word !== '');
}

/** norm_tokens: per word NFC, lower case, only letters and digits; empty words dropped. */
export function normTokens(text: string): string[] {
  return splitWords(text)
    .map((word) => word.normalize('NFC').toLowerCase().replace(NOT_ALPHANUMERIC, ''))
    .filter((word) => word !== '');
}

/** For each prefix of `needle`, the length of its longest proper prefix that is also its suffix (Knuth-Morris-Pratt). */
function prefixTable(needle: readonly string[]): number[] {
  const table = [0];
  let k = 0;
  for (const word of needle.slice(1)) {
    while (k > 0 && word !== needle[k]) k = table[k - 1] ?? 0;
    if (word === needle[k]) k += 1;
    table.push(k);
  }
  return table;
}

/** Where each occurrence of `needle` in `hay` starts, ascending, none for an empty one; linear (Knuth-Morris-Pratt). */
function* matches(hay: readonly string[], needle: readonly string[]): Generator<number> {
  if (needle.length === 0) return;
  const table = prefixTable(needle);
  let k = 0;
  let i = -1;
  for (const word of hay) {
    i += 1;
    while (k > 0 && word !== needle[k]) k = table[k - 1] ?? 0;
    if (word === needle[k]) k += 1;
    if (k === needle.length) {
      yield i - k + 1;
      k = table[k - 1] ?? 0;
    }
  }
}

/** find_tokens: index of the first occurrence of `needle` in `hay`, -1 if none or `needle` is empty. */
export function findTokens(hay: readonly string[], needle: readonly string[]): number {
  for (const at of matches(hay, needle)) return at;
  return -1;
}

/** A Segment's text: its words joined by one space. */
export function segmentText(segment: Segment): string {
  return segment.words.map((word) => word.w).join(' ');
}

interface SentTurn {
  readonly tokens: readonly string[];
  /** The Segments with at least one token, in seam order, and the position there of each token's Segment. */
  readonly holders: readonly string[];
  readonly ranks: readonly number[];
  readonly rankOf: ReadonlyMap<string, number>;
  readonly segmentIds: ReadonlySet<string>;
  readonly knownClaimIds: ReadonlySet<string>;
}

function violation(path: string, message: string, reason: string): ContractViolation {
  return { path, message, reason };
}

function unsentSegments(path: string, ids: readonly string[], turn: SentTurn): ContractViolation[] {
  return ids
    .filter((id) => !turn.segmentIds.has(id))
    .map((id) =>
      violation(`${path}.segmentIds`, `${id} ist kein Segment dieses Turns`, 'segment_ids'),
    );
}

/**
 * Covers listed by name in a misfit's message; more are counted. This bounds the covers, not the message: a cover
 * lists as many ids as the wording has words, so at most 20 x words x id length (reviews of 2026-11-06: 218,446
 * characters for 1,500 words, 570,085 with ids of 15 digits).
 */
const LISTED_COVERS = 20;

/**
 * A cover as one number, from the ranks of its first and last Segment with tokens: `first x Segments + last`. An
 * occurrence's words are contiguous, so it covers the Segments with tokens from the one of its first to the one of
 * its last word.
 */
function coverAt(at: number, length: number, turn: SentTurn): number {
  return (turn.ranks[at] ?? 0) * turn.holders.length + (turn.ranks[at + length - 1] ?? 0);
}

/** The cover the named ids form when they are consecutive Segments with tokens, else none. */
function namedCover(ids: readonly string[], turn: SentTurn): number | undefined {
  const unique = new Set(ids);
  const ranks = [...unique].map((id) => turn.rankOf.get(id) ?? Number.NaN);
  const first = ranks.reduce((low, rank) => Math.min(low, rank), Infinity);
  const last = ranks.reduce((high, rank) => Math.max(high, rank), -Infinity);
  // Distinct ids have distinct ranks, so a range as wide as their number is consecutive; an id without tokens is NaN.
  return last - first + 1 === unique.size ? first * turn.holders.length + last : undefined;
}

/** The ids of a cover as the harness writes them: sorted as text, joined by a comma. */
function coverText(cover: number, turn: SentTurn): string {
  return turn.holders
    .slice(Math.floor(cover / turn.holders.length), (cover % turn.holders.length) + 1)
    .sort()
    .join(', ');
}

interface Covers {
  readonly count: number;
  readonly listed: readonly number[];
}

/**
 * The covers of the wording's occurrences, none when one of them is the `wanted` cover. Occurrences come ascending,
 * so equal covers come one after another: each is counted once, the first 20 are kept for the message.
 */
function coversOf(needle: readonly string[], turn: SentTurn, wanted?: number): Covers | undefined {
  const listed: number[] = [];
  let count = 0;
  let previous = -1;
  for (const at of matches(turn.tokens, needle)) {
    const cover = coverAt(at, needle.length, turn);
    if (cover === wanted) return undefined;
    if (cover === previous) continue;
    previous = cover;
    count += 1;
    if (count <= LISTED_COVERS) listed.push(cover);
  }
  return { count, listed };
}

function misfit(
  path: string,
  claim: OutputClaim,
  covers: Covers,
  turn: SentTurn,
): ContractViolation {
  const where =
    covers.count > covers.listed.length
      ? `${String(covers.count)} Segmentfolgen`
      : covers.listed
          .map((cover) => coverText(cover, turn))
          .sort()
          .join('; ');
  const message = `genannte Ids ${claim.segmentIds.join(', ')} passen zu keinem Vorkommen des Wortlauts (Vorkommen in ${where})`;
  return violation(`${path}.segmentIds`, message, 'segment_ids');
}

/**
 * check_claim_contract_in_segments with one search of the wording: when the ids pass on their own, the #48 rule
 * (schemas.py _check_wording_in_segments) wants one occurrence to cover exactly the named Segments, every word in a
 * named Segment and every named Segment with a word of it; else the search stops at the first occurrence.
 */
function wordingViolations(path: string, claim: OutputClaim, turn: SentTurn): ContractViolation[] {
  const empty =
    claim.segmentIds.length === 0 ? [violation(`${path}.segmentIds`, 'leer', 'segment_ids')] : [];
  const ids = [...empty, ...unsentSegments(path, claim.segmentIds, turn)];
  const needle = normTokens(claim.verbatim);
  const wording = [
    violation(`${path}.verbatim`, 'Wortlaut steht nicht in den Turn-Blöcken', 'wortlaut'),
  ];
  if (ids.length > 0) return findTokens(turn.tokens, needle) < 0 ? [...wording, ...ids] : ids;
  const covers = coversOf(needle, turn, namedCover(claim.segmentIds, turn));
  if (covers === undefined) return [];
  return covers.count === 0 ? wording : [misfit(path, claim, covers, turn)];
}

/** check_claim_contract_in_segments: wording and ids, the misfit only when they pass, then the references. */
function claimViolations(path: string, claim: OutputClaim, turn: SentTurn): ContractViolation[] {
  return [...wordingViolations(path, claim, turn), ...referenceViolations(path, claim, turn)];
}

function referenceViolations(
  path: string,
  claim: OutputClaim,
  turn: SentTurn,
): ContractViolation[] {
  const unknown = (['refersTo', 'repeatOf'] as const).flatMap((field) => {
    const id = claim[field];
    return id === null || turn.knownClaimIds.has(id)
      ? []
      : [
          violation(
            `${path}.${field}`,
            `${id} stand weder in der Behauptungsliste noch in den Delta-Behauptungen`,
            'id_unbekannt',
          ),
        ];
  });
  const answers = claim.kind === 'widerspruch' || claim.kind === 'zustimmung';
  const missing =
    answers && !claim.refersTo
      ? [violation(`${path}.refersTo`, `Pflicht bei ${claim.kind}`, 'refersTo_fehlt')]
      : [];
  return [...unknown, ...missing];
}

/**
 * The contract check `callValidated` runs on a schema-valid answer: one violation per broken rule, its path naming
 * the element, so a violation drops only that Claim or Candidate (gate 1 of #29, question 1).
 */
export function claimExtractorContract(context: {
  readonly sentSegments: readonly Segment[];
  readonly knownClaimIds: ReadonlySet<string>;
}): (answer: ClaimExtractorOutput) => ContractViolation[] {
  const sent = context.sentSegments
    .map((segment) => ({ id: segment.id, tokens: normTokens(segmentText(segment)) }))
    .filter((segment) => segment.tokens.length > 0);
  const turn: SentTurn = {
    tokens: sent.flatMap((segment) => segment.tokens),
    holders: sent.map((segment) => segment.id),
    ranks: sent.flatMap((segment, rank) => segment.tokens.map(() => rank)),
    rankOf: new Map(sent.map((segment, rank) => [segment.id, rank])),
    segmentIds: new Set(context.sentSegments.map((segment) => segment.id)),
    knownClaimIds: context.knownClaimIds,
  };
  return (answer) => [
    ...answer.claims.flatMap((claim, i) => claimViolations(`$.claims[${i}]`, claim, turn)),
    ...answer.candidates.flatMap((candidate, i) =>
      unsentSegments(`$.candidates[${i}]`, candidate.segmentIds, turn),
    ),
  ];
}
