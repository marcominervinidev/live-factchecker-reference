// Stage 1, issue #29 (T4), Task 1: the mock adapter of the Claim Extractor, AC19 (mechanics only, never quality;
// docs/process/test-strategy.md: providers are mocked on stages 2a and 3). Reference: the oracle of
// evals/src/harness/adapters/mock.py claim_extractor without its random rates (the ticket's Assumptions).
//
// Public interface these tests define (built in Task 1):
//   src/mock/mock-claim-extractor.ts
//     export interface Expectation { readonly id: string; readonly speaker: string; readonly sentence: string;
//       readonly verbatim: string; readonly type: string; readonly checkworthiness: string; readonly kind: string;
//       readonly refersTo: string | null; readonly repeatOf: string | null }   // one line of a labels.jsonl; the
//                                                                             // label's other fields are ignored
//     export function parseExpectations(jsonl: string): Expectation[]         // the text of a labels.jsonl file
//     export function createMockClaimExtractor(options: {
//       readonly expectations: readonly Expectation[];
//       readonly latencySeconds: number;                  // reported by every call, fixed
//       readonly invalidCalls?: readonly number[];        // 1-based numbers of the adapter's calls that answer no JSON
//     }): ModelAdapter                                    // the port of src/model-adapter.ts, name 'mock'
//
// What the mock reads: like a model, only the request's blocks, in the text form the Claim Extractor's prompt
// renders (harness text mode, evals/src/harness/prompt.py; pinned for the detection service in
// services/detection/src/claim-extractor/prompt.test.ts):
//   kind 'turn'         first line `Turn-Block <k> · <label>`, then one line per Segment `<id> [<start>–<end>] <text>`
//                       (times with two decimals), last line `(Ende des Redebeitrags)` in the final analysis
//   kind 'attribution'  one line per label; a label with a name reads `- <label> -> <name> · <source> · certain`
//   kind 'claim_list', 'delta'   one line per Claim `<id> · <speaker> · <sentence>`
// The Turn's Speaker is the name the attribution gives its label as certain; a label without one is no Speaker an
// expectation can name. An expectation is due once its verbatim, normalised like the harness (case and punctuation,
// evals/src/harness/util.py norm_tokens), is a contiguous passage of the Segments sent in the Turn's blocks so far.
// It is answered once per Session (the request's sessionId): a Claim with the expectation's speaker, sentence,
// verbatim, type, checkworthiness and kind, `segmentIds` the Segments holding the passage, and `refersTo` and
// `repeatOf` mapped from label ids to the ids of the Claim list or delta Claims whose sentence equals the referenced
// expectation's sentence (normalised). An unmapped `repeatOf` becomes null; an unmapped `refersTo` makes the
// expectation a Candidate with reason `bezug_unklar` instead (harness mock.py _card_for and claim_extractor).
// A reference to an id no expectation has is unmapped too: `_card_for` starts with
//   `lab = next((l for l in labels if l["id"] == label_id), None)` / `if lab is None: return None`
// (owner decision on gate 1 question 15 of 2026-11-03: "ein eigener Unit-Fall für `refersTo` auf eine nicht vorhandene
// Erwartung kommt dazu").
import { createMockClaimExtractor, parseExpectations, type Expectation } from './mock-claim-extractor.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AdapterResult, ContentBlock, ModelRequest } from '../model-adapter.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SESSION = '29a0c0de-0000-4000-8000-000000000021';
const OTHER_SESSION = '29a0c0de-0000-4000-8000-000000000022';

interface Line {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const fmt = (x: number) => x.toFixed(2);

function turnBlock(k: number, label: string, lines: readonly Line[], final = false): ContentBlock {
  const body = lines.length > 0
    ? lines.map((l) => `${l.id} [${fmt(l.start)}–${fmt(l.end)}] ${l.text}`).join('\n')
    : '(kein neuer Redetext)';
  return {
    kind: 'turn',
    text: `Turn-Block ${k} · ${label}\n${body}${final ? '\n(Ende des Redebeitrags)' : ''}`,
    cache: false,
    system: false,
  };
}

function attribution(names: Readonly<Record<string, string>>, unnamed: readonly string[] = []): ContentBlock {
  const lines = [
    'Zuordnungstabelle (Label -> Sprecher, Quelle, Sicherheit):',
    ...Object.entries(names).map(([label, name]) => `- ${label} -> ${name} · Referenz-Transkript · certain`),
    ...unnamed.map((label) => `- ${label} -> ${label} · keine Quelle · none`),
  ];
  return { kind: 'attribution', text: lines.join('\n'), cache: false, system: false };
}

function claimList(kind: 'claim_list' | 'delta', claims: readonly (readonly [string, string, string])[]): ContentBlock {
  const title = kind === 'claim_list' ? 'Behauptungsliste des Gesprächs' : 'Delta-Behauptungen (in diesem Turn bereits ausgegeben)';
  const text = claims.length === 0 ? `${title}: (leer)` : `${title}:\n${claims.map((c) => c.join(' · ')).join('\n')}`;
  return { kind, text, cache: false, system: false };
}

function request(
  turnBlocks: readonly ContentBlock[],
  options: {
    names?: Readonly<Record<string, string>>;
    unnamed?: readonly string[];
    list?: readonly (readonly [string, string, string])[];
    delta?: readonly (readonly [string, string, string])[];
    sessionId?: string;
  } = {},
): ModelRequest {
  return {
    role: 'claim_extractor',
    sessionId: options.sessionId ?? SESSION,
    model: 'claude-haiku-5-5',
    thinking: 'off',
    blocks: [
      { kind: 'prefix', text: 'Anweisung', cache: true, system: true },
      attribution(options.names ?? { A: 'Kallac Haqy', B: 'Hukgl Suubayy' }, options.unnamed),
      claimList('claim_list', options.list ?? []),
      { kind: 'context', text: 'Kontext-Turns: (keine)', cache: true, system: false },
      ...turnBlocks,
      claimList('delta', options.delta ?? []),
      { kind: 'final', text: 'Schluss', cache: false, system: false },
    ],
    schema: { type: 'object' },
    schemaName: 'claim_extractor_output',
    maxTokens: 2048,
    deadline: Date.now() + 15_000,
    signal: new AbortController().signal,
  };
}

function expectation(over: Partial<Expectation> & Pick<Expectation, 'id' | 'speaker' | 'verbatim'>): Expectation {
  return {
    sentence: `${over.speaker} behauptet etwas zu ${over.id}.`,
    type: 'ereignis',
    checkworthiness: 'hoch',
    kind: 'tatsache',
    refersTo: null,
    repeatOf: null,
    ...over,
  };
}

interface Answer {
  claims: Record<string, unknown>[];
  candidates: Record<string, unknown>[];
}

function answer(result: AdapterResult): Answer {
  if (!result.ok) throw new Error(`the mock answered with an error: ${result.error.kind}`);
  return JSON.parse(result.text) as Answer;
}

// The recording window of golden: synt-2026-10-06-a 01:10-01:55 (Segment ids and words as the harness cuts them;
// Speaker B is Hukgl Suubayy, label synt-2026-10-06-a-09 of the Golden Set).
const S2: Line = { id: 's-0002', start: 68.93, end: 71.57, text: 'Yugxu as daehov Cioso pavivbn fujg. Tapiw? Rob qutc baoj' };
const S3: Line = {
  id: 's-0003',
  start: 71.82001,
  end: 77.31,
  text: 'rob qutc baoj 2017 os Fiydulvuv. Xatsuc Loe keka keka Sige ig. Uwgu Lmikyampadez, rob fodoz.',
};
const BAUMANN_09 = expectation({
  id: 'synt-2026-10-06-a-09',
  speaker: 'Hukgl Suubayy',
  sentence: 'Hukgl Suubayy facuajkiz, noxl vee AsQ baoj 2017 os Fiydulvuv ovp.',
  verbatim: 'Rob qutc baoj rob qutc baoj 2017 os Fiydulvuv.',
  type: 'zahl',
});

describe('the mock answers an expectation once its verbatim is in the sent Segments of its Speaker (AC19)', () => {
  it('returns one Claim with the expectation fields and the Segments holding the verbatim', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S2, S3])])));
    expect(out.candidates).toEqual([]);
    expect(out.claims).toEqual([
      {
        speaker: 'Hukgl Suubayy',
        sentence: BAUMANN_09.sentence,
        verbatim: BAUMANN_09.verbatim,
        segmentIds: ['s-0002', 's-0003'],
        type: 'zahl',
        checkworthiness: 'hoch',
        kind: 'tatsache',
        refersTo: null,
        repeatOf: null,
      },
    ]);
  });

  it('waits until the verbatim is complete across the Turn blocks of later calls', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    const first = answer(await mock.call(request([turnBlock(1, 'B', [S2])])));
    expect(first.claims).toEqual([]);
    const second = answer(await mock.call(request([turnBlock(1, 'B', [S2]), turnBlock(2, 'B', [S3], true)])));
    expect(second.claims.map((c) => c['segmentIds'])).toEqual([['s-0002', 's-0003']]);
  });

  it('answers an expectation at most once per Session, also in the final analysis', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    await mock.call(request([turnBlock(1, 'B', [S2, S3])]));
    const again = answer(await mock.call(request([turnBlock(1, 'B', [S2, S3]), turnBlock(2, 'B', [], true)])));
    expect(again.claims).toEqual([]);
    expect(again.candidates).toEqual([]);
  });

  it('answers the same expectation once in each of two Sessions', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    const one = answer(await mock.call(request([turnBlock(1, 'B', [S2, S3])])));
    const two = answer(await mock.call(request([turnBlock(1, 'B', [S2, S3])], { sessionId: OTHER_SESSION })));
    expect(one.claims).toHaveLength(1);
    expect(two.claims).toHaveLength(1);
  });

  it('does not answer while only part of the verbatim was sent', async () => {
    const partial: Line = { ...S3, text: 'rob qutc baoj 2017 os' };
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    expect(answer(await mock.call(request([turnBlock(1, 'B', [S2, partial])]))).claims).toEqual([]);
  });

  it('does not answer in a Turn of another Speaker, although the words are there', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    expect(answer(await mock.call(request([turnBlock(1, 'A', [S2, S3])]))).claims).toEqual([]);
  });

  it('does not answer in a Turn whose label has no name as certain', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    const req = request([turnBlock(1, 'B', [S2, S3])], { names: { A: 'Kallac Haqy' }, unnamed: ['B'] });
    expect(answer(await mock.call(req)).claims).toEqual([]);
  });

  it('matches the verbatim regardless of case and punctuation, never across a gap', async () => {
    const shout = expectation({ id: 'x-1', speaker: 'Hukgl Suubayy', verbatim: 'XATSUC LOE – keka, keka Sige ig!' });
    const gap = expectation({ id: 'x-2', speaker: 'Hukgl Suubayy', verbatim: 'Xatsuc Loe keka Sige ig.' });
    const mock = createMockClaimExtractor({ expectations: [shout, gap], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S2, S3])])));
    expect(out.claims.map((c) => c['verbatim'])).toEqual([shout.verbatim]);
    expect(out.claims[0]?.['segmentIds']).toEqual(['s-0003']);
  });
});

describe('the mock maps repeatOf and refersTo to the ids the request shows (AC19)', () => {
  const earlier = expectation({
    id: 'synt-2026-10-06-a-08',
    speaker: 'Hukgl Suubayy',
    sentence: 'Hukgl Suubayy facuajkiz, noxl Iohado tuotu hemkhözpjo Oißawpweqwa xop evr bikag botiabzopwuy xemn.',
    verbatim: 'vuc locb sudvf, ovp vee Oißawpweqwa.',
  });
  const S17: Line = { id: 's-0017', start: 97.93, end: 101.85, text: 'Xrternuc rediayaj, vee Außokhnosxes padzob zedflöblf. Vee padzob okiy kuqyz zedflöblf.' };
  const S18: Line = { id: 's-0018', start: 102.19, end: 104.43, text: 'Bikag xemn suoj, awze qolnpeuleabc Ovt' };
  const repeat = expectation({
    id: 'synt-2026-10-06-a-12',
    speaker: 'Hukgl Suubayy',
    sentence: 'Hukgl Suubayy facuajkiz ibxeas, noxl vee Außokhnosxes kuqyz zedflöblf padzob.',
    verbatim: 'Vee padzob okiy kuqyz zedflöblf. Bikag xemn suoj.',
    repeatOf: 'synt-2026-10-06-a-08',
  });
  const LISTED: readonly [string, string, string] = ['c-03', 'Hukgl Suubayy', earlier.sentence];

  it('maps repeatOf to the id of the Claim list entry with the referenced sentence', async () => {
    const mock = createMockClaimExtractor({ expectations: [earlier, repeat], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S17, S18])], { list: [LISTED] })));
    expect(out.claims).toMatchObject([{ verbatim: repeat.verbatim, repeatOf: 'c-03', refersTo: null, segmentIds: ['s-0017', 's-0018'] }]);
  });

  it('maps repeatOf to a delta Claim as well', async () => {
    const mock = createMockClaimExtractor({ expectations: [earlier, repeat], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S17, S18])], { delta: [LISTED] })));
    expect(out.claims).toMatchObject([{ repeatOf: 'c-03' }]);
  });

  it('answers with repeatOf null when the referenced Claim is in neither list', async () => {
    const mock = createMockClaimExtractor({ expectations: [earlier, repeat], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S17, S18])])));
    expect(out.claims).toMatchObject([{ verbatim: repeat.verbatim, repeatOf: null }]);
  });

  it('maps refersTo to the listed id of the referenced sentence', async () => {
    const reply = { ...repeat, id: 'r-1', repeatOf: null, refersTo: 'synt-2026-10-06-a-08', kind: 'widerspruch' };
    const mock = createMockClaimExtractor({ expectations: [earlier, reply], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S17, S18])], { list: [LISTED] })));
    expect(out.claims).toMatchObject([{ refersTo: 'c-03', repeatOf: null, kind: 'widerspruch' }]);
  });

  it('answers a Candidate bezug_unklar instead of a Claim when refersTo maps to no listed id', async () => {
    const reply = { ...repeat, id: 'r-2', repeatOf: null, refersTo: 'synt-2026-10-06-a-08', kind: 'widerspruch' };
    const mock = createMockClaimExtractor({ expectations: [earlier, reply], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S17, S18])])));
    expect(out.claims).toEqual([]);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({ speaker: 'Hukgl Suubayy', reason: 'bezug_unklar', segmentIds: ['s-0017', 's-0018'] });
    expect(Object.keys(out.candidates[0] ?? {}).sort()).toEqual(['note', 'reason', 'segmentIds', 'speaker', 'verbatim']);
  });

  it('answers a Candidate bezug_unklar when refersTo names an id no expectation has, even with a Claim listed', async () => {
    const reply = { ...repeat, id: 'r-3', repeatOf: null, refersTo: 'x-00', kind: 'widerspruch' };
    const mock = createMockClaimExtractor({ expectations: [earlier, reply], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S17, S18])], { list: [LISTED] })));
    expect(out.claims).toEqual([]);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({ speaker: 'Hukgl Suubayy', reason: 'bezug_unklar', segmentIds: ['s-0017', 's-0018'] });
  });
});

describe('the mock answers invalidly on the configured calls and reports a fixed latency (AC19)', () => {
  it('answers no JSON on call 1 and the Claim on call 2, the repeat', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5, invalidCalls: [1] });
    const req = request([turnBlock(1, 'B', [S2, S3])]);
    const first = await mock.call(req);
    expect(first.ok).toBe(true);
    if (first.ok) expect(() => JSON.parse(first.text) as unknown).toThrow();
    const retry = { ...req, blocks: [...req.blocks, { kind: 'retry', text: 'kein gültiges JSON', cache: false, system: false }] };
    expect(answer(await mock.call(retry)).claims).toHaveLength(1);
  });

  it('answers no JSON on every listed call, counting every call of the adapter', async () => {
    const mock = createMockClaimExtractor({ expectations: [], latencySeconds: 0.5, invalidCalls: [2, 3] });
    const req = request([turnBlock(1, 'B', [S2])]);
    const texts: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await mock.call(req);
      texts.push(result.ok ? result.text : 'error');
    }
    const parses = texts.map((t) => {
      try {
        JSON.parse(t);
        return true;
      } catch {
        return false;
      }
    });
    expect(parses).toEqual([true, false, false, true]);
  });

  it('reports the configured latency, the model it was asked for and the adapter name mock', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 2.25, invalidCalls: [2] });
    expect(mock.name).toBe('mock');
    for (const result of [await mock.call(request([])), await mock.call(request([]))]) {
      expect(result).toMatchObject({ latencySeconds: 2.25, model: 'claude-haiku-5-5', adapter: 'mock' });
    }
  });

  it('answers only the fields of output schema 4.1 in product mode (no discarded)', async () => {
    const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5 });
    const out = answer(await mock.call(request([turnBlock(1, 'B', [S2, S3])])));
    expect(Object.keys(out).sort()).toEqual(['candidates', 'claims']);
  });

  it('is deterministic: the same requests give the same answers on a fresh mock', async () => {
    const run = async (): Promise<string[]> => {
      const mock = createMockClaimExtractor({ expectations: [BAUMANN_09], latencySeconds: 0.5, invalidCalls: [2] });
      const out: string[] = [];
      for (const blocks of [[turnBlock(1, 'B', [S2])], [turnBlock(1, 'B', [S2]), turnBlock(2, 'B', [S3])], [turnBlock(1, 'B', [S2]), turnBlock(2, 'B', [S3])]]) {
        const result = await mock.call(request(blocks));
        out.push(result.ok ? result.text : result.error.kind);
      }
      return out;
    };
    expect(await run()).toEqual(await run());
  });
});

describe('parseExpectations reads the Golden Set label format (AC19)', () => {
  it('reads every label of a Golden Set labels.jsonl with the fields the mock uses', () => {
    const text = readFileSync(join(ROOT, 'evals', 'golden', 'synt-2026-10-06-a', 'labels.jsonl'), 'utf8');
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    const parsed = parseExpectations(text);
    expect(parsed).toHaveLength(lines.length);
    expect(parsed.find((e) => e.id === 'synt-2026-10-06-a-09')).toMatchObject({
      speaker: BAUMANN_09.speaker,
      sentence: BAUMANN_09.sentence,
      verbatim: BAUMANN_09.verbatim,
      type: 'zahl',
      repeatOf: null,
    });
    expect(parsed.find((e) => e.id === 'synt-2026-10-06-a-12')?.repeatOf).toBe('synt-2026-10-06-a-08');
  });

  it('reads an empty file as no expectation', () => {
    expect(parseExpectations('')).toEqual([]);
    expect(parseExpectations('\n')).toEqual([]);
  });
});
