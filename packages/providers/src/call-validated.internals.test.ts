// Stage 1, issue #29 (T4), Task 1: internals of callValidated the frozen tests leave open (review of task 1,
// findings B2, W1, W2, W7, W8, N3, N4, N5). Interface: header of call-validated.test.ts. Sources per case below.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { callValidated, type ContractViolation } from './call-validated.ts';
import type { AdapterResult, ModelAdapter, ModelRequest } from './model-adapter.ts';

const Answer = z.strictObject({
  claims: z.array(z.strictObject({ verbatim: z.string() })),
  candidates: z.array(z.strictObject({ verbatim: z.string() })),
});

const EMPTY = JSON.stringify({ claims: [], candidates: [] });
const ONE = JSON.stringify({ claims: [{ verbatim: 'seit 2017' }], candidates: [] });

function request(over: Partial<ModelRequest> = {}): ModelRequest {
  return {
    role: 'claim_extractor',
    sessionId: '29a0c0de-0000-4000-8000-000000000031',
    model: 'claude-haiku-5-5',
    thinking: 'off',
    blocks: [{ kind: 'prefix', text: 'Anweisung', cache: true, system: true }],
    schema: { type: 'object' },
    schemaName: 'claim_extractor_output',
    maxTokens: 2048,
    deadline: Date.now() + 15_000,
    signal: new AbortController().signal,
    ...over,
  };
}

function text(answer: string, latencySeconds = 0.5): AdapterResult {
  return {
    ok: true,
    text: answer,
    usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1, thinking: 0 },
    latencySeconds,
    model: 'claude-haiku-5-5',
    adapter: 'scripted',
  };
}

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

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-04T10:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('callValidated checks the answer again after dropping elements (review B2)', () => {
  // q1 of gate 1 (2026-11-03): "repeat only for no JSON, schema violation or adapter error"; an answer that
  // breaks its schema once the violating elements are gone is a schema violation.
  const AtLeastOne = z.strictObject({
    claims: z.array(z.strictObject({ verbatim: z.string() })).min(1),
    candidates: z.array(z.strictObject({ verbatim: z.string() })),
  });
  const firstClaimViolates = (data: z.infer<typeof AtLeastOne>): ContractViolation[] =>
    data.claims[0]?.verbatim === 'aus dem Kontext'
      ? [{ path: '$.claims[0].verbatim', message: 'nicht in den Turn-Blöcken' }]
      : [];

  it('repeats an answer whose remaining elements break the schema, and never returns data the schema rejects', async () => {
    const adapter = scripted(
      text(JSON.stringify({ claims: [{ verbatim: 'aus dem Kontext' }], candidates: [] })),
      text(ONE),
    );
    const outcome = await callValidated(adapter, request(), {
      schema: AtLeastOne,
      contract: firstClaimViolates,
      elementLists: ['claims', 'candidates'],
    });
    expect(adapter.requests).toHaveLength(2);
    expect(outcome).toMatchObject({ kind: 'valid', attempts: 2, dropped: [] });
    if (outcome.kind === 'valid') expect(AtLeastOne.safeParse(outcome.data).success).toBe(true);
  });
});

describe('callValidated counts the reported latency against the deadline (review W1)', () => {
  // AC10: "the 15 s deadline for both attempts together passes, the call is lost ... a call lost at the deadline
  // counts 15 s of latency"; the harness compares the summed latency with the timeout
  // (evals/src/harness/pipeline.py, call_verifier: `timed_out = outcome.latency > timeout`).
  it('reports a timeout of 15 s when the two attempts report 10 s each, although the second answer is valid', async () => {
    const adapter = scripted(text('kein JSON', 10), text(EMPTY, 10));
    const outcome = await callValidated(adapter, request(), { schema: Answer });
    expect(outcome).toEqual({ kind: 'timeout', attempts: 2, latencySeconds: 15 });
  });

  it('accepts a valid answer whose attempts report exactly the 15 s of the deadline together', async () => {
    const adapter = scripted(text('kein JSON', 10), text(EMPTY, 5));
    const outcome = await callValidated(adapter, request(), { schema: Answer });
    expect(outcome).toMatchObject({ kind: 'valid', attempts: 2, latencySeconds: 15 });
  });

  it('does not start a repeat once the first attempt reported more than the deadline', async () => {
    const adapter = scripted(text('kein JSON', 16));
    const outcome = await callValidated(adapter, request(), { schema: Answer });
    expect(outcome).toEqual({ kind: 'timeout', attempts: 1, latencySeconds: 15 });
    expect(adapter.requests).toHaveLength(1);
  });
});

describe('callValidated repeats a violation that names no element of the answer (review W7)', () => {
  // AC9: "a contract violation that belongs to no single Claim or Candidate ... lead[s] to exactly one repeat".
  // Deviation from the harness, whose split_elements ignores such a violation.
  it('repeats when the contract names an index the list does not have', async () => {
    const phantom = (): ContractViolation[] => [
      { path: '$.claims[5].verbatim', message: 'kein Element' },
    ];
    const adapter = scripted(text(ONE), text(ONE));
    const outcome = await callValidated(adapter, request(), {
      schema: Answer,
      contract: phantom,
      elementLists: ['claims', 'candidates'],
    });
    expect(adapter.requests).toHaveLength(2);
    expect(outcome).toEqual({ kind: 'schema_failure', attempts: 2, latencySeconds: 1 });
  });

  it('repeats when the contract names the index equal to the length of the list', async () => {
    // The boundary: with one element, `$.claims[1]` is the first index past the end.
    const pastEnd = (): ContractViolation[] => [
      { path: '$.claims[1].verbatim', message: 'kein Element' },
    ];
    const adapter = scripted(text(ONE), text(ONE));
    const outcome = await callValidated(adapter, request(), {
      schema: Answer,
      contract: pastEnd,
      elementLists: ['claims', 'candidates'],
    });
    expect(adapter.requests).toHaveLength(2);
    expect(outcome).toEqual({ kind: 'schema_failure', attempts: 2, latencySeconds: 1 });
  });
});

describe('callValidated repeats a violation in a list outside elementLists (review N3)', () => {
  // README, Pitfalls: "A repeat only for an answer unusable as a whole: no JSON, a schema violation ..., a contract
  // violation outside `elementLists`". The Candidate exists, but only `claims` is listed: nothing may be dropped
  // and the answer must not pass as valid.
  it('repeats when the contract names an existing element of a list that is not listed', async () => {
    const candidateViolates = (): ContractViolation[] => [
      { path: '$.candidates[0].verbatim', message: 'nicht in den Turn-Blöcken' },
    ];
    const answer = JSON.stringify({ claims: [], candidates: [{ verbatim: 'seit 2017' }] });
    const adapter = scripted(text(answer), text(answer));
    const outcome = await callValidated(adapter, request(), {
      schema: Answer,
      contract: candidateViolates,
      elementLists: ['claims'],
    });
    expect(adapter.requests).toHaveLength(2);
    expect(outcome).toEqual({ kind: 'schema_failure', attempts: 2, latencySeconds: 1 });
  });
});

describe('callValidated keeps the fields outside the element lists when it drops an element (review N4)', () => {
  // README, Pitfalls: "A contract violation of one element of a listed list (path `$.<list>[<i>]…`) drops only that
  // element, never repeated". A role with a further field (Topic Extractor, T6) keeps it.
  const WithTopic = z.strictObject({
    topic: z.string(),
    claims: z.array(z.strictObject({ verbatim: z.string() })),
    candidates: z.array(z.strictObject({ verbatim: z.string() })),
  });

  it('returns the answer without the element and with its other fields, without a repeat', async () => {
    const firstClaimViolates = (): ContractViolation[] => [
      { path: '$.claims[0].verbatim', message: 'nicht in den Turn-Blöcken' },
    ];
    const adapter = scripted(
      text(
        JSON.stringify({
          topic: 'Rente',
          claims: [{ verbatim: 'aus dem Kontext' }, { verbatim: 'seit 2017' }],
          candidates: [],
        }),
      ),
    );
    const outcome = await callValidated(adapter, request(), {
      schema: WithTopic,
      contract: firstClaimViolates,
      elementLists: ['claims', 'candidates'],
    });
    expect(adapter.requests).toHaveLength(1);
    expect(outcome).toEqual({
      kind: 'valid',
      data: { topic: 'Rente', claims: [{ verbatim: 'seit 2017' }], candidates: [] },
      attempts: 1,
      latencySeconds: 0.5,
      dropped: [
        {
          list: 'claims',
          index: 0,
          violations: [{ path: '$.claims[0].verbatim', message: 'nicht in den Turn-Blöcken' }],
        },
      ],
    });
  });
});

describe('callValidated words the retry block like the harness (review N5)', () => {
  // evals/src/harness/adapters/base.py call_validated:
  //   note = ("Deine letzte Antwort verletzte das Ausgabeschema oder den Vertrag:\n- "
  //           + "\n- ".join(errors[:10]) + "\nAntworte erneut, vollständig und nur mit gültigem JSON.")
  it('names the first ten of eleven violations, one per line, between the two sentences of the harness', async () => {
    const eleven = (): ContractViolation[] =>
      Array.from({ length: 11 }, (_unused, index) => ({
        path: '$',
        message: `Verstoß ${String(index + 1)}`,
      }));
    const adapter = scripted(text(ONE), text(ONE));
    await callValidated(adapter, request(), { schema: Answer, contract: eleven });
    const lines = Array.from(
      { length: 10 },
      (_unused, index) => `- $: Verstoß ${String(index + 1)}`,
    );
    expect(adapter.requests[1]?.blocks.at(-1)?.text).toBe(
      [
        'Deine letzte Antwort verletzte das Ausgabeschema oder den Vertrag:',
        ...lines,
        'Antworte erneut, vollständig und nur mit gültigem JSON.',
      ].join('\n'),
    );
  });
});

describe('callValidated starts no attempt after the deadline or an abort of the caller (review W8)', () => {
  // AC10: a call past the deadline is lost; a deadline already passed or an abort before the start must not
  // produce a billable call (T7) or a valid answer.
  it('reports a timeout without calling the adapter when the deadline has passed', async () => {
    const adapter = scripted(text(EMPTY));
    const outcome = await callValidated(adapter, request({ deadline: Date.now() - 1_000 }), {
      schema: Answer,
    });
    expect(adapter.requests).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'timeout', attempts: 0, latencySeconds: 0 });
  });

  it('reports a timeout without calling the adapter when the deadline is now', async () => {
    const adapter = scripted(text(EMPTY));
    const outcome = await callValidated(adapter, request({ deadline: Date.now() }), {
      schema: Answer,
    });
    expect(adapter.requests).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'timeout', attempts: 0, latencySeconds: 0 });
  });

  it('ends as fatal without calling the adapter when the caller has already aborted', async () => {
    const caller = new AbortController();
    caller.abort();
    const adapter = scripted(text(EMPTY));
    const outcome = await callValidated(adapter, request({ signal: caller.signal }), {
      schema: Answer,
    });
    expect(adapter.requests).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'fatal', attempts: 0, latencySeconds: 0 });
  });
});

describe('callValidated reads an answer like the harness (review W2)', () => {
  // evals/src/harness/adapters/base.py parse_json: strips a Markdown code fence and a leading `json`.
  it.each([
    ['a fence with json', '```json\n' + EMPTY + '\n```'],
    ['a bare fence', '```\n' + EMPTY + '\n```'],
    ['surrounding whitespace', '\n  ' + EMPTY + '  \n'],
  ])('accepts an answer in %s without a repeat', async (_, answer) => {
    const adapter = scripted(text(answer));
    const outcome = await callValidated(adapter, request(), { schema: Answer });
    expect(outcome).toMatchObject({
      kind: 'valid',
      attempts: 1,
      data: { claims: [], candidates: [] },
    });
  });
});

describe('callValidated does not repeat a call the caller aborted (review W2)', () => {
  it('ends with the kind of the attempt when the caller aborted during it', async () => {
    const caller = new AbortController();
    const requests: ModelRequest[] = [];
    const adapter: ModelAdapter = {
      name: 'aborted-during-call',
      call(req) {
        requests.push(req);
        caller.abort();
        return Promise.resolve(text('kein JSON'));
      },
    };
    const outcome = await callValidated(adapter, request({ signal: caller.signal }), {
      schema: Answer,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(outcome).toEqual({ kind: 'schema_failure', attempts: 1, latencySeconds: 0.5 });
  });
});
