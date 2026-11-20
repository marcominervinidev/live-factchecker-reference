// Stage 1, issue #29 (T4), Task 1: internals of the mock adapter and parseExpectations the frozen tests leave open
// (review of task 1, findings W2, W9, W10). Interface: header of mock-claim-extractor.test.ts.
import { describe, expect, it } from 'vitest';

import type { ModelRequest } from '../model-adapter.ts';
import { createMockClaimExtractor, parseExpectations } from './mock-claim-extractor.ts';

function request(role: ModelRequest['role']): ModelRequest {
  return {
    role,
    sessionId: '29a0c0de-0000-4000-8000-000000000041',
    model: 'claude-sonnet-5-5',
    thinking: 'low',
    blocks: [{ kind: 'prefix', text: 'Anweisung', cache: true, system: true }],
    schema: { type: 'object' },
    schemaName: 'verifier_output',
    maxTokens: 512,
    deadline: Date.now() + 8_000,
    signal: new AbortController().signal,
  };
}

const LABEL = {
  id: 'x-01',
  speaker: 'Anna Müller',
  sentence: 'Anna Müller behauptet, dass die Mieten gestiegen sind.',
  verbatim: 'die Mieten sind gestiegen',
  start: 1,
  end: 2,
  type: 'zahl',
  checkworthiness: 'hoch',
  kind: 'tatsache',
  refersTo: null,
  repeatOf: null,
};

describe('the mock answers only the Claim Extractor (review W2)', () => {
  it.each(['verifier', 'resolver', 'topic_extractor'] as const)(
    'answers a call of the %s with a fatal error and reports the model and latency',
    async (role) => {
      const mock = createMockClaimExtractor({ expectations: [], latencySeconds: 0.75 });
      const result = await mock.call(request(role));
      expect(result).toMatchObject({
        ok: false,
        error: { kind: 'fatal' },
        latencySeconds: 0.75,
        model: 'claude-sonnet-5-5',
        adapter: 'mock',
      });
    },
  );
});

describe('parseExpectations names the line and field of an error, never its content (review W2)', () => {
  // docs/spec/datenschutz.md 2: never Transcript text, claim sentences or names in logs; a start error is a log line.
  const CONTENT = ['Anna', 'Müller', 'Mieten', 'gestiegen'];

  function errorOf(jsonl: string): string {
    try {
      parseExpectations(jsonl);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('parseExpectations accepted the input');
  }

  it('names the line of a line that is no JSON, without its text', () => {
    const message = errorOf(`${JSON.stringify(LABEL)}\nAnna Müller: die Mieten {`);
    expect(message).toContain('line 2');
    for (const word of CONTENT) expect(message).not.toContain(word);
  });

  it('names the line and the field of an invalid field, without the values of the line', () => {
    const message = errorOf(JSON.stringify({ ...LABEL, refersTo: 3 }));
    expect(message).toContain('line 1');
    expect(message).toContain('refersTo');
    for (const word of CONTENT) expect(message).not.toContain(word);
  });

  it('names a missing field', () => {
    const rest: Record<string, unknown> = { ...LABEL };
    delete rest['verbatim'];
    expect(errorOf(JSON.stringify(rest))).toContain('verbatim');
  });
});

describe('the expectations of a labels file are answered in order of their start, like the harness (review W9)', () => {
  // evals/src/harness/adapters/mock.py claim_extractor: `for lab in sorted(labels, key=lambda l: l["start"])`.
  const later = {
    ...LABEL,
    id: 'x-02',
    sentence: 'Zwei.',
    verbatim: 'zweite aussage',
    start: 5,
    end: 6,
  };
  const earlier = {
    ...LABEL,
    id: 'x-01',
    sentence: 'Eins.',
    verbatim: 'erste aussage',
    start: 1,
    end: 2,
  };
  const file = [later, earlier].map((label) => JSON.stringify(label)).join('\n');

  it('returns the expectations of a file ordered by start, keeping the file order on equal starts', () => {
    expect(parseExpectations(file).map((e) => e.id)).toEqual(['x-01', 'x-02']);
    const tie = [{ ...later, start: 1 }, earlier].map((label) => JSON.stringify(label)).join('\n');
    expect(parseExpectations(tie).map((e) => e.id)).toEqual(['x-02', 'x-01']);
  });

  it('answers two expectations due in the same call in order of their start', async () => {
    const mock = createMockClaimExtractor({
      expectations: parseExpectations(file),
      latencySeconds: 1,
    });
    const result = await mock.call({
      ...request('claim_extractor'),
      blocks: [
        {
          kind: 'attribution',
          text: '- A -> Anna Müller · Referenz-Transkript · certain',
          cache: false,
          system: false,
        },
        {
          kind: 'turn',
          text: 'Turn-Block 1 · A\ns-1 [1.00–2.00] erste aussage\ns-2 [5.00–6.00] zweite aussage',
          cache: false,
          system: false,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.kind);
    const claims = (JSON.parse(result.text) as { claims: { sentence: string }[] }).claims;
    expect(claims.map((c) => c.sentence)).toEqual(['Eins.', 'Zwei.']);
  });

  it('refuses a label without a numeric start, naming the field', () => {
    expect(() => parseExpectations(JSON.stringify({ ...LABEL, start: '1' }))).toThrow(
      /line 1: invalid start/,
    );
  });
});

describe('parseExpectations refuses values outside the enums of output schema 4.1 at once (review W10)', () => {
  // docs/spec/erkennung-modellrollen.md 4.1; evals/src/harness/schemas.py TYPES, CHECKWORTHINESS, KINDS.
  it.each([
    ['type', 'Zahl'],
    ['checkworthiness', 'mittel'],
    ['kind', 'prognose'],
  ])('refuses %s = %s, naming the field', (field, value) => {
    expect(() => parseExpectations(JSON.stringify({ ...LABEL, [field]: value }))).toThrow(
      new RegExp(`line 1: invalid ${field}$`),
    );
  });

  it('accepts every value of the enums', () => {
    const values = [
      ...['zahl', 'ereignis', 'zitat', 'ursache'].map((type) => ({ type })),
      { checkworthiness: 'niedrig' },
      ...['widerspruch', 'zustimmung', 'meinung_mit_kern'].map((kind) => ({
        kind,
        refersTo: 'x-00',
      })),
    ];
    const file = values
      .map((over, i) => JSON.stringify({ ...LABEL, ...over, id: `x-${String(i)}` }))
      .join('\n');
    expect(parseExpectations(file)).toHaveLength(values.length);
  });
});
