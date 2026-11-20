// Stage 1, issue #29 (T4), Task 1: a contract violation drops only its element (ADR 0004, addendum 2026-10-26;
// docs/spec/erkennung-modellrollen.md 4.2 as amended that day; reference evals/src/harness/adapters/base.py
// call_validated with element_lists and split_elements, the arm v2-pruef-sonnet-b runs with contract_scope "element").
//
// Decided (gate 1, owner 2026-11-03, question 1: "Je Element; AC9/AC10 auf „kein JSON, Schemaverstoß oder Adapterfehler“ schärfen"),
// following the ADR addendum of 2026-10-26 (Marco: "Ein Verstoß verwirft nur die betroffene Behauptung oder den
// betroffenen Candidate; die gültigen Elemente derselben Antwort gelten ... Eine Wiederholung gibt es nur noch, wenn die
// Antwort als Ganzes unbrauchbar ist"), as the harness the TypeScript mirrors does. This file pins that.
//
// Interface: call-validated.test.ts (header). With `elementLists`, a contract violation whose path starts with
// `$.<list>[<index>]` for a listed list drops that element: the answer is valid without it, `dropped` names the list,
// the index in the answer and the element's violations, and there is no repeat, also when every element is dropped
// (the answer then counts as empty). A schema violation of any element is a violation of the whole answer (repeat).
import { callValidated, type ContractViolation } from './call-validated.ts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AdapterResult, ModelAdapter, ModelRequest } from './model-adapter.ts';

const Answer = z.strictObject({
  claims: z.array(z.strictObject({ verbatim: z.string(), type: z.enum(['zahl', 'ereignis']) })),
  candidates: z.array(z.strictObject({ verbatim: z.string() })),
});
type Answer = z.infer<typeof Answer>;

const LISTS = ['claims', 'candidates'] as const;

/** Contract after the harness: a verbatim containing "Kontext" is not in the Turn blocks. */
function contract(data: Answer): ContractViolation[] {
  const out: ContractViolation[] = [];
  for (const list of LISTS) {
    data[list].forEach((element, i) => {
      if (element.verbatim.includes('Kontext')) {
        out.push({ path: `$.${list}[${i}].verbatim`, message: 'Wortlaut steht nicht in den Turn-Blöcken', reason: 'wortlaut' });
      }
    });
  }
  return out;
}

function request(): ModelRequest {
  return {
    role: 'claim_extractor',
    sessionId: '29a0c0de-0000-4000-8000-000000000012',
    model: 'claude-haiku-5-5',
    thinking: 'off',
    blocks: [{ kind: 'prefix', text: 'Anweisung', cache: true, system: true }],
    schema: { type: 'object' },
    schemaName: 'claim_extractor_output',
    maxTokens: 2048,
    deadline: Date.now() + 15_000,
    signal: new AbortController().signal,
  };
}

function scripted(...answers: unknown[]): ModelAdapter & { calls: number } {
  const adapter = {
    name: 'scripted',
    calls: 0,
    call(): Promise<AdapterResult> {
      const answer = answers[adapter.calls];
      adapter.calls += 1;
      return Promise.resolve({
        ok: true,
        text: JSON.stringify(answer),
        usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1, thinking: 0 },
        latencySeconds: 0.5,
        model: 'claude-haiku-5-5',
        adapter: 'scripted',
      });
    },
  };
  return adapter;
}

const GOOD = { verbatim: 'baoj 2017 os Fiydulvuv', type: 'zahl' };
const FROM_CONTEXT = { verbatim: 'ein Satz aus dem Kontext', type: 'ereignis' };

describe('callValidated drops an element that violates the contract (ADR 0004, addendum 2026-10-26)', () => {
  it('keeps the valid Claims of the answer, drops the violating one and does not repeat', async () => {
    const adapter = scripted({ claims: [GOOD, FROM_CONTEXT, GOOD], candidates: [] });
    const outcome = await callValidated(adapter, request(), { schema: Answer, contract, elementLists: LISTS });
    expect(adapter.calls).toBe(1);
    expect(outcome.kind).toBe('valid');
    if (outcome.kind !== 'valid') return;
    expect(outcome.data.claims).toEqual([GOOD, GOOD]);
    expect(outcome.dropped).toHaveLength(1);
    expect(outcome.dropped[0]).toMatchObject({ list: 'claims', index: 1 });
    expect(outcome.dropped[0]?.violations.map((v) => v.path)).toEqual(['$.claims[1].verbatim']);
  });

  it('drops a violating Candidate and keeps the Claims', async () => {
    const adapter = scripted({ claims: [GOOD], candidates: [{ verbatim: 'aus dem Kontext' }] });
    const outcome = await callValidated(adapter, request(), { schema: Answer, contract, elementLists: LISTS });
    expect(adapter.calls).toBe(1);
    expect(outcome).toMatchObject({ kind: 'valid', data: { claims: [GOOD], candidates: [] } });
    if (outcome.kind === 'valid') expect(outcome.dropped).toMatchObject([{ list: 'candidates', index: 0 }]);
  });

  it('counts an answer whose every element violates the contract as empty, without a repeat', async () => {
    const adapter = scripted({ claims: [FROM_CONTEXT], candidates: [{ verbatim: 'Kontext' }] });
    const outcome = await callValidated(adapter, request(), { schema: Answer, contract, elementLists: LISTS });
    expect(adapter.calls).toBe(1);
    expect(outcome).toMatchObject({ kind: 'valid', attempts: 1, data: { claims: [], candidates: [] } });
    if (outcome.kind === 'valid') expect(outcome.dropped).toHaveLength(2);
  });

  it('still repeats an answer with a schema violation in one element (the whole answer is unusable)', async () => {
    const adapter = scripted(
      { claims: [GOOD, { verbatim: 'x', type: 'meinung' }], candidates: [] },
      { claims: [GOOD], candidates: [] },
    );
    const outcome = await callValidated(adapter, request(), { schema: Answer, contract, elementLists: LISTS });
    expect(adapter.calls).toBe(2);
    expect(outcome).toMatchObject({ kind: 'valid', attempts: 2, data: { claims: [GOOD] } });
  });

  it('repeats an answer whose contract check fails outside the element lists', async () => {
    const outside = (): ContractViolation[] => [{ path: '$', message: 'Hülle verletzt' }];
    const adapter = scripted({ claims: [GOOD], candidates: [] }, { claims: [GOOD], candidates: [] });
    const outcome = await callValidated(adapter, request(), {
      schema: Answer,
      contract: outside,
      elementLists: LISTS,
    });
    expect(adapter.calls).toBe(2);
    expect(outcome.kind).toBe('schema_failure');
  });
});
