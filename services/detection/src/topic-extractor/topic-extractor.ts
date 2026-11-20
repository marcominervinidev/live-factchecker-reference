// The Topic Extractor behind T3's extractor port (#32; docs/spec/erkennung-modellrollen.md 6): per call it builds the
// request (prompt.ts, AC6), calls the model through callValidated with the configured schema retries (AC10), merges a
// validated result into the Session's tag list (tag-list.ts, AC7, AC8), writes a Topic event to the detection stream
// when something changed (AC9) and logs the call with ids, outcome and figures only (AC11). The skip rule and the
// deferred final analysis are the scheduler's (AC3 to AC5). Port of evals/src/harness/pipeline.py
// call_topic_extractor and process_topics. "New since the last analysis" is Session-wide as in the harness: every
// finalized Segment not yet shown to a call that returned validly and not carried by a call still running; a lost
// call leaves its Segments new for the next one (ticket, Assumptions). State in process memory only.
import type { DetectionEvent, Segment } from '@lfc/contracts';
import { callValidated, type AdapterResult, type ModelAdapter } from '@lfc/providers';
import type { Logger } from '@lfc/service-kit';

import type { DetectionStream } from '../claim-extractor/claim-extractor.ts';
import type { Setting } from '../claim-extractor/prompt.ts';
import type { TopicExtractorConfig } from '../config.ts';
import { TIME_TOLERANCE, type Extractor, type ExtractorCall } from '../turns/tick-scheduler.ts';
import { topicBlocks, TopicExtractorOutput, topicJsonSchema, topicPrefixBlock } from './prompt.ts';
import { applyTopicOutput, seedTagList, type TagList, type TopicTag } from './tag-list.ts';

export interface TopicExtractorOptions {
  readonly sessionId: string;
  readonly config: TopicExtractorConfig;
  readonly setting: Setting;
  /** Label -> Speaker name (text mode and the stage-2a tests). */
  readonly speakerNames: Readonly<Record<string, string>>;
  readonly adapter: ModelAdapter;
  /** Every Segment the Session has accepted, in seam order; a call sees those finalized at its `at`. */
  readonly session: { segments(): readonly Segment[] };
  readonly stream: DetectionStream;
  readonly logger: Logger;
}

export interface TopicExtractor extends Extractor {
  readonly tagList: () => readonly TopicTag[];
  readonly counters: { readonly schemaErrors: number };
}

const NO_USAGE = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };

export function createTopicExtractor(options: TopicExtractorOptions): TopicExtractor {
  const { sessionId, config, adapter, session, logger } = options;
  const prefix = topicPrefixBlock(config.instruction);
  let tagList: TagList = seedTagList(options.setting.topic);
  /** Segment ids shown to a call that returned validly. */
  const shown = new Set<string>();
  /** The Segment ids each running call carries as new. */
  const running = new Set<readonly string[]>();
  let schemaErrors = 0;

  async function call(extractorCall: ExtractorCall): Promise<{ readonly latencySeconds: number }> {
    const { turn, at, final } = extractorCall;
    const finalized = session.segments().filter((s) => s.finalizedAt <= at + TIME_TOLERANCE);
    const busy = new Set([...running].flat());
    const fresh = finalized.filter((s) => !shown.has(s.id) && !busy.has(s.id));
    const carried = fresh.map((s) => s.id);
    running.add(carried);
    // Tokens summed over every attempt of the call (AC11).
    const usage = { ...NO_USAGE };
    const counting: ModelAdapter = {
      name: adapter.name,
      async call(request): Promise<AdapterResult> {
        const result = await adapter.call(request);
        if (result.ok) {
          for (const key of Object.keys(usage) as (keyof typeof usage)[]) {
            usage[key] += result.usage[key];
          }
        }
        return result;
      },
    };
    const outcome = await callValidated(
      counting,
      {
        role: 'topic_extractor',
        sessionId,
        model: config.model,
        thinking: config.thinking,
        blocks: topicBlocks({
          prefix,
          tagList,
          topic: options.setting.topic,
          windowSeconds: config.windowSeconds,
          window: finalized.filter((s) => s.end > at - config.windowSeconds),
          fresh,
          names: options.speakerNames,
        }),
        schema: topicJsonSchema,
        schemaName: 'topic_output',
        maxTokens: config.maxTokens,
        deadline: Date.now() + config.deadlineSeconds * 1000,
        signal: new AbortController().signal,
      },
      { schema: TopicExtractorOutput, retries: config.schemaRetries },
    ).finally(() => running.delete(carried));
    let event: DetectionEvent | undefined;
    let unknownTags = 0;
    if (outcome.kind === 'valid') {
      for (const id of carried) shown.add(id);
      const merged = applyTopicOutput(tagList, outcome.data);
      tagList = merged.tagList;
      unknownTags = merged.unknown;
      if (merged.changed) {
        event = {
          schemaVersion: 2,
          type: 'topic',
          sessionId,
          topic: {
            schemaVersion: 1,
            tickAt: at,
            current: [...merged.tagList.current],
            new: merged.applied.new.map((n) => ({ tag: n.tag, parent: n.parent })),
            returned: [...merged.applied.returned],
            ended: [...merged.applied.ended],
          },
        };
      }
    } else if (outcome.kind === 'schema_failure') {
      schemaErrors += 1;
    }
    // Logged before the stream write, as the Claim Extractor does: a failing write still leaves the call's line.
    logger.log({
      event: 'topic_extractor.call',
      sessionId,
      modelRole: 'topic_extractor',
      turnId: turn.id,
      final,
      outcome: outcome.kind,
      attempts: outcome.attempts,
      durationMs: Math.round(outcome.latencySeconds * 1000),
      inputTokens: usage.input,
      cacheWriteTokens: usage.cacheWrite,
      cacheReadTokens: usage.cacheRead,
      outputTokens: usage.output,
      thinkingTokens: usage.thinking,
      // The adapter port carries no prices; the cost arrives with the real adapter (T7, as model-call.ts says).
      costUsd: 0,
      unknownTags,
    });
    if (event !== undefined) await options.stream.append(event);
    return { latencySeconds: outcome.latencySeconds };
  }

  return {
    call,
    tagList: () => tagList.tags,
    counters: {
      get schemaErrors() {
        return schemaErrors;
      },
    },
  };
}
