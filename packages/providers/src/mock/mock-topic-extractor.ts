// The deterministic mock adapter of the Topic Extractor (#32, Task 1): mechanics only, never quality. It follows
// evals/src/harness/adapters/mock.py topic_extractor: on an empty tag list it opens the Topic the note names, else it
// reports the active tags as current and, at a seeded rate, opens "Unterthema <number of tags>" under the first.
//
// Like a model it reads only the request's blocks, in the text form the Topic Extractor's prompt renders (harness
// pipeline.py call_topic_extractor; pinned in services/detection/src/topic-extractor/topic-extractor.test.ts): the
// block of kind 'context' holds 'Tag-Liste:' and one line `- <tag> (<aktiv|beendet>[, unter <parent>])` per tag, or
// `(leer; Anfangs-Topic aus dem Setting: <topic>)`. The draw hashes the seed with the request's blocks, as the
// harness hashes its seed with the call's key (util.py hash01). Deviation: when every tag of a non-empty list has
// ended, the harness falls back to `[topic]` as current; the mock cannot read the Topic then and answers `[]` (a
// sub-topic it opens has parent null).
import { createHash } from 'node:crypto';

import type { AdapterResult, ModelAdapter, ModelRequest } from '../model-adapter.ts';

export interface MockTopicExtractorOptions {
  /** Reported by every call, fixed. */
  readonly latencySeconds: number;
  /** 0 to 1, the share of calls that open a sub-topic (harness topic_new_rate). */
  readonly newRate: number;
  /** Default 0; the same seed and the same requests give the same answers. */
  readonly seed?: number;
  /** 1-based numbers of the adapter's calls that answer no JSON. */
  readonly invalidCalls?: readonly number[];
}

const EMPTY_NOTE = /^\(leer; Anfangs-Topic aus dem Setting: (.*)\)$/;
const TAG_LINE = /^- (.+) \((aktiv|beendet)(?:, unter .+)?\)$/;

/** A deterministic number in [0, 1) from its parts (evals/src/harness/util.py hash01). */
function hash01(...parts: readonly (string | number)[]): number {
  const digest = createHash('sha256').update(parts.map(String).join('\x1f')).digest();
  return Number(digest.readBigUInt64BE(0)) / 2 ** 64;
}

function answer(request: ModelRequest, options: MockTopicExtractorOptions): string {
  const lines = (request.blocks.find((b) => b.kind === 'context')?.text ?? '').split('\n');
  const tags: { readonly tag: string; readonly active: boolean }[] = [];
  for (const line of lines) {
    const empty = EMPTY_NOTE.exec(line);
    if (empty !== null) {
      const topic = empty[1] ?? '';
      // A Setting without a Topic opens nothing: never an empty tag.
      const opened = topic === '' ? [] : [{ tag: topic, parent: null }];
      return JSON.stringify({
        current: opened.map((t) => t.tag),
        new: opened,
        returned: [],
        ended: [],
      });
    }
    const match = TAG_LINE.exec(line);
    if (match?.[1] !== undefined) tags.push({ tag: match[1], active: match[2] === 'aktiv' });
  }
  const current = tags.filter((t) => t.active).map((t) => t.tag);
  const key = request.blocks.map((b) => b.text).join('\x1e');
  if (hash01(options.seed ?? 0, 'topic', key) < options.newRate) {
    const tag = `Unterthema ${String(tags.length)}`;
    const parent = current[0] ?? null;
    return JSON.stringify({
      current: [...current.slice(0, 1), tag],
      new: [{ tag, parent }],
      returned: [],
      ended: [],
    });
  }
  return JSON.stringify({ current, new: [], returned: [], ended: [] });
}

/** The mock adapter of the Topic Extractor, name `mock`. */
export function createMockTopicExtractor(options: MockTopicExtractorOptions): ModelAdapter {
  const invalid = new Set(options.invalidCalls ?? []);
  let calls = 0;
  return {
    name: 'mock',
    call(request: ModelRequest): Promise<AdapterResult> {
      calls += 1;
      const common = {
        latencySeconds: options.latencySeconds,
        model: request.model,
        adapter: 'mock',
      };
      if (request.role !== 'topic_extractor') {
        const message = `the mock has no behaviour for the role ${request.role}`;
        return Promise.resolve({ ok: false, error: { kind: 'fatal', message }, ...common });
      }
      // The mock reports no tokens; token figures come with a real adapter (T7).
      const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 };
      const text = invalid.has(calls) ? 'kein JSON (Mock)' : answer(request, options);
      return Promise.resolve({ ok: true, text, usage, ...common });
    },
  };
}
