// Stage 1, issue #32 (T6), Task 1: the Topic Extractor behind T3's extractor port (src/turns/tick-scheduler.ts
// `Extractor`): per call it builds the request (AC6), calls the model through callValidated of @lfc/providers with one
// schema retry (AC10), merges a validated result into the tag list (AC7, AC8), writes a Topic event to the detection
// stream when something changed (AC9) and logs the call (AC11). Mocks only at the boundaries: a scripted model adapter
// (the LLM) and a recording detection stream; the logger is the real one of @lfc/service-kit with its closed field
// set, writing into an array.
//
// Exact strings were computed by the harness (evals/src/harness/prompt.py prefix_block, render_segments,
// assign_breakpoints; pipeline.py call_topic_extractor; schemas.py TOPIC) with Python 3.12.3 on 2026-11-17.
// The window shows each Segment's Speaker as delivered at the segment seam: the name of the text-mode mapping when the
// Session has one for the label, else the label (ticket, Assumptions).
//
// Public interface these tests define (proposal of the test designer for gate 1, names marked (P)):
//   src/topic-extractor/topic-extractor.ts
//     export interface TopicExtractorConfig {                   // config.ts (config.topic-extractor.test.ts)
//       instruction: string; model: string; thinking: 'off' | 'low'; maxTokens: number; deadlineSeconds: number;
//       windowSeconds: number; schemaRetries: number }
//     export function createTopicExtractor(options: {
//       readonly sessionId: string;
//       readonly config: TopicExtractorConfig;
//       readonly setting: Setting;                              // src/claim-extractor/prompt.ts (T4)
//       readonly speakerNames: Readonly<Record<string, string>>;   // label -> name (text mode only)
//       readonly adapter: ModelAdapter;                         // @lfc/providers
//       readonly session: { segments(): readonly Segment[] };   // (P) every Segment the Session has accepted, in seam
//                                                               //     order; a call sees those finalized at its `at`
//       readonly stream: { append(event: DetectionEvent): Promise<void> };   // the detection stream of T4
//       readonly logger: Logger;
//     }): Extractor & { readonly tagList: () => readonly TopicTag[];      // (P) tag-list.ts
//                       readonly counters: { readonly schemaErrors: number } }   // (P)
//   The request: role topic_extractor, the Session id, model, thinking and maxTokens of the configuration, the output
//   schema of spec 6 (the harness's TOPIC) named topic_output (the harness's name), deadline now + deadlineSeconds;
//   blocks in the harness's kinds 'prefix' (system), 'context' (the tag list), 'window', 'new'.
//   A call resolves with the latency callValidated reports (the replay clock); the Topic event's tickAt is the call's
//   `at`, for every call, a deferred final analysis included (the port of #28 gives no other time).
//   "New since the last analysis" is Session-wide, as in the harness (pipeline.py call_topic_extractor:
//   `new = [x for x in fin if x.id not in self.topic_shown and x.id not in busy]`): every finalized Segment of the
//   Session not yet shown to a call that returned validly and not carried by a call still running.
//   Log event (P) topic_extractor.call, one per call: sessionId, modelRole topic_extractor, turnId, final (a boolean,
//   as ExtractorCall.final; a new logger field), outcome (valid, schema_failure, adapter_error, timeout, fatal),
//   attempts, durationMs, the five token fields summed over every attempt of the call and costUsd of T1b
//   (packages/service-kit/src/model-call.ts), unknownTags (P, AC8).
// Settled by the test designer under P1 in round 2 (2026-11-17): Session-wide "new", `final` boolean, tokens summed
// over the attempts, tickAt = at; see the report, section "Runde 2". Round 3 (2026-11-18, after the owner's O3, "Tag 1
// bis 200 Zeichen"): an answer with a tag the Topic event cannot carry (empty, or more than 200 code points) violates
// the schema (AC10) and is repeated like any other violation; the schema sent to the model stays the harness's TOPIC.
import { createTopicExtractor } from './topic-extractor.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetectionEvent } from '@lfc/contracts';
import { createLogger } from '@lfc/service-kit';
import { seg } from '../testing/turns.ts';
import type { AdapterResult, ModelAdapter, ModelRequest } from '@lfc/providers';
import type { Segment } from '@lfc/contracts';
import type { ExtractorCall } from '../turns/tick-scheduler.ts';
import type { Turn } from '../turns/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const REPO_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'topic_extractor.de.txt');

const SESSION = '32a0c0de-0000-4000-8000-000000000011';
const INSTRUCTION = '\n  Du bist der Topic-Extraktor eines Live-Faktenchecks (Testanweisung).  \n';
const TOPIC = 'Mieten Berlin';
const CONFIG = {
  instruction: INSTRUCTION,
  model: 'claude-haiku-5-5',
  thinking: 'off' as 'off' | 'low',
  maxTokens: 1024,
  deadlineSeconds: 15,
  windowSeconds: 60,
  schemaRetries: 1,
};
const SETTING = {
  mode: 'broadcast' as const,
  speakers: [{ name: 'Anna Müller', role: 'moderator' as const, public: true }],
  topic: TOPIC,
};
const NAMES = { A: 'Anna Müller' };

/** schemas.py TOPIC, as json.loads of the harness's json.dumps. */
const TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    current: { type: 'array', items: { type: 'string' } },
    new: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: { type: 'string' },
          parent: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['tag', 'parent'],
        additionalProperties: false,
      },
    },
    returned: { type: 'array', items: { type: 'string' } },
    ended: { type: 'array', items: { type: 'string' } },
  },
  required: ['current', 'new', 'returned', 'ended'],
  additionalProperties: false,
};
/** prompt.py prefix_block(instruction, TOPIC, None): json.dumps(TOPIC, ensure_ascii=False, sort_keys=True). */
const SCHEMA_TEXT =
  '{"additionalProperties": false, "properties": {"current": {"items": {"type": "string"}, "type": "array"}, ' +
  '"ended": {"items": {"type": "string"}, "type": "array"}, "new": {"items": {"additionalProperties": false, ' +
  '"properties": {"parent": {"anyOf": [{"type": "string"}, {"type": "null"}]}, "tag": {"type": "string"}}, ' +
  '"required": ["tag", "parent"], "type": "object"}, "type": "array"}, "returned": {"items": {"type": "string"}, ' +
  '"type": "array"}}, "required": ["current", "new", "returned", "ended"], "type": "object"}';

const A1 = seg('s-0001', 'A', 10, 14, 14.5, 'Die Mieten in Berlin steigen seit Jahren');
const B1 = seg('s-0002', 'B', 15, 19, 19.5, 'Die Mietpreisbremse wirkt nicht');
const B2 = seg('s-0003', 'B', 19.5, 24, 24.5, 'Wir brauchen mehr Neubau');
const LINE_A1 = '[10.00–14.00] Anna Müller: Die Mieten in Berlin steigen seit Jahren';
const LINE_B1 = '[15.00–19.00] B: Die Mietpreisbremse wirkt nicht';
const LINE_B2 = '[19.50–24.00] B: Wir brauchen mehr Neubau';
const TURN_A: Turn = { id: 't-001', speaker: 'A', interjection: false, segments: [A1] };
const TURN_B: Turn = { id: 't-002', speaker: 'B', interjection: false, segments: [B1, B2] };
const CONTENT = [
  'Mieten',
  'Berlin',
  'steigen',
  'Jahren',
  'Mietpreisbremse',
  'wirkt',
  'brauchen',
  'Neubau',
  'Anna',
  'Müller',
];

const USAGE = { input: 100, cacheWrite: 30, cacheRead: 40, output: 20, thinking: 5 };

function ok(answer: unknown, latencySeconds = 0.5): AdapterResult {
  return {
    ok: true,
    text: typeof answer === 'string' ? answer : JSON.stringify(answer),
    usage: USAGE,
    latencySeconds,
    model: 'claude-haiku-5-5',
    adapter: 'scripted',
  };
}

function failed(kind: 'fatal' | 'retryable' | 'timeout'): AdapterResult {
  return {
    ok: false,
    error: { kind, message: `scripted ${kind}` },
    latencySeconds: 0.25,
    model: 'claude-haiku-5-5',
    adapter: 'scripted',
  };
}

interface Out {
  current?: string[];
  new?: { tag: string; parent: string | null }[];
  returned?: string[];
  ended?: string[];
}

const out = (o: Out = {}) => ({ current: [], new: [], returned: [], ended: [], ...o });
const NOTHING = out({ current: [TOPIC] });

function setup(
  script: AdapterResult[],
  options: {
    readonly segments?: Segment[];
    readonly setting?: typeof SETTING | { mode: 'broadcast' };
    readonly config?: Partial<typeof CONFIG>;
    readonly adapter?: ModelAdapter;
  } = {},
) {
  const requests: ModelRequest[] = [];
  const adapter: ModelAdapter = options.adapter ?? {
    name: 'scripted',
    call(request) {
      requests.push(request);
      return Promise.resolve(script[requests.length - 1] ?? ok(NOTHING));
    },
  };
  const segments: Segment[] = options.segments ?? [A1, B1, B2];
  const events: unknown[] = [];
  const lines: string[] = [];
  const extractor = createTopicExtractor({
    sessionId: SESSION,
    config: { ...CONFIG, ...options.config },
    setting: options.setting ?? SETTING,
    speakerNames: NAMES,
    adapter,
    session: { segments: () => segments },
    stream: {
      append(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  const logged = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  const calls = () => logged().filter((e) => e['event'] === 'topic_extractor.call');
  return { extractor, requests, events, lines, logged, calls, segments };
}

function call(turn: Turn, segments: readonly Segment[], at: number, final = false): ExtractorCall {
  return { turn, segments, final, at };
}

const textOf = (request: ModelRequest | undefined, kind: string) =>
  (request?.blocks ?? []).find((b) => b.kind === kind)?.text;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-17T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the tag list starts from the Setting (AC1)', () => {
  it('holds exactly the Topic of the Setting, active and without parent, before the first Tick', () => {
    const { extractor, requests } = setup([]);
    expect(extractor.tagList()).toEqual([{ tag: TOPIC, status: 'active', parent: null }]);
    expect(requests).toHaveLength(0);
  });

  it('is empty when the Setting names no Topic', () => {
    const { extractor } = setup([], { setting: { mode: 'broadcast' } });
    expect(extractor.tagList()).toEqual([]);
  });

  it('writes no Topic event for a first result that only confirms the Topic of the Setting', async () => {
    const { extractor, events } = setup([
      ok(out({ current: [TOPIC], new: [{ tag: TOPIC, parent: null }] })),
    ]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(events).toHaveLength(0);
  });

  it('shows the seeded Topic in the tag list block of the first request', async () => {
    const { extractor, requests } = setup([ok(NOTHING)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(textOf(requests[0], 'context')).toBe('Tag-Liste:\n- Mieten Berlin (aktiv)');
  });

  it('shows the harness note for an empty tag list when the Setting names no Topic', async () => {
    const { extractor, requests } = setup([ok(out())], { setting: { mode: 'broadcast' } });
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(textOf(requests[0], 'context')).toBe(
      'Tag-Liste:\n(leer; Anfangs-Topic aus dem Setting: )',
    );
  });
});

describe('the request of a Topic Extractor call (AC2, AC6)', () => {
  it('passes role, Session id, model, thinking, output schema, max tokens and a 15 s deadline', async () => {
    const { extractor, requests } = setup([ok(NOTHING)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      role: 'topic_extractor',
      sessionId: SESSION,
      model: 'claude-haiku-5-5',
      thinking: 'off',
      schemaName: 'topic_output',
      maxTokens: 1024,
      deadline: Date.now() + 15_000,
    });
    expect(requests[0]?.schema).toEqual(TOPIC_SCHEMA);
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes another configured deadline and maximum of output tokens through', async () => {
    const { extractor, requests } = setup([ok(NOTHING)], {
      config: { deadlineSeconds: 8, maxTokens: 2048 },
    });
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests[0]).toMatchObject({ deadline: Date.now() + 8_000, maxTokens: 2048 });
  });

  it('passes another configured model and thinking through unchanged', async () => {
    const { extractor, requests } = setup([ok(NOTHING)], {
      config: { model: 'claude-sonnet-5-5', thinking: 'low' },
    });
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests[0]).toMatchObject({ model: 'claude-sonnet-5-5', thinking: 'low' });
  });

  it('sends the blocks instruction with schema, tag list, window, new since the last analysis, in this order', async () => {
    const { extractor, requests } = setup([ok(NOTHING)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests[0]?.blocks.map((b) => b.kind)).toEqual(['prefix', 'context', 'window', 'new']);
  });

  it('starts with the instruction, trimmed and otherwise unchanged, followed by the output schema of spec 6', async () => {
    const { extractor, requests } = setup([ok(NOTHING)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(textOf(requests[0], 'prefix')).toBe(
      `${INSTRUCTION.trim()}\n\n## Ausgabeschema (JSON)\n${SCHEMA_TEXT}`,
    );
  });

  it('takes the instruction of topic_extractor.de.txt over unchanged', async () => {
    const instruction = readFileSync(REPO_PROMPT, 'utf8');
    const { extractor, requests } = setup([ok(NOTHING)], { config: { instruction } });
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(
      textOf(requests[0], 'prefix')?.startsWith(
        `${instruction.trim()}\n\n## Ausgabeschema (JSON)\n`,
      ),
    ).toBe(true);
  });

  it('ends the cacheable prefix after the tag list: breakpoints on the instruction and the tag list only', async () => {
    const { extractor, requests } = setup([ok(NOTHING)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests[0]?.blocks.map((b) => [b.kind, b.cache, b.system])).toEqual([
      ['prefix', true, true],
      ['context', true, false],
      ['window', false, false],
      ['new', false, false],
    ]);
  });

  it('lists the tag list with status and parent after earlier results', async () => {
    const { extractor, requests } = setup([
      ok(
        out({
          current: [TOPIC, 'Mietpreisbremse'],
          new: [{ tag: 'Mietpreisbremse', parent: TOPIC }],
        }),
      ),
      ok(
        out({
          current: [TOPIC, 'Neubau'],
          new: [{ tag: 'Neubau', parent: TOPIC }],
          ended: ['Mietpreisbremse'],
        }),
      ),
      ok(NOTHING),
    ]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5));
    await extractor.call(call(TURN_B, [], 25, true));
    expect(textOf(requests[2], 'context')).toBe(
      'Tag-Liste:\n- Mieten Berlin (aktiv)\n- Mietpreisbremse (beendet, unter Mieten Berlin)\n' +
        '- Neubau (aktiv, unter Mieten Berlin)',
    );
  });

  it('shows the finalized Segments of the last 60 s of the Session in the window, each with its Speaker', async () => {
    const { extractor, requests } = setup([ok(NOTHING)]);
    await extractor.call(call(TURN_B, [B2], 24.5));
    expect(textOf(requests[0], 'window')).toBe(
      `Fenster (letzte 60 s):\n${LINE_A1}\n${LINE_B1}\n${LINE_B2}`,
    );
  });

  it.each([
    [74, `${LINE_B1}\n${LINE_B2}`],
    [73.875, `${LINE_A1}\n${LINE_B1}\n${LINE_B2}`],
  ])(
    'at %d s takes a Segment into the window only when it ends later than 60 s before (harness: end > t - 60)',
    async (at, lines) => {
      const { extractor, requests } = setup([ok(NOTHING)]);
      await extractor.call(call(TURN_B, [], at, true));
      expect(textOf(requests[0], 'window')).toBe(`Fenster (letzte 60 s):\n${lines}`);
    },
  );

  it('takes the window length from configuration (topic_window_seconds)', async () => {
    const { extractor, requests } = setup([ok(NOTHING)], { config: { windowSeconds: 30 } });
    await extractor.call(call(TURN_B, [], 44.5, true));
    expect(textOf(requests[0], 'window')).toBe(`Fenster (letzte 30 s):\n${LINE_B1}\n${LINE_B2}`);
  });

  it('says so when no Segment ended within the window', async () => {
    const { extractor, requests } = setup([ok(NOTHING)]);
    await extractor.call(call(TURN_B, [], 200, true));
    expect(textOf(requests[0], 'window')).toBe('Fenster (letzte 60 s):\n(kein Fenster)');
  });

  it('sends as new the finalized Segments not analysed before, and on the next call only what came since', async () => {
    const { extractor, requests } = setup([ok(NOTHING), ok(NOTHING)], { segments: [B1, B2] });
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5, true));
    expect(textOf(requests[0], 'new')).toBe(`Neu seit der letzten Analyse:\n${LINE_B1}`);
    expect(textOf(requests[1], 'new')).toBe(`Neu seit der letzten Analyse:\n${LINE_B2}`);
  });

  it('says so when nothing is new since the last analysis', async () => {
    const { extractor, requests } = setup([ok(NOTHING), ok(NOTHING)], { segments: [B1, B2] });
    await extractor.call(call(TURN_B, [B1, B2], 24.5));
    await extractor.call(call(TURN_B, [], 30, true));
    expect(textOf(requests[1], 'new')).toBe('Neu seit der letzten Analyse:\n(nichts Neues)');
  });

  it('never shows a Segment that is not final at the time of the call, neither in the window nor as new', async () => {
    const { extractor, requests } = setup([ok(NOTHING), ok(NOTHING)], { segments: [B1, B2] });
    await extractor.call(call(TURN_B, [B1], 20));
    expect(textOf(requests[0], 'window')).toBe(`Fenster (letzte 60 s):\n${LINE_B1}`);
    expect(textOf(requests[0], 'new')).toBe(`Neu seit der letzten Analyse:\n${LINE_B1}`);
    await extractor.call(call(TURN_B, [B2], 24.5, true));
    expect(textOf(requests[1], 'new')).toBe(`Neu seit der letzten Analyse:\n${LINE_B2}`);
  });

  it('does not send a Segment as new again that an earlier call of another Turn analysed', async () => {
    const { extractor, requests } = setup([ok(NOTHING), ok(NOTHING)], { segments: [A1, B1] });
    await extractor.call(call(TURN_A, [A1], 14.5, true));
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(textOf(requests[1], 'new')).toBe(`Neu seit der letzten Analyse:\n${LINE_B1}`);
  });

  it('sends the increment of a lost final analysis of one Turn as new with the next call of another Turn', async () => {
    const { extractor, requests } = setup([ok('kein JSON'), ok('kein JSON'), ok(NOTHING)], {
      segments: [A1, B1],
    });
    await extractor.call(call(TURN_A, [A1], 14.5, true));
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests).toHaveLength(3);
    expect(textOf(requests[2], 'new')).toBe(
      `Neu seit der letzten Analyse:\n${LINE_A1}\n${LINE_B1}`,
    );
  });

  it('does not send as new a Segment that a still running call of another Turn carries', async () => {
    const requests: ModelRequest[] = [];
    let release: (result: AdapterResult) => void = () => undefined;
    const adapter: ModelAdapter = {
      name: 'scripted',
      call(request) {
        requests.push(request);
        if (requests.length > 1) return Promise.resolve(ok(NOTHING));
        return new Promise<AdapterResult>((resolve) => {
          release = resolve;
        });
      },
    };
    const { extractor } = setup([], { segments: [A1, B1], adapter });
    const running = extractor.call(call(TURN_A, [A1], 14.5, true));
    for (let i = 0; i < 100 && requests.length === 0; i += 1) await Promise.resolve();
    expect(requests).toHaveLength(1);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(textOf(requests[1], 'new')).toBe(`Neu seit der letzten Analyse:\n${LINE_B1}`);
    release(ok(NOTHING));
    await running;
  });
});

describe('a validated result changes the tag list and becomes a Topic event (AC7, AC8, AC9)', () => {
  it('adds a new tag as active with its parent and writes one contract-valid Topic event at the Tick time', async () => {
    const result = out({
      current: [TOPIC, 'Mietpreisbremse'],
      new: [{ tag: 'Mietpreisbremse', parent: TOPIC }],
    });
    const { extractor, events } = setup([ok(result)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(extractor.tagList()).toEqual([
      { tag: TOPIC, status: 'active', parent: null },
      { tag: 'Mietpreisbremse', status: 'active', parent: TOPIC },
    ]);
    expect(events).toHaveLength(1);
    expect(DetectionEvent.safeParse(events[0]).success).toBe(true);
    expect(events[0]).toEqual({
      schemaVersion: 2,
      type: 'topic',
      sessionId: SESSION,
      topic: {
        schemaVersion: 1,
        tickAt: 19.5,
        current: [TOPIC, 'Mietpreisbremse'],
        new: [{ tag: 'Mietpreisbremse', parent: TOPIC }],
        returned: [],
        ended: [],
      },
    });
  });

  it('takes a new tag of 200 code points outside the BMP without a repeat (O3: the bound counts code points)', async () => {
    const wide = '\u{1F5FA}'.repeat(200);
    const result = out({ current: [TOPIC, wide], new: [{ tag: wide, parent: TOPIC }] });
    const { extractor, requests, events } = setup([ok(result)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(DetectionEvent.safeParse(events[0]).success).toBe(true);
    expect(events[0]).toMatchObject({ topic: { new: [{ tag: wide, parent: TOPIC }] } });
  });

  it('does not report a tag of new that is already in the list as new (here the seeded Topic)', async () => {
    const result = out({
      current: [TOPIC, 'Neubau'],
      new: [
        { tag: TOPIC, parent: null },
        { tag: 'Neubau', parent: TOPIC },
      ],
    });
    const { extractor, events } = setup([ok(result)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(events).toMatchObject([{ topic: { new: [{ tag: 'Neubau', parent: TOPIC }] } }]);
  });

  it('applies ended and returned to tags of the list and reports them in the Topic event', async () => {
    const { extractor, events } = setup([
      ok(out({ current: [TOPIC, 'Neubau'], new: [{ tag: 'Neubau', parent: TOPIC }] })),
      ok(out({ current: [TOPIC], ended: ['Neubau'] })),
      ok(out({ current: [TOPIC, 'Neubau'], returned: ['Neubau'] })),
    ]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5));
    expect(extractor.tagList()).toContainEqual({ tag: 'Neubau', status: 'ended', parent: TOPIC });
    await extractor.call(call(TURN_B, [], 30, true));
    expect(extractor.tagList()).toContainEqual({ tag: 'Neubau', status: 'active', parent: TOPIC });
    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({
      topic: { tickAt: 24.5, current: [TOPIC], new: [], returned: [], ended: ['Neubau'] },
    });
    expect(events[2]).toMatchObject({
      topic: { tickAt: 30, current: [TOPIC, 'Neubau'], new: [], returned: ['Neubau'], ended: [] },
    });
  });

  it('ignores returned and ended tags not in the list, leaves them out of the event and counts them in the log', async () => {
    const result = out({
      current: [TOPIC, 'Neubau'],
      new: [{ tag: 'Neubau', parent: TOPIC }],
      returned: ['Euro'],
      ended: ['Schengen'],
    });
    const { extractor, events, calls } = setup([ok(result)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(extractor.tagList().map((t) => t.tag)).toEqual([TOPIC, 'Neubau']);
    expect(events).toMatchObject([{ topic: { returned: [], ended: [] } }]);
    expect(calls()[0]?.['unknownTags']).toBe(2);
  });

  it('writes exactly one Topic event for a result that adds, ends and changes the current Topics at once', async () => {
    const { extractor, events } = setup([
      ok(out({ current: [TOPIC, 'Neubau'], new: [{ tag: 'Neubau', parent: TOPIC }] })),
      ok(
        out({
          current: ['Rente'],
          new: [{ tag: 'Rente', parent: null }],
          ended: [TOPIC, 'Neubau'],
        }),
      ),
    ]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5));
    expect(events).toHaveLength(2);
  });

  it('writes no Topic event for a result that changes nothing', async () => {
    const same = out({ current: [TOPIC, 'Neubau'], new: [{ tag: 'Neubau', parent: TOPIC }] });
    const { extractor, events } = setup([ok(same), ok(same)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5, true));
    expect(events).toHaveLength(1);
  });

  it('writes no Topic event for a result whose only content is unknown tags', async () => {
    const { extractor, events } = setup([
      ok(out({ current: [TOPIC, 'Neubau'], new: [{ tag: 'Neubau', parent: TOPIC }] })),
      ok(out({ current: [TOPIC, 'Neubau'], returned: ['Euro'], ended: ['Schengen'] })),
    ]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5, true));
    expect(events).toHaveLength(1);
  });

  it('resolves with the latency the call took, for the skip rule of the scheduler', async () => {
    const { extractor } = setup([ok(NOTHING, 0.75)]);
    expect((await extractor.call(call(TURN_B, [B1], 19.5))).latencySeconds).toBe(0.75);
  });
});

describe('an output that violates the schema is repeated once, then the call is lost (AC10)', () => {
  it.each([
    ['no JSON', 'kein JSON'],
    ['a missing field', { current: [], new: [], returned: [] }],
    ['an unknown field', { ...out(), discarded: [] }],
    ['a new entry without parent', { ...out(), new: [{ tag: 'Neubau' }] }],
    ['current that is no list', { ...out(), current: 'Neubau' }],
    [
      'a new tag of 201 characters (O3)',
      { ...out(), new: [{ tag: 'x'.repeat(201), parent: null }] },
    ],
    ['an empty tag in current (O3)', { ...out(), current: [''] }],
    [
      'a new parent of 201 characters (O3)',
      { ...out(), new: [{ tag: 'Neubau', parent: 'x'.repeat(201) }] },
    ],
  ])(
    'repeats an answer with %s once, the same blocks plus the error message at the end',
    async (_, bad) => {
      const good = out({ current: [TOPIC, 'Neubau'], new: [{ tag: 'Neubau', parent: TOPIC }] });
      const { extractor, requests, events } = setup([ok(bad), ok(good)]);
      await extractor.call(call(TURN_B, [B1], 19.5));
      expect(requests).toHaveLength(2);
      expect(requests[1]?.blocks.slice(0, -1)).toEqual(requests[0]?.blocks);
      expect(requests[1]?.blocks.at(-1)?.kind).toBe('retry');
      expect(events).toHaveLength(1);
    },
  );

  it('loses a call whose repeat fails too: tag list unchanged, no Topic event, one schema error', async () => {
    const { extractor, requests, events } = setup([ok('kein JSON'), ok('immer noch kein JSON')]);
    const before = extractor.tagList();
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests).toHaveLength(2);
    expect(extractor.tagList()).toEqual(before);
    expect(events).toHaveLength(0);
    expect(extractor.counters.schemaErrors).toBe(1);
  });

  it('sends the lost increment again as new with the next call', async () => {
    const { extractor, requests } = setup([ok('kein JSON'), ok('kein JSON'), ok(NOTHING)], {
      segments: [B1, B2],
    });
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5, true));
    expect(textOf(requests[2], 'new')).toBe(
      `Neu seit der letzten Analyse:\n${LINE_B1}\n${LINE_B2}`,
    );
  });

  it('takes the number of repeats from configuration: with schema_retries 0 the first unusable answer loses the call', async () => {
    const { extractor, requests, events } = setup([ok('kein JSON'), ok(NOTHING)], {
      config: { schemaRetries: 0 },
    });
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(requests).toHaveLength(1);
    expect(events).toHaveLength(0);
    expect(extractor.counters.schemaErrors).toBe(1);
  });

  it('does not count a schema error for a call answered validly on the repeat', async () => {
    const { extractor } = setup([ok('kein JSON'), ok(NOTHING)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(extractor.counters.schemaErrors).toBe(0);
  });

  it('logs the lost call with outcome schema_failure after 2 attempts', async () => {
    const { extractor, calls } = setup([ok('kein JSON'), ok('kein JSON')]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ outcome: 'schema_failure', attempts: 2 });
  });
});

describe('the log event of a Topic Extractor call (AC11)', () => {
  it('carries role, Session id, Turn id, outcome, duration, the tokens and the cost in the fields of T1b', async () => {
    const { extractor, calls } = setup([ok(NOTHING, 0.5)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(calls()).toHaveLength(1);
    const [line] = calls();
    expect(line).toMatchObject({
      sessionId: SESSION,
      modelRole: 'topic_extractor',
      turnId: 't-002',
      outcome: 'valid',
      durationMs: 500,
      inputTokens: 100,
      cacheWriteTokens: 30,
      cacheReadTokens: 40,
      outputTokens: 20,
      thinkingTokens: 5,
    });
    expect(typeof line?.['costUsd']).toBe('number');
    expect(Number(line?.['costUsd'])).toBeGreaterThanOrEqual(0);
  });

  it('sums the tokens and the duration over both attempts of a repeated call', async () => {
    const { extractor, calls } = setup([ok('kein JSON', 0.5), ok(NOTHING, 0.5)]);
    await extractor.call(call(TURN_B, [B1], 19.5));
    expect(calls()[0]).toMatchObject({
      outcome: 'valid',
      attempts: 2,
      durationMs: 1000,
      inputTokens: 200,
      cacheWriteTokens: 60,
      cacheReadTokens: 80,
      outputTokens: 40,
      thinkingTokens: 10,
    });
  });

  it('says whether the call was the final analysis of its Turn, as a boolean', async () => {
    const { extractor, calls } = setup([ok(NOTHING), ok(NOTHING)], { segments: [B1, B2] });
    await extractor.call(call(TURN_B, [B1], 19.5));
    await extractor.call(call(TURN_B, [B2], 24.5, true));
    const [notFinal, final] = calls();
    expect(notFinal?.['final']).toBe(false);
    expect(final?.['final']).toBe(true);
  });

  it.each([
    ['fatal', [failed('fatal')], 1],
    ['adapter_error', [failed('retryable'), failed('retryable')], 2],
  ])(
    'logs an adapter failure with outcome %s and changes nothing',
    async (outcome, script, attempts) => {
      const { extractor, calls, events, requests } = setup(script);
      await extractor.call(call(TURN_B, [B1], 19.5));
      expect(requests).toHaveLength(attempts);
      expect(calls()).toMatchObject([{ outcome }]);
      expect(events).toHaveLength(0);
      expect(extractor.tagList()).toEqual([{ tag: TOPIC, status: 'active', parent: null }]);
    },
  );

  it('never writes transcript text, Segment text, tag text, the Setting or a Speaker name', async () => {
    const { extractor, lines } = setup([
      ok(
        out({
          current: [TOPIC, 'Mietpreisbremse'],
          new: [{ tag: 'Mietpreisbremse', parent: TOPIC }],
        }),
      ),
      ok('kein JSON'),
      ok(
        out({
          current: [TOPIC, 'Neubau'],
          new: [{ tag: 'Neubau', parent: TOPIC }],
          returned: ['Euro'],
        }),
      ),
    ]);
    await extractor.call(call(TURN_A, [A1], 14.5, true));
    await extractor.call(call(TURN_B, [B1, B2], 24.5, true));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      for (const word of [...CONTENT, 'Euro']) expect(line).not.toContain(word);
    }
  });
});
