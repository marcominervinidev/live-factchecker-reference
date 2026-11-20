// Claims, repeats, duplicates and Candidates of one Session (docs/spec/erkennung-modellrollen.md 4.1: ids assigned by
// the pipeline; ADR 0002; #29 AC11 to AC14). Port of evals/src/harness/pipeline.py emit_claim, make_card,
// last_word_end and process_claims without the Verifier. Pure, in memory.
import { ClaimEvent, type Segment } from '@lfc/contracts';

import { findTokens, normTokens, type OutputCandidate, type OutputClaim } from './output-schema.ts';
import type { ClaimShort } from './prompt.ts';

export interface CandidateRecord {
  readonly id: string;
  readonly turnId: string;
  readonly speaker: string;
  readonly verbatim: string;
  readonly segmentIds: readonly string[];
  readonly reason: string;
  readonly note: string;
}

export type ClaimOutcome =
  | { readonly kind: 'claim'; readonly event: ClaimEvent }
  | { readonly kind: 'repeat'; readonly repeatOf: string }
  | { readonly kind: 'duplicate' }
  /** The event would break the Claim event contract: no id, no Claim list entry; `fields` names contract fields only. */
  | { readonly kind: 'invalid'; readonly fields: readonly string[] };

export interface ClaimContext {
  readonly turnId: string;
  readonly speakerLabel: string;
  readonly turnSegments: readonly Segment[];
  /** Session clock time at which the call returned. */
  readonly emittedAt: number;
}

export interface SessionClaims {
  accept(claim: OutputClaim, context: ClaimContext): ClaimOutcome;
  candidate(candidate: OutputCandidate, turnId: string): CandidateRecord;
  /** Every Claim with an id, in order of acceptance. */
  readonly claimList: readonly ClaimShort[];
  readonly repeats: number;
  readonly duplicates: number;
}

/** The harness's ids: the prefix and the running number with at least two digits. */
function sessionId(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(2, '0')}`;
}

/**
 * End of the word holding the last token of the first occurrence of the normalised `verbatim` in the Turn's words;
 * when it is not there, the latest end of the named Segments of the Turn (0 if none).
 */
export function lastWordEnd(
  verbatim: string,
  turnSegments: readonly Segment[],
  segmentIds: readonly string[],
): number {
  const words = turnSegments.flatMap((segment) => segment.words);
  const owners = words.flatMap((word) => normTokens(word.w).map(() => word));
  const tokens = words.flatMap((word) => normTokens(word.w));
  const needle = normTokens(verbatim);
  const at = findTokens(tokens, needle);
  const owner = at >= 0 ? owners[at + needle.length - 1] : undefined;
  if (owner !== undefined) return owner.end;
  // A loop here and in `extreme`: a spread call throws on a long list (security review S6 of 2026-11-06).
  const ends = named(turnSegments, segmentIds).map((segment) => segment.end);
  return ends.reduce((high, end) => Math.max(high, end), 0);
}

/** The lowest or highest of `times` by `pick`, NaN for none: the event then breaks its contract. */
function extreme(times: readonly number[], pick: (a: number, b: number) => number): number {
  return times.length > 0 ? times.reduce((a, b) => pick(a, b)) : Number.NaN;
}

function named(turnSegments: readonly Segment[], segmentIds: readonly string[]): Segment[] {
  return turnSegments.filter((segment) => segmentIds.includes(segment.id));
}

function claimEvent(id: string, claim: OutputClaim, context: ClaimContext): unknown {
  const segments = named(context.turnSegments, claim.segmentIds);
  return {
    schemaVersion: 1,
    id,
    turnId: context.turnId,
    source: 'claim_extractor',
    speaker: claim.speaker,
    speakerLabel: context.speakerLabel,
    sentence: claim.sentence,
    verbatim: claim.verbatim,
    segmentIds: [...claim.segmentIds],
    type: claim.type,
    checkworthiness: claim.checkworthiness,
    kind: claim.kind,
    refersTo: claim.refersTo,
    start: extreme(
      segments.map((segment) => segment.start),
      Math.min,
    ),
    end: extreme(
      segments.map((segment) => segment.end),
      Math.max,
    ),
    lastWordEnd: lastWordEnd(claim.verbatim, context.turnSegments, claim.segmentIds),
    emittedAt: context.emittedAt,
  };
}

/** The event checked against the contract before anything changes, so an invalid one never takes an id (AC11). */
function checkedEvent(id: string, claim: OutputClaim, context: ClaimContext): ClaimOutcome {
  const checked = ClaimEvent.safeParse(claimEvent(id, claim, context));
  if (checked.success) return { kind: 'claim', event: checked.data };
  return {
    kind: 'invalid',
    fields: [...new Set(checked.error.issues.map((i) => String(i.path[0])))],
  };
}

/**
 * The Claims of one Session: a Claim with `repeatOf` is a repeat (AC12); one whose Turn label and normalised
 * sentence equal an earlier Claim's is a duplicate (AC13, harness_dedup_exact_sentence); one whose event breaks the
 * Claim event contract (length bounds, time order) is invalid; any other gets the next id.
 */
export function createSessionClaims(): SessionClaims {
  const claimList: ClaimShort[] = [];
  const seen = new Set<string>();
  let candidates = 0;
  let repeats = 0;
  let duplicates = 0;
  return {
    accept(claim, context) {
      if (claim.repeatOf !== null) {
        repeats += 1;
        return { kind: 'repeat', repeatOf: claim.repeatOf };
      }
      const key = JSON.stringify([context.speakerLabel, normTokens(claim.sentence).join(' ')]);
      if (seen.has(key)) {
        duplicates += 1;
        return { kind: 'duplicate' };
      }
      const outcome = checkedEvent(sessionId('c', claimList.length + 1), claim, context);
      if (outcome.kind !== 'claim') return outcome;
      seen.add(key);
      claimList.push({ id: outcome.event.id, speaker: claim.speaker, sentence: claim.sentence });
      return outcome;
    },
    candidate(candidate, turnId) {
      candidates += 1;
      const { speaker, verbatim, segmentIds, reason, note } = candidate;
      const id = sessionId('k', candidates);
      return { id, turnId, speaker, verbatim, segmentIds: [...segmentIds], reason, note };
    },
    claimList,
    get repeats() {
      return repeats;
    },
    get duplicates() {
      return duplicates;
    },
  };
}
