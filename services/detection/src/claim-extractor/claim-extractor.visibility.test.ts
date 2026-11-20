// Stage 1, issue #29 task 3 (implementer-owned, review finding M4): a call sees a Claim when it returned by the
// call's start on the Session clock, within the harness's tolerance (evals/src/harness/pipeline.py cards_until:
// `emitted_at <= t + 1e-9`). emittedAt is a sum, at + latency: 0.1 + 0.2 is 0.30000000000000004, which a call at 0.3
// must still see. Through the public interface of claim-extractor.ts (claim-extractor.test.ts, header), with a
// scripted model adapter as the only fake.
import { createLogger } from '@lfc/service-kit';
import { describe, expect, it } from 'vitest';

import type { AdapterResult, ModelRequest } from '@lfc/providers';

import { seg } from '../testing/turns.ts';
import type { Turn } from '../turns/types.ts';
import { createClaimExtractor } from './claim-extractor.ts';

const SESSION = '29a0c0de-0000-4000-8000-000000000071';
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
const A1 = seg('s-0001', 'A', 0, 0.1, 0.1, 'die Mieten steigen');
const B1 = seg('s-0002', 'B', 0.1, 0.3, 0.3, 'das stimmt nicht');
const TURN_A: Turn = { id: 't-001', speaker: 'A', interjection: false, segments: [A1] };
const TURN_B: Turn = { id: 't-002', speaker: 'B', interjection: false, segments: [B1] };
const CLAIM = {
  speaker: 'Anna Müller',
  sentence: 'Anna Müller behauptet, dass die Mieten steigen.',
  verbatim: 'die Mieten steigen',
  segmentIds: ['s-0001'],
  type: 'ereignis',
  checkworthiness: 'hoch',
  kind: 'tatsache',
  refersTo: null,
  repeatOf: null,
};

function result(claims: unknown[], latencySeconds: number): AdapterResult {
  return {
    ok: true,
    text: JSON.stringify({ claims, candidates: [] }),
    usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1, thinking: 0 },
    latencySeconds,
    model: 'claude-haiku-5-5',
    adapter: 'scripted',
  };
}

/** Turn A's call at 0.1 returns c-01 after 0.2 s; then Turn B's first call starts at `at`. */
async function claimListOfTurnBAt(at: number): Promise<string | undefined> {
  const requests: ModelRequest[] = [];
  const script = [result([CLAIM], 0.2), result([], 0.5)];
  const extractor = createClaimExtractor({
    sessionId: SESSION,
    config: CONFIG,
    setting: { mode: 'conversation' },
    speakerNames: { A: 'Anna Müller', B: 'Hukgl Suubayy' },
    adapter: {
      name: 'scripted',
      call: (request) => {
        requests.push(request);
        return Promise.resolve(script[requests.length - 1] ?? result([], 0));
      },
    },
    session: { turns: () => [TURN_A, TURN_B], labels: () => ['A', 'B'] },
    stream: { append: () => Promise.resolve() },
    candidates: { hand: () => Promise.resolve() },
    logger: createLogger({ service: 'detection', write: () => undefined }),
  });
  const first = await extractor.call({ turn: TURN_A, segments: [A1], final: true, at: 0.1 });
  expect(0.1 + first.latencySeconds).toBe(0.30000000000000004);
  await extractor.call({ turn: TURN_B, segments: [B1], final: true, at });
  return requests[1]?.blocks.find((block) => block.kind === 'claim_list')?.text;
}

describe('a call sees the Claims returned by its start, within the tolerance of 1e-9 (review M4)', () => {
  it('lists c-01, emitted at 0.1 + 0.2, in the Claim list of a call at 0.3', async () => {
    expect(await claimListOfTurnBAt(0.3)).toContain('c-01 · Anna Müller ·');
  });

  it('does not list it for a call at 0.29, before it returned', async () => {
    expect(await claimListOfTurnBAt(0.29)).toBe('Behauptungsliste des Gesprächs: (leer)');
  });
});
