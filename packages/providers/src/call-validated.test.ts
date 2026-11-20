// Stage 1, issue #29 (T4), Task 1: callValidated, one model call with validation and at most one repeat
// (docs/spec/erkennung-modellrollen.md 4.2; ADR 0004: schema enforcement is the adapter's, validation is ours), AC8
// to AC10 for the whole answer, and the deadline of the ticket's Assumptions (15 s for both attempts together).
// Reference: evals/src/harness/adapters/base.py call_validated. Element-wise contract violations (ADR 0004, addendum
// 2026-10-26) are in call-validated.elements.test.ts, as decided (gate 1, owner 2026-11-03, question 1: "Je Element").
//
// Public interface these tests define (built in Task 1; the port T4b, T5, T6 and T7 use unchanged, AC18):
//   src/model-adapter.ts
//     export type ModelRole = 'claim_extractor' | 'resolver' | 'verifier' | 'topic_extractor';
//     export type Thinking = 'off' | 'low';
//     export interface ContentBlock { readonly kind: string; readonly text: string; readonly cache: boolean;
//                                     readonly system: boolean }
//     export interface ModelRequest {
//       readonly role: ModelRole; readonly sessionId: string; readonly model: string; readonly thinking: Thinking;
//       readonly blocks: readonly ContentBlock[];          // ordered content blocks with cache and system marks
//       readonly schema: Readonly<Record<string, unknown>>; readonly schemaName: string;   // strict JSON Schema
//       readonly maxTokens: number;
//       readonly deadline: number;                          // epoch milliseconds (Date.now()) by which to return
//       readonly signal: AbortSignal;                        // the caller's abort
//     }
//     export interface Usage { readonly input: number; readonly cacheWrite: number; readonly cacheRead: number;
//                              readonly output: number; readonly thinking: number }
//     export type AdapterErrorKind = 'fatal' | 'retryable' | 'timeout';
//     export type AdapterResult =
//       | { readonly ok: true; readonly text: string; readonly usage: Usage; readonly latencySeconds: number;
//           readonly model: string; readonly adapter: string }
//       | { readonly ok: false; readonly error: { readonly kind: AdapterErrorKind; readonly message: string };
//           readonly latencySeconds: number; readonly model: string; readonly adapter: string };
//     export interface ModelAdapter { readonly name: string; call(request: ModelRequest): Promise<AdapterResult> }
//   src/call-validated.ts
//     export interface ContractViolation { readonly path: string; readonly message: string; readonly reason?: string }
//       // path like the harness: `$.claims[0].verbatim`
//     export function callValidated<T>(adapter: ModelAdapter, request: ModelRequest, options: {
//       readonly schema: z.ZodType<T>;                                    // the whole answer
//       readonly contract?: (data: T) => readonly ContractViolation[];
//       readonly elementLists?: readonly string[];                         // see call-validated.elements.test.ts
//       readonly retries?: number;                                         // schema_retries, default 1
//     }): Promise<CallOutcome<T>>
//     export type CallOutcome<T> =
//       | { readonly kind: 'valid'; readonly data: T; readonly attempts: number; readonly latencySeconds: number;
//           readonly dropped: readonly { readonly list: string; readonly index: number;
//                                        readonly violations: readonly ContractViolation[] }[] }
//       | { readonly kind: 'schema_failure' | 'adapter_error' | 'timeout' | 'fatal'; readonly attempts: number;
//           readonly latencySeconds: number };
//   Never rejects for an answer or an adapter error; `attempts` counts the adapter calls it started.
// The repeat (spec 4.2, AC9): the same request with exactly one block appended at the end, kind `retry`, no cache and
// no system mark, whose text lists the violations; every earlier block and field stays as it was. "Lists the
// violations" is checked by the field each violation names. The kind of a failed call is the kind of its last
// attempt (an answer that fails validation: schema_failure). latencySeconds: the sum over the attempts, as the
// harness sums them for the simulated clock; a call lost at the deadline reports the time from its start to the
// deadline (deadline minus Date.now() at the call, in seconds; gate 1, owner 2026-11-03, question 11: "15 s bis zur Frist").
// Mocks only at the boundary: a scripted adapter (the LLM boundary); time by fake timers.
import { callValidated } from './call-validated.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AdapterResult, ContentBlock, ModelAdapter, ModelRequest } from './model-adapter.ts';

const DEADLINE_MS = 15_000;

const Answer = z.strictObject({
  claims: z.array(
    z.strictObject({
      verbatim: z.string(),
      type: z.enum(['zahl', 'ereignis', 'zitat', 'ursache']),
      refersTo: z.string().nullable(),
    }),
  ),
  candidates: z.array(z.strictObject({ verbatim: z.string() })),
});

const VALID = JSON.stringify({
  claims: [{ verbatim: 'baoj 2017 os Fiydulvuv', type: 'zahl', refersTo: null }],
  candidates: [],
});
const VALID_TOO = JSON.stringify({ claims: [], candidates: [{ verbatim: 'das stimmt so nicht' }] });

const BLOCKS: readonly ContentBlock[] = [
  { kind: 'prefix', text: 'Anweisung', cache: true, system: true },
  { kind: 'turn', text: 'Turn-Block 1 · A', cache: true, system: false },
  { kind: 'final', text: 'Schluss', cache: false, system: false },
];

function request(signal: AbortSignal = new AbortController().signal): ModelRequest {
  return {
    role: 'claim_extractor',
    sessionId: '29a0c0de-0000-4000-8000-000000000011',
    model: 'claude-haiku-5-5',
    thinking: 'off',
    blocks: BLOCKS,
    schema: { type: 'object' },
    schemaName: 'claim_extractor_output',
    maxTokens: 2048,
    deadline: Date.now() + DEADLINE_MS,
    signal,
  };
}

function text(answer: string, latencySeconds = 0.5): AdapterResult {
  return {
    ok: true,
    text: answer,
    usage: { input: 10, cacheWrite: 0, cacheRead: 0, output: 5, thinking: 0 },
    latencySeconds,
    model: 'claude-haiku-5-5',
    adapter: 'scripted',
  };
}

function failure(kind: 'fatal' | 'retryable' | 'timeout', latencySeconds = 0.25): AdapterResult {
  return {
    ok: false,
    error: { kind, message: `scripted ${kind}` },
    latencySeconds,
    model: 'claude-haiku-5-5',
    adapter: 'scripted',
  };
}

/** An adapter that answers from a script, one entry per call, and keeps every request it got. */
function scripted(...results: AdapterResult[]): ModelAdapter & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    name: 'scripted',
    requests,
    call(req) {
      requests.push(req);
      const next = results[requests.length - 1];
      if (next === undefined) throw new Error(`unexpected call ${requests.length}`);
      return Promise.resolve(next);
    },
  };
}

/** An adapter whose calls never settle on their own; it keeps every request (and so every signal) it got. */
function hanging(): ModelAdapter & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    name: 'hanging',
    requests,
    call(req) {
      requests.push(req);
      return new Promise<AdapterResult>(() => undefined);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-03T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('callValidated accepts a valid first answer (AC8)', () => {
  it('returns the parsed answer after one call, with the request passed unchanged', async () => {
    const adapter = scripted(text(VALID));
    const req = request();
    const outcome = await callValidated(adapter, req, { schema: Answer });
    expect(outcome.kind).toBe('valid');
    if (outcome.kind === 'valid') {
      expect(outcome.data).toEqual(JSON.parse(VALID));
      expect(outcome.attempts).toBe(1);
      expect(outcome.dropped).toEqual([]);
    }
    expect(adapter.requests).toHaveLength(1);
    const [sent] = adapter.requests;
    expect(sent?.blocks).toEqual(BLOCKS);
    for (const field of ['role', 'sessionId', 'model', 'thinking', 'schema', 'schemaName', 'maxTokens', 'deadline'] as const) {
      expect(sent?.[field]).toEqual(req[field]);
    }
  });

  it('reports the latency the adapter reported', async () => {
    const outcome = await callValidated(scripted(text(VALID, 1.75)), request(), { schema: Answer });
    expect(outcome.latencySeconds).toBe(1.75);
  });

  it('accepts an answer whose contract check finds nothing', async () => {
    const contract = vi.fn(() => []);
    const outcome = await callValidated(scripted(text(VALID)), request(), { schema: Answer, contract });
    expect(outcome.kind).toBe('valid');
    expect(contract).toHaveBeenCalledWith(JSON.parse(VALID));
  });
});

// One invalid class per row, each the only defect (.claude/skills/test-design: each invalid class exactly once).
const UNUSABLE: readonly (readonly [string, AdapterResult, string])[] = [
  ['an answer that is no JSON', text('Hier sind die Behauptungen: keine.'), 'JSON'],
  ['JSON that is no object', text('[]'), ''],
  [
    'an unknown field (discarded, the diagnostic field of spec 9)',
    text(JSON.stringify({ claims: [], candidates: [], discarded: [] })),
    'discarded',
  ],
  ['a missing field', text(JSON.stringify({ claims: [] })), 'candidates'],
  [
    'a value outside an enum',
    text(JSON.stringify({ claims: [{ verbatim: 'x', type: 'meinung', refersTo: null }], candidates: [] })),
    'type',
  ],
  [
    'refersTo neither string nor null',
    text(JSON.stringify({ claims: [{ verbatim: 'x', type: 'zahl', refersTo: 3 }], candidates: [] })),
    'refersTo',
  ],
  ['a retryable adapter error', failure('retryable'), ''],
  ['a timeout error of the adapter', failure('timeout'), ''],
];

describe('callValidated repeats an unusable answer exactly once (AC9)', () => {
  it.each(UNUSABLE)('after %s, repeats the same request with one retry block appended', async (_, first) => {
    const adapter = scripted(first, text(VALID_TOO));
    const req = request();
    await callValidated(adapter, req, { schema: Answer });
    expect(adapter.requests).toHaveLength(2);
    const [one, two] = adapter.requests;
    expect(one?.blocks).toEqual(BLOCKS);
    expect(two?.blocks).toHaveLength(BLOCKS.length + 1);
    expect(two?.blocks.slice(0, BLOCKS.length)).toEqual(BLOCKS);
    const appended = two?.blocks.at(-1);
    expect(appended).toMatchObject({ kind: 'retry', cache: false, system: false });
    expect(appended?.text.trim()).not.toBe('');
    for (const field of ['role', 'sessionId', 'model', 'thinking', 'schema', 'schemaName', 'maxTokens', 'deadline'] as const) {
      expect(two?.[field]).toEqual(req[field]);
    }
    expect(req.blocks).toHaveLength(BLOCKS.length);
  });

  it.each(UNUSABLE.filter(([, , named]) => named !== ''))(
    'after %s, the retry block names %s',
    async (_, first, named) => {
      const adapter = scripted(first, text(VALID_TOO));
      await callValidated(adapter, request(), { schema: Answer });
      expect(adapter.requests[1]?.blocks.at(-1)?.text).toContain(named);
    },
  );

  it('processes a valid answer to the repeat like a first valid answer', async () => {
    const adapter = scripted(text('kein JSON', 1.25), text(VALID_TOO, 0.75));
    const outcome = await callValidated(adapter, request(), { schema: Answer });
    expect(outcome).toMatchObject({ kind: 'valid', attempts: 2, latencySeconds: 2, dropped: [] });
    if (outcome.kind === 'valid') expect(outcome.data).toEqual(JSON.parse(VALID_TOO));
  });

  it('repeats an answer whose contract check fails outside the element lists', async () => {
    const contract = vi
      .fn()
      .mockReturnValueOnce([{ path: '$', message: 'die Antwort widerspricht sich' }])
      .mockReturnValueOnce([]);
    const adapter = scripted(text(VALID), text(VALID));
    const outcome = await callValidated(adapter, request(), { schema: Answer, contract });
    expect(adapter.requests).toHaveLength(2);
    expect(outcome.kind).toBe('valid');
  });

  it('does not repeat with retries 0 (schema_retries is configuration, spec 8)', async () => {
    const adapter = scripted(text('kein JSON'));
    const outcome = await callValidated(adapter, request(), { schema: Answer, retries: 0 });
    expect(adapter.requests).toHaveLength(1);
    expect(outcome).toMatchObject({ kind: 'schema_failure', attempts: 1 });
  });
});

describe('callValidated gives up after the repeat (AC10)', () => {
  it('reports a schema failure after two unusable answers and never calls a third time', async () => {
    const adapter = scripted(text('kein JSON', 1), text('immer noch kein JSON', 1.5));
    const outcome = await callValidated(adapter, request(), { schema: Answer });
    expect(outcome).toEqual({ kind: 'schema_failure', attempts: 2, latencySeconds: 2.5 });
    expect(adapter.requests).toHaveLength(2);
  });

  it('reports an adapter error after two adapter errors', async () => {
    const outcome = await callValidated(scripted(failure('retryable'), failure('retryable')), request(), {
      schema: Answer,
    });
    expect(outcome).toMatchObject({ kind: 'adapter_error', attempts: 2 });
  });

  it('reports the kind of the last attempt: an unusable answer, then an adapter error', async () => {
    const outcome = await callValidated(scripted(text('kein JSON'), failure('retryable')), request(), {
      schema: Answer,
    });
    expect(outcome).toMatchObject({ kind: 'adapter_error', attempts: 2 });
  });

  it('reports a timeout when the repeat ends in a timeout error of the adapter', async () => {
    const outcome = await callValidated(scripted(text('kein JSON'), failure('timeout')), request(), {
      schema: Answer,
    });
    expect(outcome).toMatchObject({ kind: 'timeout', attempts: 2 });
  });
});

describe('callValidated never repeats a fatal adapter error (AC18: three kinds)', () => {
  it('reports fatal after one call', async () => {
    const adapter = scripted(failure('fatal'));
    const outcome = await callValidated(adapter, request(), { schema: Answer });
    expect(outcome).toMatchObject({ kind: 'fatal', attempts: 1 });
    expect(adapter.requests).toHaveLength(1);
  });

  it('reports fatal when the repeat fails fatally', async () => {
    const outcome = await callValidated(scripted(text('kein JSON'), failure('fatal')), request(), {
      schema: Answer,
    });
    expect(outcome).toMatchObject({ kind: 'fatal', attempts: 2 });
  });
});

describe('callValidated bounds both attempts together by the deadline (Assumptions: 15 s)', () => {
  it('aborts the attempt still running at the deadline and reports a timeout without a repeat', async () => {
    const adapter = hanging();
    const pending = callValidated(adapter, request(), { schema: Answer });
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(adapter.requests[0]?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const outcome = await pending;
    // A call lost at the deadline took the time up to the deadline (gate 1, owner 2026-11-03, question 11: "15 s bis zur Frist, wie im Harness"): the scheduler's
    // lane stays busy that long, as the harness's busy_until = t + latency does.
    expect(outcome).toMatchObject({ kind: 'timeout', attempts: 1, latencySeconds: 15 });
    expect(adapter.requests[0]?.signal.aborted).toBe(true);
    expect(adapter.requests).toHaveLength(1);
  });

  it('aborts the repeat at the deadline of the first attempt, not 15 s after the repeat started', async () => {
    const requests: ModelRequest[] = [];
    const adapter: ModelAdapter = {
      name: 'slow-then-hanging',
      call(req) {
        requests.push(req);
        if (requests.length === 1) {
          return new Promise<AdapterResult>((resolve) => {
            setTimeout(() => {
              resolve(text('kein JSON', 10));
            }, 10_000);
          });
        }
        return new Promise<AdapterResult>(() => undefined);
      },
    };
    const pending = callValidated(adapter, request(), { schema: Answer });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 10_000);
    const outcome = await pending;
    expect(outcome).toMatchObject({ kind: 'timeout', attempts: 2, latencySeconds: 15 });
    expect(requests[1]?.signal.aborted).toBe(true);
  });

  it('hands the adapter a signal that aborts when the caller aborts', async () => {
    const caller = new AbortController();
    const adapter = hanging();
    const pending = callValidated(adapter, request(caller.signal), { schema: Answer });
    await vi.advanceTimersByTimeAsync(1_000);
    caller.abort();
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    await pending;
    expect(adapter.requests[0]?.signal.aborted).toBe(true);
    expect(adapter.requests).toHaveLength(1);
  });
});
