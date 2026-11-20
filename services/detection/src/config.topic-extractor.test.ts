// Stage 1, issue #32 (T6), Task 1: configuration of the Topic Extractor (.claude/rules/platform.md: configuration from
// the environment only, validated at startup; ticket, Task 1, Shape: "parameters tick_seconds, topic_window_seconds,
// schema_retries from the existing configuration (spec 8), never hard-coded; model id (Haiku 5.5, thinking off) only as
// configuration"). The prompt is read from the configured file at startup and never compiled in (spec 1, ADR 0004
// addendum 2026-10-25: prompt topic_extractor.de.txt taken over unchanged), as #29 does for the Claim Extractor
// (src/config.claim-extractor.test.ts, whose environment these tests extend).
// env() also sets VERIFIER_PROMPT_FILE: with a model adapter the service refuses to start without it (gate 1 of #30,
// owner 2026-11-18, answer 1, "Start verweigern"; #29 gets the same through the owner unlock
// .owner-pakete/td30/29-unlock-verifier-prompt.patch). Before #30 it has no effect.
//
// Public interface these tests define (proposal of the test designer for gate 1; the names follow #29's, gate 1 of
// #29, question 10):
//   loadConfig(env) -> { ..., topicExtractor?: TopicExtractorConfig }
//   With MODEL_ADAPTER=mock (and #29's CLAIM_EXTRACTOR_PROMPT_FILE and MOCK_EXPECTATIONS_FILE):
//   TOPIC_EXTRACTOR_PROMPT_FILE        the file is read at startup, its text is `instruction`; a missing or unreadable
//                                      file rejects naming the variable. Unset or empty: the service runs
//                                      without a Topic Extractor (owner, gate 1 of #32, O2, 2026-11-18: "Tor 1
//                                      wie empfohlen"; ticket, Assumptions)
//   TOPIC_EXTRACTOR_MODEL              default claude-haiku-5-5 (ADR 0004, addendum 2026-10-25)
//   TOPIC_EXTRACTOR_THINKING           off | low, default off
//   TOPIC_EXTRACTOR_MAX_TOKENS         whole number from 1, default 1024 (evals/configs/baseline.json, topic_extractor)
//   TOPIC_EXTRACTOR_DEADLINE_SECONDS   above 0, default 15 (the extractor deadline T7 proposes for both extractors)
//   TOPIC_WINDOW_SECONDS               whole seconds from 1, default 60 (spec 8 topic_window_seconds)
//   SCHEMA_RETRIES                     #29's, one value for every role (spec 8 schema_retries)
//   With MODEL_ADAPTER=mock:
//   MOCK_TOPIC_NEW_RATE                0 to 1, default 0.05 (baseline.json, mock topic_new_rate)
//   MOCK_TOPIC_LATENCY_SECONDS         at least 0, default 0
//   MOCK_TOPIC_INVALID_CALLS           optional, comma-separated call numbers from 1, default none
//   TopicExtractorConfig = { instruction; model; thinking; maxTokens; deadlineSeconds; windowSeconds; schemaRetries;
//     mock?: { newRate: number; latencySeconds: number; invalidCalls: readonly number[] } }
//   An invalid value rejects with an Error whose message names the variable and holds no value and no path.
import { loadConfig } from './config.ts';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

type Env = Record<string, string | undefined>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CLAIM_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'claim_extractor.v2.de.txt');
const TOPIC_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'topic_extractor.de.txt');
const VERIFIER_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'verifier.v2.de.txt');
const dir = mkdtempSync(join(tmpdir(), 'lfc-32-config-'));
const redisPasswordPath = join(dir, 'redis_password');
writeFileSync(redisPasswordPath, 'pw-32-config-secret');
const ownPrompt = join(dir, 'eigene-themen-anweisung-32.txt');
writeFileSync(ownPrompt, 'Eine andere Themen-Anweisung, nur für diesen Test.\n');
const expectations = join(dir, 'labels-32.jsonl');
writeFileSync(expectations, '');
const missing = join(dir, 'gibt-es-nicht-32.txt');
const aDirectory = join(dir, 'ein-verzeichnis-32');
mkdirSync(aDirectory);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(overrides: Env = {}): Env {
  return {
    PORT: '8080',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_PASSWORD_FILE: redisPasswordPath,
    MODEL_ADAPTER: 'mock',
    CLAIM_EXTRACTOR_PROMPT_FILE: CLAIM_PROMPT,
    MOCK_EXPECTATIONS_FILE: expectations,
    TOPIC_EXTRACTOR_PROMPT_FILE: TOPIC_PROMPT,
    VERIFIER_PROMPT_FILE: VERIFIER_PROMPT,
    ...overrides,
  };
}

async function topicExtractor(overrides: Env = {}) {
  const config = (await loadConfig(env(overrides))).topicExtractor;
  if (config === undefined) throw new Error('no topicExtractor configuration');
  return config;
}

async function rejection(overrides: Env): Promise<Error> {
  try {
    await loadConfig(env(overrides));
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('loadConfig rejected with something that is no Error', { cause: error });
  }
  throw new Error('loadConfig accepted the configuration');
}

describe('the Topic Extractor prompt comes from the configured file (AC6)', () => {
  it('reads the instruction text of topic_extractor.de.txt unchanged', async () => {
    const config = await topicExtractor();
    expect(config.instruction.trim()).toBe(readFileSync(TOPIC_PROMPT, 'utf8').trim());
  });

  it('reads whatever file is configured, so no prompt text is compiled into the code', async () => {
    const config = await topicExtractor({ TOPIC_EXTRACTOR_PROMPT_FILE: ownPrompt });
    expect(config.instruction.trim()).toBe('Eine andere Themen-Anweisung, nur für diesen Test.');
  });

  it.each([
    ['a file that does not exist', missing],
    ['a directory, not a readable file', aDirectory],
  ])(
    'refuses TOPIC_EXTRACTOR_PROMPT_FILE naming %s, naming the variable and not the path',
    async (_, value) => {
      const error = await rejection({ TOPIC_EXTRACTOR_PROMPT_FILE: value });
      expect(error.message).toContain('TOPIC_EXTRACTOR_PROMPT_FILE');
      expect(error.message).not.toContain(value);
    },
  );
});

describe('without TOPIC_EXTRACTOR_PROMPT_FILE the service runs without a Topic Extractor (O2)', () => {
  it('loads with MODEL_ADAPTER=mock, a Claim Extractor and no Topic Extractor', async () => {
    const config = await loadConfig(env({ TOPIC_EXTRACTOR_PROMPT_FILE: undefined }));
    expect(config.claimExtractor).toBeDefined();
    expect(config.topicExtractor).toBeUndefined();
  });

  it('treats an empty TOPIC_EXTRACTOR_PROMPT_FILE as unset', async () => {
    const config = await loadConfig(env({ TOPIC_EXTRACTOR_PROMPT_FILE: '' }));
    expect(config.claimExtractor).toBeDefined();
    expect(config.topicExtractor).toBeUndefined();
  });
});

describe('the service without a model adapter has no Topic Extractor', () => {
  it.each([undefined, ''])(
    'has no Topic Extractor configuration when MODEL_ADAPTER is %j',
    async (value) => {
      const config = await loadConfig(
        env({
          MODEL_ADAPTER: value,
          CLAIM_EXTRACTOR_PROMPT_FILE: undefined,
          MOCK_EXPECTATIONS_FILE: undefined,
          TOPIC_EXTRACTOR_PROMPT_FILE: undefined,
          VERIFIER_PROMPT_FILE: undefined,
        }),
      );
      expect(config.topicExtractor).toBeUndefined();
    },
  );
});

describe('model, thinking and parameters come from configuration, with the start values of spec 8', () => {
  it('takes Haiku 5.5, thinking off, 1024 tokens, 15 s, a window of 60 s and one schema retry when nothing is set', async () => {
    expect(await topicExtractor()).toMatchObject({
      model: 'claude-haiku-5-5',
      thinking: 'off',
      maxTokens: 1024,
      deadlineSeconds: 15,
      windowSeconds: 60,
      schemaRetries: 1,
    });
  });

  it('passes configured values through', async () => {
    expect(
      await topicExtractor({
        TOPIC_EXTRACTOR_MODEL: 'claude-sonnet-5-5',
        TOPIC_EXTRACTOR_THINKING: 'low',
        TOPIC_EXTRACTOR_MAX_TOKENS: '2048',
        TOPIC_EXTRACTOR_DEADLINE_SECONDS: '12.5',
        TOPIC_WINDOW_SECONDS: '30',
        SCHEMA_RETRIES: '2',
      }),
    ).toMatchObject({
      model: 'claude-sonnet-5-5',
      thinking: 'low',
      maxTokens: 2048,
      deadlineSeconds: 12.5,
      windowSeconds: 30,
      schemaRetries: 2,
    });
  });

  it('accepts a window of 1 s, the smallest whole number of seconds', async () => {
    expect((await topicExtractor({ TOPIC_WINDOW_SECONDS: '1' })).windowSeconds).toBe(1);
  });

  it.each([
    ['TOPIC_WINDOW_SECONDS', '0'],
    ['TOPIC_WINDOW_SECONDS', '1.5'],
    ['TOPIC_WINDOW_SECONDS', 'sechzig'],
    ['TOPIC_EXTRACTOR_THINKING', 'high'],
    ['TOPIC_EXTRACTOR_MAX_TOKENS', '0'],
    ['TOPIC_EXTRACTOR_DEADLINE_SECONDS', '0'],
  ])('refuses %s = %j, naming the variable and not the value', async (name, value) => {
    const error = await rejection({ [name]: value });
    expect(error.message).toContain(name);
    expect(error.message).not.toContain(`"${value}"`);
  });
});

describe('the mock Topic Extractor is configured from the environment', () => {
  it('opens sub-topics at the rate of the harness baseline, answers at once and never invalidly when nothing is set', async () => {
    expect((await topicExtractor()).mock).toEqual({
      newRate: 0.05,
      latencySeconds: 0,
      invalidCalls: [],
    });
  });

  it('passes rate, latency and invalid calls through', async () => {
    expect(
      (
        await topicExtractor({
          MOCK_TOPIC_NEW_RATE: '1',
          MOCK_TOPIC_LATENCY_SECONDS: '6',
          MOCK_TOPIC_INVALID_CALLS: '1,2',
        })
      ).mock,
    ).toEqual({ newRate: 1, latencySeconds: 6, invalidCalls: [1, 2] });
  });

  it.each(['0', '1'])('accepts MOCK_TOPIC_NEW_RATE = %s, a bound of the rate', async (value) => {
    expect((await topicExtractor({ MOCK_TOPIC_NEW_RATE: value })).mock?.newRate).toBe(
      Number(value),
    );
  });

  it.each([
    ['MOCK_TOPIC_NEW_RATE', '-0.01'],
    ['MOCK_TOPIC_NEW_RATE', '1.01'],
    ['MOCK_TOPIC_NEW_RATE', 'oft'],
    ['MOCK_TOPIC_LATENCY_SECONDS', '-1'],
    ['MOCK_TOPIC_INVALID_CALLS', '0'],
    ['MOCK_TOPIC_INVALID_CALLS', 'eins'],
  ])('refuses %s = %j, naming the variable', async (name, value) => {
    expect((await rejection({ [name]: value })).message).toContain(name);
  });
});
