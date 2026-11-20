// Stage 1, issue #32 (T6), Task 1: the deterministic mock adapter of the Topic Extractor (ticket, Task 1: "first call
// opens the Setting's Topic, then a seeded small rate of sub-topics, as evals/src/harness/adapters/mock.py
// topic_extractor"); mechanics only, never quality. Harness reference:
//   if not tags:            {"current": [topic], "new": [{"tag": topic, "parent": None}], "returned": [], "ended": []}
//   cur = active tags or [topic]
//   with probability rate:  tag = f"Unterthema {len(tags)}" -> {"current": [cur[0], tag], "new": [{"tag": tag,
//                           "parent": cur[0]}], ...}
//   else:                   {"current": cur, "new": [], "returned": [], "ended": []}
// Like a model, and like the Claim Extractor's mock (mock-claim-extractor.ts), it reads only the request's blocks: the
// tag list is the block of kind 'context' in the text form the Topic Extractor's prompt renders (harness
// pipeline.py call_topic_extractor; pinned in services/detection/src/topic-extractor/topic-extractor.test.ts):
//   'Tag-Liste:' then one line per tag `- <tag> (<aktiv|beendet>[, unter <parent>])`, or, when empty,
//   `(leer; Anfangs-Topic aus dem Setting: <topic>)`.
//
// Public interface these tests define (proposal of the test designer for gate 1):
//   src/mock/mock-topic-extractor.ts
//     export interface MockTopicExtractorOptions {
//       readonly latencySeconds: number;           // reported by every call, fixed
//       readonly newRate: number;                  // 0 to 1, the share of calls that open a sub-topic (harness
//                                                  // topic_new_rate, baseline.json 0.05)
//       readonly seed?: number;                    // default 0 (P1, round 2: no environment variable); the same
//                                                  // seed and the same requests give the same answers
//       readonly invalidCalls?: readonly number[]; // 1-based numbers of the adapter's calls that answer no JSON
//     }
//     export function createMockTopicExtractor(options: MockTopicExtractorOptions): ModelAdapter   // name 'mock'
//   exported from src/index.ts as well.
import { describe, expect, it } from 'vitest';

import type { ContentBlock, ModelRequest } from '../model-adapter.ts';
import { createMockTopicExtractor } from './mock-topic-extractor.ts';

const SESSION = '32a0c0de-0000-4000-8000-000000000031';

function block(kind: string, text: string, cache = false, system = false): ContentBlock {
  return { kind, text, cache, system };
}

function request(
  tagList: string,
  fresh = 'Neu seit der letzten Analyse:\n(nichts Neues)',
): ModelRequest {
  return {
    role: 'topic_extractor',
    sessionId: SESSION,
    model: 'claude-haiku-5-5',
    thinking: 'off',
    blocks: [
      block('prefix', 'Anweisung (Test)\n\n## Ausgabeschema (JSON)\n{}', true, true),
      block('context', tagList, true),
      block('window', 'Fenster (letzte 60 s):\n(kein Fenster)'),
      block('new', fresh),
    ],
    schema: {},
    schemaName: 'topic_output',
    maxTokens: 1024,
    deadline: Date.now() + 15_000,
    signal: new AbortController().signal,
  };
}

const EMPTY = 'Tag-Liste:\n(leer; Anfangs-Topic aus dem Setting: Mieten Berlin)';
const TWO = 'Tag-Liste:\n- Mieten Berlin (aktiv)\n- Mietpreisbremse (beendet, unter Mieten Berlin)';
const SUB_FIRST =
  'Tag-Liste:\n- Neubau (beendet)\n- Mietpreisbremse (aktiv, unter Mieten Berlin)\n- Rente (aktiv)';

async function answer(adapter: ReturnType<typeof createMockTopicExtractor>, r: ModelRequest) {
  const result = await adapter.call(r);
  if (!result.ok) throw new Error(`the mock failed: ${result.error.kind}`);
  return JSON.parse(result.text) as Record<string, unknown>;
}

describe('the mock Topic Extractor follows the harness mock', () => {
  it('opens the Topic the note names when the tag list is empty', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 0 });
    expect(await answer(mock, request(EMPTY))).toEqual({
      current: ['Mieten Berlin'],
      new: [{ tag: 'Mieten Berlin', parent: null }],
      returned: [],
      ended: [],
    });
  });

  it('opens nothing when the tag list is empty and the Setting names no Topic (never an empty tag)', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 1 });
    expect(
      await answer(mock, request('Tag-Liste:\n(leer; Anfangs-Topic aus dem Setting: )')),
    ).toEqual({
      current: [],
      new: [],
      returned: [],
      ended: [],
    });
  });

  it('answers like seed 0 when no seed is given', async () => {
    const sequence = async (seed?: number) => {
      const mock = createMockTopicExtractor({
        latencySeconds: 0.5,
        newRate: 0.5,
        ...(seed === undefined ? {} : { seed }),
      });
      const answers: unknown[] = [];
      for (let i = 1; i <= 12; i += 1) {
        const fresh = `Neu seit der letzten Analyse:\n[${i}.00–${i}.50] B: Satz ${i}`;
        answers.push(await answer(mock, request(TWO, fresh)));
      }
      return answers;
    };
    expect(await sequence()).toEqual(await sequence(0));
  });

  it('reports the active tags of the list as current and opens nothing at rate 0', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 0 });
    expect(await answer(mock, request(SUB_FIRST))).toEqual({
      current: ['Mietpreisbremse', 'Rente'],
      new: [],
      returned: [],
      ended: [],
    });
  });

  it('opens "Unterthema <number of tags>" under the first current Topic at rate 1', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 1 });
    expect(await answer(mock, request(TWO))).toEqual({
      current: ['Mieten Berlin', 'Unterthema 2'],
      new: [{ tag: 'Unterthema 2', parent: 'Mieten Berlin' }],
      returned: [],
      ended: [],
    });
  });

  it('opens a sub-topic on some and not on other calls at a rate between 0 and 1', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 0.5, seed: 7 });
    const opened: boolean[] = [];
    for (let i = 1; i <= 40; i += 1) {
      const fresh = `Neu seit der letzten Analyse:\n[${i}.00–${i}.50] B: Satz ${i}`;
      const a = await answer(mock, request(TWO, fresh));
      opened.push((a['new'] as unknown[]).length > 0);
    }
    expect(opened).toContain(true);
    expect(opened).toContain(false);
  });

  it('answers the same requests with the same answers for the same seed', async () => {
    const sequence = async () => {
      const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 0.5, seed: 11 });
      const answers: unknown[] = [];
      for (let i = 1; i <= 12; i += 1) {
        const fresh = `Neu seit der letzten Analyse:\n[${i}.00–${i}.50] B: Satz ${i}`;
        answers.push(await answer(mock, request(i % 2 === 0 ? TWO : SUB_FIRST, fresh)));
      }
      return answers;
    };
    expect(await sequence()).toEqual(await sequence());
  });

  it('reports the configured latency, the model of the request and the adapter name mock', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 1.25, newRate: 0 });
    const result = await mock.call(request(TWO));
    expect(mock.name).toBe('mock');
    expect(result).toMatchObject({
      ok: true,
      latencySeconds: 1.25,
      model: 'claude-haiku-5-5',
      adapter: 'mock',
    });
  });
});

describe('the mock Topic Extractor fails where it is told to', () => {
  it('answers no JSON on the configured calls and valid JSON on the others', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 0, invalidCalls: [1] });
    const first = await mock.call(request(TWO));
    const second = await mock.call(request(TWO));
    expect(first.ok).toBe(true);
    expect(() => JSON.parse(first.ok ? first.text : '') as unknown).toThrow();
    expect(second.ok && (JSON.parse(second.text) as Record<string, unknown>)['current']).toEqual([
      'Mieten Berlin',
    ]);
  });

  it('answers a request of another role with a fatal error', async () => {
    const mock = createMockTopicExtractor({ latencySeconds: 0.5, newRate: 0 });
    const result = await mock.call({ ...request(TWO), role: 'claim_extractor' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('fatal');
  });
});
