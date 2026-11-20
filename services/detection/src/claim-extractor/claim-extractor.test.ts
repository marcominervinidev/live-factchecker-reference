// Stage 1, issue #29 (T4), Task 3: the Claim Extractor behind T3's extractor port (src/turns/tick-scheduler.ts
// `Extractor`): it builds the request, calls the model through callValidated, turns the answer into Claim events on
// the detection stream, Candidate records for the Candidate port, counters and log events. AC1, AC3 to AC6 as wired,
// AC9 to AC15, AC18. Mocks only at the boundaries: a scripted model adapter (the LLM), a recording detection stream
// and a recording Candidate port (T5 implements the port; ticket Task 3 "a recording fake"); the logger is the real
// one of @lfc/service-kit with its closed field set, writing into an array.
//
// Public interface these tests define (built in Task 3):
//   src/claim-extractor/claim-extractor.ts
//     export interface DetectionStream { append(event: DetectionEvent): Promise<void> }   // DetectionEvent of
//                                                                                          // @lfc/contracts
//     export interface CandidatePort { hand(record: CandidateRecord): Promise<void> }     // claims.ts
//     export function createClaimExtractor(options: {
//       readonly sessionId: string;
//       readonly config: ClaimExtractorConfig;               // config.ts (config.claim-extractor.test.ts)
//       readonly setting: Setting;                           // prompt.ts
//       readonly speakerNames: Readonly<Record<string, string>>;   // label -> name (text mode only, Assumptions)
//       readonly adapter: ModelAdapter;                      // @lfc/providers
//       readonly session: { turns(): readonly Turn[]; labels(): readonly string[] };   // what the Session has seen
//       readonly stream: DetectionStream;
//       readonly candidates: CandidatePort;
//       readonly logger: Logger;
//     }): Extractor & { readonly counters: { readonly schemaErrors: number; readonly repeats: number;
//                                            readonly duplicates: number; readonly dropped: number } }
//   The request: role claim_extractor, the Session id, model, thinking and maxTokens of the configuration, the
//   strict JSON Schema of output-schema.ts named claim_extractor_output (the harness's name), the blocks of prompt.ts,
//   deadline now + deadlineSeconds. A call returns at `at` plus the latency callValidated reports (the replay clock,
//   ticket Assumptions); that time is the Claim's emittedAt and the latency handed back to the scheduler. The port
//   resolves on every outcome (tick-scheduler.ts: it rejects only for a programming error).
//   Log events (names: gate 1, owner 2026-11-03, question 10 "Angenommen"; fields only from the logger's closed list, extended by this ticket with
//   claimId, candidateId, reason, attempts, outcome):
//     claim_extractor.call  one per call: sessionId, modelRole claim_extractor, turnId, attempts, outcome (valid,
//                           schema_failure, adapter_error, timeout, fatal); a lost call is the one with outcome not valid
//     claim.repeat          sessionId, turnId, claimId (the referenced Claim id only, AC12)
//     claim.duplicate       sessionId, turnId (AC13)
//     candidate.created     sessionId, turnId, candidateId, reason (AC14)
import { createClaimExtractor } from './claim-extractor.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimExtractorJsonSchema } from './output-schema.ts';
import { DetectionEvent } from '@lfc/contracts';
import { createLogger } from '@lfc/service-kit';
import { seg } from '../testing/turns.ts';
import type { AdapterResult, ModelAdapter, ModelRequest } from '@lfc/providers';
import type { Segment } from '@lfc/contracts';
import type { ExtractorCall } from '../turns/tick-scheduler.ts';
import type { Turn } from '../turns/types.ts';

const SESSION = '29a0c0de-0000-4000-8000-000000000041';
const INSTRUCTION = 'Du bist der Behauptungs-Extraktor eines Live-Faktenchecks (Testanweisung).';
const TOPIC = 'Programmatik der Testpartei';
const CONFIG = {
  adapter: 'mock' as const,
  instruction: INSTRUCTION,
  model: 'claude-haiku-5-5',
  thinking: 'off' as const,
  maxTokens: 2048,
  deadlineSeconds: 15,
  tokensPerWord: 2.1,
  contextTurns: 2,
  contextTokenCap: 600,
  claimListCap: 100,
  schemaRetries: 1,
  cacheBlockBreakpoint: 20,
};
const SETTING = {
  mode: 'broadcast' as const,
  speakers: [
    { name: 'Kallac Haqy', role: 'moderator' as const, public: true },
    { name: 'Hukgl Suubayy', role: 'guest' as const, public: true },
  ],
  topic: TOPIC,
};
const NAMES = { A: 'Kallac Haqy', B: 'Hukgl Suubayy' };

const A1 = seg('s-0001', 'A', 60, 64, 65, 'Ibye Humqehpogba yigy niej iir rip Ueju');
const B1 = seg('s-0002', 'B', 65, 69, 70, 'Rob qutc baoj 2017 os Fiydulvuv');
const B2 = seg('s-0003', 'B', 69, 73, 74, 'Gucken Sie jede Rede an');
const TURN_A: Turn = { id: 't-001', speaker: 'A', interjection: false, segments: [A1] };
const TURN_B: Turn = { id: 't-002', speaker: 'B', interjection: false, segments: [B1, B2] };
const TRANSCRIPT_WORDS = ['Humqehpogba', 'Fiydulvuv', 'Gucken'];

const SENTENCE = 'Hukgl Suubayy facuajkiz, noxl vee AsQ baoj 2017 os Fiydulvuv ovp.';
const CLAIM = {
  speaker: 'Hukgl Suubayy',
  sentence: SENTENCE,
  verbatim: 'baoj 2017 os Fiydulvuv',
  segmentIds: ['s-0002'],
  type: 'zahl',
  checkworthiness: 'hoch',
  kind: 'tatsache',
  refersTo: null,
  repeatOf: null,
};
const CANDIDATE = {
  speaker: 'Hukgl Suubayy',
  verbatim: 'Gucken Sie jede Rede an',
  segmentIds: ['s-0003'],
  reason: 'kern_unklar',
  note: 'Notiz mit Inhalt: unklar, ob ein Tatsachenkern vorliegt',
};

function ok(answer: unknown, latencySeconds = 0.5): AdapterResult {
  return {
    ok: true,
    text: typeof answer === 'string' ? answer : JSON.stringify(answer),
    usage: { input: 100, cacheWrite: 0, cacheRead: 0, output: 20, thinking: 0 },
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

const answer = (claims: unknown[] = [], candidates: unknown[] = []) => ({ claims, candidates });

function setup(...script: (AdapterResult | 'hang')[]) {
  const requests: ModelRequest[] = [];
  const adapter: ModelAdapter = {
    name: 'scripted',
    call(request) {
      requests.push(request);
      const next = script[requests.length - 1] ?? ok(answer());
      return next === 'hang' ? new Promise<AdapterResult>(() => undefined) : Promise.resolve(next);
    },
  };
  const events: unknown[] = [];
  const handed: unknown[] = [];
  const lines: string[] = [];
  const turns: Turn[] = [TURN_A, TURN_B];
  const extractor = createClaimExtractor({
    sessionId: SESSION,
    config: CONFIG,
    setting: SETTING,
    speakerNames: NAMES,
    adapter,
    session: { turns: () => turns, labels: () => ['A', 'B'] },
    stream: {
      append(event) {
        events.push(event);
        return Promise.resolve();
      },
    },
    candidates: {
      hand(record) {
        handed.push(record);
        return Promise.resolve();
      },
    },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  const logged = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  return { extractor, requests, events, handed, lines, logged, turns };
}

function call(turn: Turn, segments: readonly Segment[], at: number, final = false): ExtractorCall {
  return { turn, segments, final, at };
}

const textsOf = (request: ModelRequest | undefined, kind: string) =>
  (request?.blocks ?? []).filter((b) => b.kind === kind).map((b) => b.text);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-03T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

/** A log line without the logger's own fields `time` and `service`. */
function withoutTimeAndService(line: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(line).filter(([name]) => name !== 'time' && name !== 'service'),
  );
}

describe('the Claim Extractor builds its request from configuration and prompt (AC1, AC18)', () => {
  it('passes role, Session id, model, thinking, output schema, max tokens and a 15 s deadline', async () => {
    const { extractor, requests } = setup(ok(answer()));
    await extractor.call(call(TURN_B, [B1], 70));
    const [request] = requests;
    expect(request).toMatchObject({
      role: 'claim_extractor',
      sessionId: SESSION,
      model: 'claude-haiku-5-5',
      thinking: 'off',
      schemaName: 'claim_extractor_output',
      maxTokens: 2048,
      deadline: Date.now() + 15_000,
    });
    expect(request?.schema).toEqual(claimExtractorJsonSchema);
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes another configured model and thinking through unchanged', async () => {
    const requests: ModelRequest[] = [];
    const extractor = createClaimExtractor({
      sessionId: SESSION,
      config: { ...CONFIG, model: 'claude-sonnet-5-5', thinking: 'low' as const },
      setting: SETTING,
      speakerNames: NAMES,
      adapter: { name: 'scripted', call: (r) => (requests.push(r), Promise.resolve(ok(answer()))) },
      session: { turns: () => [TURN_A, TURN_B], labels: () => ['A', 'B'] },
      stream: { append: () => Promise.resolve() },
      candidates: { hand: () => Promise.resolve() },
      logger: createLogger({ service: 'detection', write: () => undefined }),
    });
    await extractor.call(call(TURN_B, [B1], 70));
    expect(requests[0]).toMatchObject({ model: 'claude-sonnet-5-5', thinking: 'low' });
  });

  it('sends the blocks in the order of spec 3, the prefix with the configured instruction and the Setting', async () => {
    const { extractor, requests } = setup(ok(answer()));
    await extractor.call(call(TURN_B, [B1], 70));
    const blocks = requests[0]?.blocks ?? [];
    expect(blocks.map((b) => b.kind)).toEqual([
      'prefix',
      'attribution',
      'claim_list',
      'context',
      'turn',
      'delta',
      'final',
    ]);
    expect(blocks[0]?.text.startsWith(`${INSTRUCTION}\n\n`)).toBe(true);
    expect(blocks[0]?.text).toContain(`Anfangs-Topic: ${TOPIC}`);
    expect(textsOf(requests[0], 'attribution')[0]).toMatch(
      /^- B -> Hukgl Suubayy · .+ · certain$/m,
    );
  });

  it('puts the earlier Turn into the context and only the current Turn into its Turn blocks (AC5, AC6)', async () => {
    const { extractor, requests } = setup(ok(answer()), ok(answer()));
    await extractor.call(call(TURN_B, [B1], 70));
    await extractor.call(call(TURN_B, [B2], 74, true));
    expect(textsOf(requests[0], 'context')[0]).toBe(
      'Kontext-Turns:\n[A · 60.00–64.00 s]\nIbye Humqehpogba yigy niej iir rip Ueju',
    );
    const turnBlocks = textsOf(requests[1], 'turn');
    expect(turnBlocks).toHaveLength(2);
    expect(turnBlocks[0]).toBe(textsOf(requests[0], 'turn')[0]);
    expect(turnBlocks.join('\n')).not.toContain('s-0001');
    expect(turnBlocks[1]).toContain('s-0003');
    expect(turnBlocks[1]).toContain('(Ende des Redebeitrags)');
  });
});

describe('an accepted Claim becomes one Claim event on the detection stream (AC11)', () => {
  it('appends one contract-valid envelope with the Claim, c-01, at the return time of the call', async () => {
    const { extractor, events } = setup(ok(answer([CLAIM]), 0.5));
    const returned = await extractor.call(call(TURN_B, [B1], 70));
    expect(returned.latencySeconds).toBe(0.5);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(DetectionEvent.safeParse(event).success).toBe(true);
    expect(event).toMatchObject({
      schemaVersion: 2, // envelope version 2 since T6 (owner unlock, #32 O1, 2026-11-18)
      type: 'claim',
      sessionId: SESSION,
      claim: {
        id: 'c-01',
        turnId: 't-002',
        source: 'claim_extractor',
        speaker: 'Hukgl Suubayy',
        speakerLabel: 'B',
        sentence: SENTENCE,
        segmentIds: ['s-0002'],
        start: 65,
        end: 69,
        emittedAt: 70.5,
      },
    });
  });

  it('dates the Claim after both attempts when the first answer was unusable (AC9)', async () => {
    const { extractor, events, requests } = setup(ok('kein JSON', 1), ok(answer([CLAIM]), 0.5));
    const returned = await extractor.call(call(TURN_B, [B1], 70));
    expect(requests).toHaveLength(2);
    expect(requests[1]?.blocks.at(-1)?.kind).toBe('retry');
    expect(returned.latencySeconds).toBe(1.5);
    expect(events).toMatchObject([{ claim: { id: 'c-01', emittedAt: 71.5 } }]);
  });

  it('shows c-01 as a delta Claim in the next call of the Turn and in the Claim list of the next Turn (AC3, AC4)', async () => {
    const { extractor, requests, turns } = setup(ok(answer([CLAIM])), ok(answer()), ok(answer()));
    await extractor.call(call(TURN_B, [B1], 70));
    await extractor.call(call(TURN_B, [B2], 74, true));
    expect(textsOf(requests[1], 'claim_list')).toEqual(['Behauptungsliste des Gesprächs: (leer)']);
    expect(textsOf(requests[1], 'delta')[0]).toContain(`c-01 · Hukgl Suubayy · ${SENTENCE}`);
    const next: Turn = {
      id: 't-003',
      speaker: 'A',
      interjection: false,
      segments: [seg('s-0004', 'A', 74, 76, 77, 'Awze vuc decw rerlb')],
    };
    turns.push(next);
    await extractor.call(call(next, next.segments, 77, true));
    expect(textsOf(requests[2], 'claim_list')[0]).toContain(`c-01 · Hukgl Suubayy · ${SENTENCE}`);
    expect(textsOf(requests[2], 'delta')).toEqual([
      'Delta-Behauptungen (in diesem Turn bereits ausgegeben): (leer)',
    ]);
  });

  it('logs one claim_extractor.call event with the Turn, the attempts and the outcome', async () => {
    const { extractor, logged } = setup(ok('kein JSON'), ok(answer([CLAIM])));
    await extractor.call(call(TURN_B, [B1], 70));
    const calls = logged().filter((l) => l['event'] === 'claim_extractor.call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sessionId: SESSION,
      modelRole: 'claim_extractor',
      turnId: 't-002',
      attempts: 2,
      outcome: 'valid',
    });
  });
});

describe('a repeat gets no id and no event (AC12)', () => {
  it('counts the repeat and logs it with the referenced Claim id only', async () => {
    const repeat = { ...CLAIM, sentence: 'Hukgl Suubayy wiederholt es.', repeatOf: 'c-01' };
    const { extractor, events, logged } = setup(ok(answer([CLAIM])), ok(answer([repeat])));
    await extractor.call(call(TURN_B, [B1], 70));
    await extractor.call(call(TURN_B, [B2], 74, true));
    expect(events).toHaveLength(1);
    expect(extractor.counters.repeats).toBe(1);
    const lines = logged().filter((l) => l['event'] === 'claim.repeat');
    expect(lines).toHaveLength(1);
    const fields = withoutTimeAndService(lines[0]);
    expect(fields).toEqual({
      event: 'claim.repeat',
      sessionId: SESSION,
      turnId: 't-002',
      claimId: 'c-01',
    });
  });
});

describe('a duplicate gets no id and no event (AC13)', () => {
  it('counts the duplicate and logs it without its sentence', async () => {
    const again = { ...CLAIM, sentence: SENTENCE.toUpperCase() };
    const { extractor, events, logged } = setup(ok(answer([CLAIM])), ok(answer([again])));
    await extractor.call(call(TURN_B, [B1], 70));
    await extractor.call(call(TURN_B, [B2], 74, true));
    expect(events).toHaveLength(1);
    expect(extractor.counters.duplicates).toBe(1);
    const lines = logged().filter((l) => l['event'] === 'claim.duplicate');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sessionId: SESSION, turnId: 't-002' });
  });
});

describe('an accepted Candidate becomes a Candidate record for the Candidate port (AC14)', () => {
  it('hands k-01 with its fields and Turn id to the port, logs ids and reason, and writes no Claim event', async () => {
    const { extractor, events, handed, logged } = setup(ok(answer([], [CANDIDATE])));
    await extractor.call(call(TURN_B, [B1, B2], 74));
    expect(events).toEqual([]);
    expect(handed).toEqual([{ id: 'k-01', turnId: 't-002', ...CANDIDATE }]);
    const lines = logged().filter((l) => l['event'] === 'candidate.created');
    expect(lines).toHaveLength(1);
    const fields = withoutTimeAndService(lines[0]);
    expect(fields).toEqual({
      event: 'candidate.created',
      sessionId: SESSION,
      turnId: 't-002',
      candidateId: 'k-01',
      reason: 'kern_unklar',
    });
  });
});

describe('a call whose repeat fails as well is lost (AC10)', () => {
  it.each([
    [
      'two unusable answers',
      [ok('kein JSON'), ok('{"claims": [], "discarded": []}')],
      'schema_failure',
    ],
    ['two adapter errors', [failed('retryable'), failed('retryable')], 'adapter_error'],
    ['a fatal adapter error', [failed('fatal')], 'fatal'],
  ] as const)(
    'after %s: no Claim event, no Candidate, the counter +1, one log event of the loss',
    async (_, script, outcome) => {
      const { extractor, events, handed, logged } = setup(...script);
      const returned = await extractor.call(call(TURN_B, [B1], 70));
      expect(Number.isFinite(returned.latencySeconds) && returned.latencySeconds >= 0).toBe(true);
      expect(events).toEqual([]);
      expect(handed).toEqual([]);
      expect(extractor.counters.schemaErrors).toBe(1);
      const calls = logged().filter((l) => l['event'] === 'claim_extractor.call');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ turnId: 't-002', outcome });
    },
  );

  it('loses a call still unanswered at the deadline of 15 s, and resolves', async () => {
    const { extractor, events, logged } = setup('hang');
    const pending = extractor.call(call(TURN_B, [B1], 70));
    await vi.advanceTimersByTimeAsync(15_000);
    const returned = await pending;
    // the lane stays busy up to the deadline (gate 1, owner 2026-11-03, question 11: "15 s bis zur Frist, wie im Harness"), as harness busy_until = t + latency
    expect(returned.latencySeconds).toBe(15);
    expect(events).toEqual([]);
    expect(extractor.counters.schemaErrors).toBe(1);
    expect(logged().filter((l) => l['event'] === 'claim_extractor.call')).toMatchObject([
      { outcome: 'timeout' },
    ]);
  });

  it('leaves the Claim list unchanged and repeats the lost Turn block in the next call of the Turn', async () => {
    const { extractor, requests } = setup(ok('kein JSON'), ok('kein JSON'), ok(answer([CLAIM])));
    await extractor.call(call(TURN_B, [B1], 70));
    await extractor.call(call(TURN_B, [B2], 74, true));
    const lostBlock = textsOf(requests[0], 'turn')[0];
    const next = requests[2];
    expect(textsOf(next, 'turn')).toHaveLength(2);
    expect(textsOf(next, 'turn')[0]).toBe(lostBlock);
    expect(textsOf(next, 'claim_list')).toEqual(['Behauptungsliste des Gesprächs: (leer)']);
    expect(textsOf(next, 'delta')).toEqual([
      'Delta-Behauptungen (in diesem Turn bereits ausgegeben): (leer)',
    ]);
  });
});

describe('no log line carries content (AC15, docs/spec/datenschutz.md 2)', () => {
  it('writes no Transcript word, sentence, verbatim, note, Speaker name or label, or Setting text into any log line', async () => {
    const repeat = { ...CLAIM, sentence: 'Hukgl Suubayy wiederholt es.', repeatOf: 'c-01' };
    const { extractor, lines } = setup(
      ok(answer([CLAIM], [CANDIDATE])),
      ok('kein JSON'),
      ok(answer([repeat, { ...CLAIM, sentence: SENTENCE.toLowerCase() }])),
    );
    await extractor.call(call(TURN_B, [B1], 70));
    await extractor.call(call(TURN_B, [B2], 74, true));
    expect(lines.length).toBeGreaterThan(0);
    const forbidden = [
      ...TRANSCRIPT_WORDS,
      SENTENCE,
      CLAIM.verbatim,
      CANDIDATE.note,
      'Hukgl Suubayy',
      'Kallac Haqy',
      TOPIC,
      'Hukgl',
      'Haqy',
    ];
    for (const line of lines) {
      for (const text of forbidden) expect(line).not.toContain(text);
      const values = Object.entries(JSON.parse(line) as Record<string, unknown>);
      expect(
        values.filter(([key, value]) => key === 'speaker' || value === 'A' || value === 'B'),
      ).toEqual([]);
    }
  });
});
