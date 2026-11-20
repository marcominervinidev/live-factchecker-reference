// The analysis of each Session in this process (#29 task 3): at creation a Session gets its Claim Extractor and its
// Turn building (session-turns.ts); every accepted Segment goes in at the segment seam, the end of the Input lets every
// call return. Claim events go to the Session's detection stream and Candidate records to its Candidate list in Redis
// (store.ts, createSessionRecords), both with the Session's lifetime; the Candidate port is that list until T5. With a
// Topic Extractor configured (#32, O2) each Session also gets its own, whose tag list starts from the Setting and whose
// Topic events go to the same detection stream; without one its lane answers at once and does nothing. Everything here
// is derived state in process memory and is dropped once the Session's lifetime has passed without a Segment, as its
// keys in Redis are. When the process stops, close() aborts the calls in flight through one signal every extractor
// passes to its adapter, waits until they have returned and drops the timers, so nothing writes to the detection
// stream after its connection is closed (packages/service-kit/README.md: background work ends inside `close`).
import type { DetectionEvent, Segment } from '@lfc/contracts';
import type { ModelAdapter } from '@lfc/providers';
import type { Logger } from '@lfc/service-kit';

import { createClaimExtractor } from '../claim-extractor/claim-extractor.ts';
import type { ClaimExtractorConfig, TopicExtractorConfig } from '../config.ts';
import { createTopicExtractor } from '../topic-extractor/topic-extractor.ts';
import type { Extractor } from '../turns/tick-scheduler.ts';
import type { TurnParameters } from '../turns/types.ts';
import { createSessionTurns, type SessionTurns } from './session-turns.ts';
import type { SessionStart } from './session-start.ts';
import type { SessionRecords } from './store.ts';

export interface SessionPipelines {
  /** A new Session, with what it was created with. */
  open(sessionId: string, start: SessionStart): void;
  /** A Segment the store accepted, in seam order; the answer to the Segment never waits for a call. */
  accept(sessionId: string, segment: Segment): void;
  /** The end of the Input; resolves once every call has returned. A second end waits for the same calls. */
  end(sessionId: string): Promise<void>;
}

/** What the process holds: the Sessions' analysis, and its stop. The routes see only SessionPipelines. */
export interface ClosableSessionPipelines extends SessionPipelines {
  /**
   * The stop of the process: aborts every call in flight, resolves once all of them have returned, and starts no
   * final analysis (the Input has not ended). Afterwards no Session is opened and no Segment analysed.
   */
  close(): Promise<void>;
}

export interface SessionPipelinesOptions {
  readonly config: ClaimExtractorConfig;
  readonly parameters: TurnParameters;
  readonly lifetimeSeconds: number;
  readonly adapter: ModelAdapter;
  readonly records: SessionRecords;
  readonly logger: Logger;
  /** The Topic Extractor and its adapter; absent without TOPIC_EXTRACTOR_PROMPT_FILE (#32, O2). */
  readonly topic?: { readonly config: TopicExtractorConfig; readonly adapter: ModelAdapter };
}

/** Without a Topic Extractor its lane returns at once. */
const NO_TOPIC_EXTRACTOR: Extractor = { call: () => Promise.resolve({ latencySeconds: 0 }) };

interface Pipeline {
  readonly turns: SessionTurns;
  readonly labels: Set<string>;
  readonly segments: Segment[];
  ended?: Promise<void>;
  expiry?: ReturnType<typeof setTimeout>;
}

export function createSessionPipelines(options: SessionPipelinesOptions): ClosableSessionPipelines {
  const { config, records, logger } = options;
  const pipelines = new Map<string, Pipeline>();
  /** Aborted by close(); every model call of every Session carries its signal. */
  const stopping = new AbortController();

  /** Drops the Session's state once its lifetime has passed without a Segment (ADR 0009). */
  function touch(sessionId: string, pipeline: Pipeline): void {
    clearTimeout(pipeline.expiry);
    pipeline.expiry = setTimeout(() => {
      pipelines.delete(sessionId);
    }, options.lifetimeSeconds * 1000);
    pipeline.expiry.unref();
  }

  return {
    open(sessionId, start) {
      // A Session created while the process stops is stored, not analysed.
      if (stopping.signal.aborted) return;
      const labels = new Set<string>();
      const segments: Segment[] = [];
      const stream = { append: (event: DetectionEvent) => records.detection(sessionId, event) };
      const claimExtractor = createClaimExtractor({
        sessionId,
        config,
        setting: start.setting,
        speakerNames: start.speakerNames,
        adapter: options.adapter,
        session: { turns: () => turns.seen, labels: () => [...labels] },
        stream,
        candidates: { hand: (record) => records.candidate(sessionId, record) },
        logger,
        signal: stopping.signal,
      });
      const { topic } = options;
      const topicExtractor =
        topic === undefined
          ? NO_TOPIC_EXTRACTOR
          : createTopicExtractor({
              sessionId,
              config: topic.config,
              setting: start.setting,
              speakerNames: start.speakerNames,
              adapter: topic.adapter,
              session: { segments: () => segments },
              stream,
              logger,
              signal: stopping.signal,
            });
      const turns = createSessionTurns({
        sessionId,
        parameters: options.parameters,
        extractors: { claim_extractor: claimExtractor, topic_extractor: topicExtractor },
        logger,
      });
      const pipeline: Pipeline = { turns, labels, segments };
      pipelines.set(sessionId, pipeline);
      touch(sessionId, pipeline);
    },
    accept(sessionId, segment) {
      const pipeline = pipelines.get(sessionId);
      // A Session of another process, one whose Input has ended, or a stopping process: its Segments are stored,
      // not analysed.
      if (pipeline === undefined || pipeline.ended !== undefined || stopping.signal.aborted) return;
      touch(sessionId, pipeline);
      pipeline.labels.add(segment.speaker);
      // Only a Topic Extractor reads the Session's Segments; without one nothing is kept.
      if (options.topic !== undefined) pipeline.segments.push(segment);
      // accept() hands the Segment's Ticks to the scheduler synchronously, so the seam order holds without an await;
      // it catches a Tick's rejection itself (AC22), this catch only guards against a throw of the Turn builder. That
      // is no Tick, so the line has no Turn id; it shares the name tick.failed until the owner names its own event
      // (review W6; a new event name needs the owner, gate 1 question 10).
      pipeline.turns.accept(segment).catch(() => {
        logger.log({ event: 'tick.failed', sessionId });
      });
    },
    end(sessionId) {
      const pipeline = pipelines.get(sessionId);
      if (pipeline === undefined) return Promise.resolve();
      pipeline.ended ??= pipeline.turns.end().catch(() => {
        logger.log({ event: 'tick.failed', sessionId });
      });
      return pipeline.ended;
    },
    async close() {
      stopping.abort();
      const settling = [...pipelines.values()].map((pipeline) => {
        clearTimeout(pipeline.expiry);
        // The end of an Input that is already running is waited for; otherwise only the calls in flight.
        return pipeline.ended ?? pipeline.turns.settle();
      });
      pipelines.clear();
      await Promise.all(settling);
    },
  };
}
