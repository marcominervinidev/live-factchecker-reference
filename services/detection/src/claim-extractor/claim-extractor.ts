// The Claim Extractor behind T3's extractor port (#29 task 3; docs/spec/erkennung-modellrollen.md 2 to 4): per call it
// builds the append-only request (prompt.ts), calls the model through callValidated (@lfc/providers), and turns the
// answer into Claim events on the Session's detection stream, Candidate records for the Candidate port, counters and
// log events with ids, reasons and outcomes only (AC15). Port of evals/src/harness/pipeline.py call_claim_extractor,
// emit_claim and process_claims without the Verifier. State in process memory: the Session's Claims (claims.ts) and
// one prompt state per Turn, dropped when the Turn's final analysis has returned.
import type { DetectionEvent, Segment } from '@lfc/contracts';
import { callValidated, type ModelAdapter } from '@lfc/providers';
import type { Logger } from '@lfc/service-kit';

import type { ClaimExtractorConfig } from '../config.ts';
import { TIME_TOLERANCE, type Extractor, type ExtractorCall } from '../turns/tick-scheduler.ts';
import type { Turn } from '../turns/types.ts';
import { createSessionClaims, type CandidateRecord } from './claims.ts';
import {
  ClaimExtractorOutput,
  claimExtractorContract,
  claimExtractorJsonSchema,
  type OutputCandidate,
} from './output-schema.ts';
import {
  attributionBlock,
  createClaimPrompt,
  prefixBlock,
  selectContext,
  type ClaimPrompt,
  type Setting,
} from './prompt.ts';

export interface DetectionStream {
  append(event: DetectionEvent): Promise<void>;
}

/** Where a Session's Candidates go (T5 implements it; until then the Session keeps the records). */
export interface CandidatePort {
  hand(record: CandidateRecord): Promise<void>;
}

export interface ClaimExtractorCounters {
  /** Lost calls (AC10). */
  readonly schemaErrors: number;
  readonly repeats: number;
  readonly duplicates: number;
  /** Elements dropped for a contract violation (AC9), an event that would break its contract or an over-long Candidate. */
  readonly dropped: number;
}

/** For a caller without a stop signal (a test of one extractor): a signal nobody aborts. */
const NEVER_ABORTED = new AbortController().signal;

export interface ClaimExtractorOptions {
  readonly sessionId: string;
  readonly config: ClaimExtractorConfig;
  readonly setting: Setting;
  /** Label -> Speaker name (text mode and the stage-2a tests; ticket Assumptions). */
  readonly speakerNames: Readonly<Record<string, string>>;
  readonly adapter: ModelAdapter;
  /** What the Session has seen: every Turn so far in its latest state, and the labels at the segment seam. */
  readonly session: { turns(): readonly Turn[]; labels(): readonly string[] };
  readonly stream: DetectionStream;
  readonly candidates: CandidatePort;
  readonly logger: Logger;
  /** Aborted when the process stops (session-pipelines.ts); without one a call cannot be cancelled. */
  readonly signal?: AbortSignal | undefined;
}

/** The fixed reason of a dropped element that passed the contract check but cannot become a record (owner A7, A8). */
const INVALID_REASON = 'ungueltig';
/** The bounds of the Claim event contract, counted in code points (owner A7 of 2026-11-06). */
const CANDIDATE_BOUNDS = { speaker: 200, verbatim: 1000, note: 1000 } as const;
const BOUNDED = ['speaker', 'verbatim', 'note'] as const;

/** Code points, as the contract's `max` counts them; no grapheme clusters wanted here. */
const codePoints = (text: string): number => Array.from(text).length;

const tooLong = (candidate: OutputCandidate): boolean =>
  BOUNDED.some((field) => codePoints(candidate[field]) > CANDIDATE_BOUNDS[field]);

/** One Turn: its prompt state and the Segments sent in its blocks, the one list for prompt, contract and Claims. */
interface TurnState {
  readonly prompt: ClaimPrompt;
  readonly sent: Segment[];
}

export function createClaimExtractor(
  options: ClaimExtractorOptions,
): Extractor & { readonly counters: ClaimExtractorCounters } {
  const { sessionId, config, adapter, session, logger } = options;
  const claims = createSessionClaims();
  /**
   * emittedAt per Claim id: a call sees only Claims returned by its start on the Session clock (AC3, AC4), within the
   * harness's tolerance (`cards_until`: `emitted_at <= t + 1e-9`), because emittedAt is a sum (at + latency).
   */
  const emitted = new Map<string, number>();
  const turnStates = new Map<string, TurnState>();
  const prefix = prefixBlock(config.instruction, options.setting);
  let schemaErrors = 0;
  let dropped = 0;

  const visibleAt = (at: number) =>
    claims.claimList.filter((claim) => (emitted.get(claim.id) ?? Infinity) <= at + TIME_TOLERANCE);

  const drop = (turnId: string, reason: string): void => {
    dropped += 1;
    logger.log({ event: 'claim_extractor.dropped', sessionId, turnId, reason });
  };

  function turnState(call: ExtractorCall): TurnState {
    const known = turnStates.get(call.turn.id);
    if (known !== undefined) return known;
    const prompt = createClaimPrompt({
      prefix,
      attribution: attributionBlock(session.labels(), options.speakerNames),
      claims: visibleAt(call.at),
      context: selectContext(session.turns(), call.turn, call.at, config.contextTurns),
      parameters: config,
    });
    const fresh = { prompt, sent: [] };
    turnStates.set(call.turn.id, fresh);
    return fresh;
  }

  async function emit(
    answer: ClaimExtractorOutput,
    call: ExtractorCall,
    state: TurnState,
    emittedAt: number,
  ): Promise<void> {
    const turnId = call.turn.id;
    const context = {
      turnId,
      speakerLabel: call.turn.speaker,
      turnSegments: state.sent,
      emittedAt,
    };
    for (const claim of answer.claims) {
      const outcome = claims.accept(claim, context);
      if (outcome.kind === 'repeat') {
        logger.log({ event: 'claim.repeat', sessionId, turnId, claimId: outcome.repeatOf });
      } else if (outcome.kind === 'duplicate') {
        logger.log({ event: 'claim.duplicate', sessionId, turnId });
      } else if (outcome.kind === 'invalid') {
        drop(turnId, INVALID_REASON);
      } else {
        emitted.set(outcome.event.id, emittedAt);
        // Envelope version 2 since T6 added the Topic event (#32, O1); the Claim event stays at 1.
        await options.stream.append({
          schemaVersion: 2,
          type: 'claim',
          sessionId,
          claim: outcome.event,
        });
      }
    }
    for (const candidate of answer.candidates) {
      if (tooLong(candidate)) {
        drop(turnId, INVALID_REASON);
        continue;
      }
      const record = claims.candidate(candidate, turnId);
      await options.candidates.hand(record);
      const { id: candidateId, reason } = record;
      logger.log({ event: 'candidate.created', sessionId, turnId, candidateId, reason });
    }
  }

  async function call(extractorCall: ExtractorCall): Promise<{ readonly latencySeconds: number }> {
    const { turn, at } = extractorCall;
    const state = turnState(extractorCall);
    state.sent.push(...extractorCall.segments);
    const visible = visibleAt(at);
    const outcome = await callValidated(
      adapter,
      {
        role: 'claim_extractor',
        sessionId,
        model: config.model,
        thinking: config.thinking,
        blocks: state.prompt.next({ ...extractorCall, speaker: turn.speaker }, visible),
        schema: claimExtractorJsonSchema,
        schemaName: 'claim_extractor_output',
        maxTokens: config.maxTokens,
        deadline: Date.now() + config.deadlineSeconds * 1000,
        signal: options.signal ?? NEVER_ABORTED,
      },
      {
        schema: ClaimExtractorOutput,
        contract: claimExtractorContract({
          sentSegments: state.sent,
          knownClaimIds: new Set(visible.map((claim) => claim.id)),
        }),
        elementLists: ['claims', 'candidates'],
        retries: config.schemaRetries,
      },
    );
    const { attempts, kind } = outcome;
    logger.log({
      event: 'claim_extractor.call',
      sessionId,
      modelRole: 'claim_extractor',
      turnId: turn.id,
      attempts,
      outcome: kind,
    });
    if (extractorCall.final) turnStates.delete(turn.id);
    if (outcome.kind !== 'valid') {
      schemaErrors += 1;
    } else {
      for (const element of outcome.dropped) {
        drop(turn.id, element.violations[0]?.reason ?? INVALID_REASON);
      }
      await emit(outcome.data, extractorCall, state, at + outcome.latencySeconds);
    }
    return { latencySeconds: outcome.latencySeconds };
  }

  return {
    call,
    counters: {
      get schemaErrors() {
        return schemaErrors;
      },
      get repeats() {
        return claims.repeats;
      },
      get duplicates() {
        return claims.duplicates;
      },
      get dropped() {
        return dropped;
      },
    },
  };
}
