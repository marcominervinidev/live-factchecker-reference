// Stage 1, issue #29 (T4), Task 3: the Claim Extractor drops a Claim or Candidate that violates the contract and keeps
// the valid ones of the same answer, without a repeat (ADR 0004, addendum 2026-10-26; docs/spec/erkennung-modellrollen.md
// 4.2 "Ein Element mit Verstoß wird verworfen und mit Grund gezählt"; harness pipeline.py call_claim_extractor with
// contract_scope "element" and contract_reason).
//
// Decided (gate 1, owner 2026-11-03, question 1: "Je Element; AC9/AC10 auf „kein JSON, Schemaverstoß oder Adapterfehler“ schärfen";
// see packages/providers/src/call-validated.elements.test.ts).
//
// Interface: claim-extractor.test.ts (header). A dropped element is counted in counters.dropped and logged as one
// event `claim_extractor.dropped` with sessionId, turnId and the harness's reason category (wortlaut, segment_ids,
// id_unbekannt, refersTo_fehlt), never its text.
//
// Owner decisions of 2026-11-06 (Marco: "alle A ja"), the last describe block:
//   A8 ("Wird `invalid` unter `dropped` gezählt und als `claim_extractor.dropped` mit eigenem festem Grund geloggt?",
//   recommendation: "Feldnamen dürfen mit, Text nie"): a Claim whose Claim event would break the contract (claims.ts
//   outcome `invalid`) takes no id, is counted in counters.dropped and logged as claim_extractor.dropped with
//   sessionId, turnId and the fixed reason INVALID_REASON; contract field names may go into the line, text never.
//   A7 ("Bekommen Candidates die Grenzen des Claim-Ereignisses (200, 1000, und 1000 für `note`), verworfen vor der
//   Id?"): a Candidate whose speaker has more than 200, verbatim more than 1000 or note more than 1000 characters
//   takes no Candidate id, gives no record to the Candidate port and no candidate.created.
// Decided by the test designer under owner decision P1 of 2026-11-06 ("p1 ja"; question: "Sollen Benennungen und
// Formate, bei denen jede Antwort ginge (…), künftig vom Testdesigner entschieden und dir nur gemeldet werden"),
// reported to the owner:
//   - INVALID_REASON is 'ungueltig' (neither ticket nor spec names a value): German and lower case like the harness's
//     categories, a word of its own rather than the harness's catch-all `sonst` (A8: "eigenem festem Grund"), and it
//     fits the logger's LABEL_PATTERN. It stands only in the constant below.
//   - A dropped Candidate is counted and logged like an invalid Claim, with the same reason: counting and logging are
//     required (.claude/rules/pipeline.md: "nothing is silently dropped"); the same reason is the naming choice.
//   - The bounds count characters as the Claim event contract counts them, in code points (A7: "die Grenzen des
//     Claim-Ereignisses"; zod's max on a string): the Candidate at the bounds has a speaker of 200 non-BMP characters.
//   - Contract field names stay out of the log line: the ticket adds exactly six log fields (turnId, claimId,
//     candidateId, reason, attempts, outcome) and none for them; the cases check with toMatchObject, so a later field
//     would not break them.
import { createClaimExtractor } from './claim-extractor.ts';
import { describe, expect, it } from 'vitest';
import { createLogger } from '@lfc/service-kit';
import { seg } from '../testing/turns.ts';
import type { AdapterResult, ModelRequest } from '@lfc/providers';
import type { Turn } from '../turns/types.ts';

const SESSION = '29a0c0de-0000-4000-8000-000000000051';
const CONFIG = {
  adapter: 'mock' as const,
  instruction: 'Testanweisung.',
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
const A1 = seg('s-0001', 'A', 60, 64, 65, 'Ibye Humqehpogba yigy niej iir rip Ueju');
const B1 = seg('s-0002', 'B', 65, 69, 70, 'Rob qutc baoj 2017 os Fiydulvuv');
const TURN_A: Turn = { id: 't-001', speaker: 'A', interjection: false, segments: [A1] };
const TURN_B: Turn = { id: 't-002', speaker: 'B', interjection: false, segments: [B1] };

const GOOD = {
  speaker: 'Hukgl Suubayy',
  sentence: 'Hukgl Suubayy facuajkiz, noxl vee AsQ baoj 2017 os Fiydulvuv ovp.',
  verbatim: 'baoj 2017 os Fiydulvuv',
  segmentIds: ['s-0002'],
  type: 'zahl',
  checkworthiness: 'hoch',
  kind: 'tatsache',
  refersTo: null,
  repeatOf: null,
};
// A quote from the context Turn, as in 13 of 24 rejected verbatims of probe 3 (#73): not in this Turn's blocks.
const FROM_CONTEXT = {
  ...GOOD,
  sentence: 'Hukgl Suubayy facuajkiz, vee Humqehpogba zogpa niej iir rip Ueju.',
  verbatim: 'yigy niej iir rip Ueju',
};

/** The fixed reason of A7 and A8, decided by the test designer under P1 (header). */
const INVALID_REASON = 'ungueltig';

function run(answer: unknown) {
  const requests: ModelRequest[] = [];
  const events: unknown[] = [];
  const handed: unknown[] = [];
  const lines: string[] = [];
  const result: AdapterResult = {
    ok: true,
    text: JSON.stringify(answer),
    usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1, thinking: 0 },
    latencySeconds: 0.5,
    model: 'claude-haiku-5-5',
    adapter: 'scripted',
  };
  const extractor = createClaimExtractor({
    sessionId: SESSION,
    config: CONFIG,
    setting: { mode: 'broadcast' },
    speakerNames: { A: 'Kallac Haqy', B: 'Hukgl Suubayy' },
    adapter: { name: 'scripted', call: (r) => (requests.push(r), Promise.resolve(result)) },
    session: { turns: () => [TURN_A, TURN_B], labels: () => ['A', 'B'] },
    stream: { append: (e) => (events.push(e), Promise.resolve()) },
    candidates: { hand: (record) => (handed.push(record), Promise.resolve()) },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  return { extractor, requests, events, handed, lines };
}

/** A log line without the logger's own fields `time` and `service`. */
function withoutTimeAndService(line: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(line).filter(([name]) => name !== 'time' && name !== 'service'),
  );
}

describe('a contract violation drops its element only (ADR 0004, addendum 2026-10-26)', () => {
  it('emits the valid Claim of the answer, drops the quote from the context Turn and does not repeat', async () => {
    const { extractor, requests, events, lines } = run({
      claims: [FROM_CONTEXT, GOOD],
      candidates: [],
    });
    await extractor.call({ turn: TURN_B, segments: [B1], final: false, at: 70 });
    expect(requests).toHaveLength(1);
    expect(events).toMatchObject([{ claim: { id: 'c-01', verbatim: GOOD.verbatim } }]);
    expect(extractor.counters.dropped).toBe(1);
    expect(extractor.counters.schemaErrors).toBe(0);
    const dropped = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l['event'] === 'claim_extractor.dropped');
    expect(dropped).toHaveLength(1);
    const fields = withoutTimeAndService(dropped[0]);
    expect(fields).toEqual({
      event: 'claim_extractor.dropped',
      sessionId: SESSION,
      turnId: 't-002',
      reason: 'wortlaut',
    });
    expect(lines.join('\n')).not.toContain('Ueju');
  });

  it('counts an answer whose every element is dropped as empty: no event, no lost call, no repeat', async () => {
    const { extractor, requests, events } = run({ claims: [FROM_CONTEXT], candidates: [] });
    await extractor.call({ turn: TURN_B, segments: [B1], final: false, at: 70 });
    expect(requests).toHaveLength(1);
    expect(events).toEqual([]);
    expect(extractor.counters).toMatchObject({ dropped: 1, schemaErrors: 0 });
  });
});

describe('an element that passes the contract check but cannot become a record is dropped and counted (owner A7, A8)', () => {
  const droppedLines = (lines: readonly string[]) =>
    lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l['event'] === 'claim_extractor.dropped');
  const droppedLine = {
    event: 'claim_extractor.dropped',
    sessionId: SESSION,
    turnId: 't-002',
    reason: INVALID_REASON,
  };

  it('drops a Claim whose Claim event would break the contract before its id, counts and logs it without text (A8)', async () => {
    // speaker over the 200 characters of the Claim event contract (claim-event.ts: `speaker: z.string().min(1).max(200)`)
    const invalid = {
      ...GOOD,
      speaker: 'x'.repeat(201),
      sentence: 'Hukgl Suubayy behauptet etwas.',
    };
    const { extractor, requests, events, lines } = run({ claims: [invalid, GOOD], candidates: [] });
    await extractor.call({ turn: TURN_B, segments: [B1], final: false, at: 70 });
    expect(requests).toHaveLength(1);
    expect(events).toMatchObject([{ claim: { id: 'c-01', speaker: GOOD.speaker } }]);
    expect(extractor.counters).toMatchObject({
      dropped: 1,
      schemaErrors: 0,
      repeats: 0,
      duplicates: 0,
    });
    expect(droppedLines(lines)).toMatchObject([droppedLine]);
    expect(lines.join('\n')).not.toContain('xxxxxxxx');
    expect(lines.join('\n')).not.toContain('etwas');
  });

  it('drops a Candidate over the bounds of the Claim event before its id and numbers the next one k-01 (A7)', async () => {
    const base = {
      speaker: 'Hukgl Suubayy',
      verbatim: 'Rob qutc baoj 2017',
      segmentIds: ['s-0002'],
      reason: 'kern_unklar',
      note: 'Notiz',
    };
    // speaker: 200 code points, 400 UTF-16 code units (the contract counts code points, header)
    const atBounds = {
      ...base,
      speaker: '\u{1F600}'.repeat(200),
      verbatim: 'v'.repeat(1000),
      note: 'n'.repeat(1000),
    };
    const over = [
      { ...base, speaker: 's'.repeat(201) },
      { ...base, verbatim: 'v'.repeat(1001) },
      { ...base, note: 'n'.repeat(1001) },
    ];
    const { extractor, events, handed, lines } = run({
      claims: [],
      candidates: [...over, atBounds, base],
    });
    await extractor.call({ turn: TURN_B, segments: [B1], final: false, at: 70 });
    expect(handed).toEqual([
      { id: 'k-01', turnId: 't-002', ...atBounds },
      { id: 'k-02', turnId: 't-002', ...base },
    ]);
    expect(events).toEqual([]);
    expect(extractor.counters).toMatchObject({ dropped: 3, schemaErrors: 0 });
    expect(droppedLines(lines)).toMatchObject([droppedLine, droppedLine, droppedLine]);
    const created = lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l['event'] === 'candidate.created');
    expect(created.map((l) => l['candidateId'])).toEqual(['k-01', 'k-02']);
    expect(lines.join('\n')).not.toMatch(/sss|vvv|nnn|\u{1F600}/u);
  });
});
