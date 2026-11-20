// Stage 1, issue #29 (T4), Task 3: configuration of the Claim Extractor (.claude/rules/platform.md: configuration from
// the environment only, validated at startup; .claude/rules/pipeline.md: model ids from configuration, never
// hard-coded), AC17 and the configuration part of AC18 and of the parameters (spec 8 start values, the token estimate
// per word of evals/configs/pricing.json, the ticket's 15 s deadline). The prompt is read from the configured file at
// startup and never compiled in (spec 1: "Die Pipeline übernimmt diese Prompts unverändert").
//
// Public interface these tests define (built in Task 3; names: gate 1, owner 2026-11-03, question 10 "Angenommen"):
//   loadConfig(env) -> { ..., claimExtractor?: ClaimExtractorConfig }
//   MODEL_ADAPTER                     unset or empty: no model adapter, the service runs as before #29 (the frozen
//                                     stage-1 and 2a tests of #25, #27 and #28 start it with Redis settings only;
//                                     gate 1, owner 2026-11-03, question 3); `mock`: the mock adapter of @lfc/providers (T7 adds
//                                     `anthropic`); anything else is refused naming MODEL_ADAPTER
//   With an adapter:
//   CLAIM_EXTRACTOR_PROMPT_FILE       required; the file is read at startup, its text is `instruction`
//   CLAIM_EXTRACTOR_MODEL             default claude-haiku-5-5 (ADR 0004, addendum 2026-10-25)
//   CLAIM_EXTRACTOR_THINKING          off | low, default off
//   CLAIM_EXTRACTOR_MAX_TOKENS        whole number from 1, default 2048 (evals/configs/baseline.json)
//   CLAIM_EXTRACTOR_DEADLINE_SECONDS  above 0, default 15 (ticket Assumptions)
//   CLAIM_EXTRACTOR_TOKENS_PER_WORD   above 0, default 2.1 (pricing.json, claude-haiku-5-5)
//   CONTEXT_TURNS 2, CONTEXT_TOKEN_CAP 600, CLAIM_LIST_CAP 100, CACHE_BLOCK_BREAKPOINT 20 (whole numbers from 1),
//   SCHEMA_RETRIES 1 (whole number from 0): spec 8
//   With MODEL_ADAPTER=mock:
//   MOCK_EXPECTATIONS_FILE            required; a labels.jsonl, read at startup, its text is `mock.expectations`
//   MOCK_LATENCY_SECONDS              at least 0, default 0
//   MOCK_INVALID_CALLS                optional, comma-separated call numbers from 1, default none
//   ClaimExtractorConfig = { adapter: 'mock'; instruction: string; model: string; thinking: 'off' | 'low';
//     maxTokens: number; deadlineSeconds: number; tokensPerWord: number; contextTurns: number; contextTokenCap: number;
//     claimListCap: number; schemaRetries: number; cacheBlockBreakpoint: number;
//     mock?: { expectations: string; latencySeconds: number; invalidCalls: readonly number[] } }
//   An invalid value rejects with an Error (ConfigError of @lfc/service-kit) whose message names the variable and
//   holds no value and no path; startDetection then exits with 1 before the port opens (#25 AC4).
//   env() also sets VERIFIER_PROMPT_FILE: with a model adapter the service refuses to start without it (#30,
//   src/config.verifier.test.ts; owner unlock for #30, gate 1 of #30 on 2026-11-18, answer 1).
import { loadConfig } from './config.ts';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { startDetection } from './main.ts';

type Env = Record<string, string | undefined>;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPO_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'claim_extractor.v2.de.txt');
const REPO_VERIFIER_PROMPT = join(ROOT, 'evals', 'configs', 'prompts', 'verifier.v2.de.txt');
const dir = mkdtempSync(join(tmpdir(), 'lfc-29-config-'));
const redisPasswordPath = join(dir, 'redis_password');
writeFileSync(redisPasswordPath, 'pw-29-config-secret');
const ownPrompt = join(dir, 'eigene-anweisung-29.txt');
writeFileSync(ownPrompt, 'Eine andere Anweisung, nur für diesen Test.\n');
const expectations = join(dir, 'labels-29.jsonl');
writeFileSync(expectations, '{"id": "x-01", "speaker": "Anna Müller", "verbatim": "die Mieten"}\n');
const missing = join(dir, 'gibt-es-nicht-29.txt');
const aDirectory = join(dir, 'ein-verzeichnis-29');
mkdirSync(aDirectory);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
  return port;
}

function env(overrides: Env = {}): Env {
  return {
    PORT: '8080',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_PASSWORD_FILE: redisPasswordPath,
    MODEL_ADAPTER: 'mock',
    CLAIM_EXTRACTOR_PROMPT_FILE: REPO_PROMPT,
    VERIFIER_PROMPT_FILE: REPO_VERIFIER_PROMPT,
    MOCK_EXPECTATIONS_FILE: expectations,
    ...overrides,
  };
}

async function claimExtractor(overrides: Env = {}) {
  const config = (await loadConfig(env(overrides))).claimExtractor;
  if (config === undefined) throw new Error('no claimExtractor configuration');
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

describe('the prompt comes from the configured file (AC17)', () => {
  it('reads the instruction text of claim_extractor.v2.de.txt unchanged', async () => {
    const config = await claimExtractor();
    expect(config.instruction.trim()).toBe(readFileSync(REPO_PROMPT, 'utf8').trim());
  });

  it('reads whatever file is configured, so no prompt text is compiled into the code', async () => {
    const config = await claimExtractor({ CLAIM_EXTRACTOR_PROMPT_FILE: ownPrompt });
    expect(config.instruction.trim()).toBe('Eine andere Anweisung, nur für diesen Test.');
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['a file that does not exist', missing],
    ['a directory, not a readable file', aDirectory],
  ])(
    'refuses CLAIM_EXTRACTOR_PROMPT_FILE %s, naming the variable and not the path',
    async (_, value) => {
      const error = await rejection({ CLAIM_EXTRACTOR_PROMPT_FILE: value });
      expect(error.message).toContain('CLAIM_EXTRACTOR_PROMPT_FILE');
      if (value !== undefined && value !== '') expect(error.message).not.toContain(value);
    },
  );

  it('stops the start with exit code 1 and names the variable on stderr when the prompt file is missing', async () => {
    const stderr: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    });
    const lines: string[] = [];
    let exited: (code: number) => void = () => undefined;
    const exitCode = new Promise<number>((resolve) => {
      exited = resolve;
    });
    const exit = vi.fn((code: number) => {
      exited(code);
    });
    const signals = new EventEmitter();
    const started = startDetection({
      env: env({ PORT: String(await freePort()), CLAIM_EXTRACTOR_PROMPT_FILE: missing }),
      write: (line) => lines.push(line),
      exit,
      signals,
    }).catch(() => undefined);
    await Promise.race([started, new Promise((resolve) => setTimeout(resolve, 2000))]);
    // A service that started although it must not is stopped here, so the test fails instead of hanging.
    signals.emit('SIGTERM');
    await Promise.race([exitCode, new Promise((resolve) => setTimeout(resolve, 3000))]);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr.join('')).toContain('CLAIM_EXTRACTOR_PROMPT_FILE');
    expect([...stderr, ...lines].join('')).not.toContain(missing);
  }, 10_000);
});

describe('the service without a model adapter (gate 1 question 3)', () => {
  it.each([undefined, ''])(
    'has no Claim Extractor configuration when MODEL_ADAPTER is %j',
    async (value) => {
      const config = await loadConfig(
        env({
          MODEL_ADAPTER: value,
          CLAIM_EXTRACTOR_PROMPT_FILE: undefined,
          MOCK_EXPECTATIONS_FILE: undefined,
        }),
      );
      expect(config.claimExtractor).toBeUndefined();
    },
  );

  it('refuses an adapter it does not know, naming MODEL_ADAPTER', async () => {
    expect((await rejection({ MODEL_ADAPTER: 'openai' })).message).toContain('MODEL_ADAPTER');
  });
});

describe('model id and thinking come from configuration per role (AC18)', () => {
  it('takes Haiku 5.5 with thinking off when nothing is set', async () => {
    expect(await claimExtractor()).toMatchObject({
      adapter: 'mock',
      model: 'claude-haiku-5-5',
      thinking: 'off',
    });
  });

  it('passes a configured model id and thinking low through', async () => {
    expect(
      await claimExtractor({
        CLAIM_EXTRACTOR_MODEL: 'claude-sonnet-5-5',
        CLAIM_EXTRACTOR_THINKING: 'low',
      }),
    ).toMatchObject({
      model: 'claude-sonnet-5-5',
      thinking: 'low',
    });
  });

  it.each(['high', 'on', 'LOW'])(
    'refuses thinking %j, naming CLAIM_EXTRACTOR_THINKING',
    async (value) => {
      expect((await rejection({ CLAIM_EXTRACTOR_THINKING: value })).message).toContain(
        'CLAIM_EXTRACTOR_THINKING',
      );
    },
  );
});

describe('parameters have the start values of spec 8 and can be set (ticket: "read from configuration")', () => {
  it('uses the start values when nothing is set', async () => {
    expect(await claimExtractor()).toMatchObject({
      maxTokens: 2048,
      deadlineSeconds: 15,
      tokensPerWord: 2.1,
      contextTurns: 2,
      contextTokenCap: 600,
      claimListCap: 100,
      schemaRetries: 1,
      cacheBlockBreakpoint: 20,
    });
  });

  it('takes set values, schema retries 0 included', async () => {
    expect(
      await claimExtractor({
        CONTEXT_TURNS: '4',
        CONTEXT_TOKEN_CAP: '800',
        CLAIM_LIST_CAP: '1',
        SCHEMA_RETRIES: '0',
        CACHE_BLOCK_BREAKPOINT: '10',
        CLAIM_EXTRACTOR_TOKENS_PER_WORD: '1.6',
        CLAIM_EXTRACTOR_DEADLINE_SECONDS: '8',
        CLAIM_EXTRACTOR_MAX_TOKENS: '1024',
      }),
    ).toMatchObject({
      contextTurns: 4,
      contextTokenCap: 800,
      claimListCap: 1,
      schemaRetries: 0,
      cacheBlockBreakpoint: 10,
      tokensPerWord: 1.6,
      deadlineSeconds: 8,
      maxTokens: 1024,
    });
  });

  it.each([
    ['CONTEXT_TURNS', '0'],
    ['CONTEXT_TOKEN_CAP', '-1'],
    ['CLAIM_LIST_CAP', '1.5'],
    ['SCHEMA_RETRIES', '-1'],
    ['CACHE_BLOCK_BREAKPOINT', 'zwanzig'],
    ['CLAIM_EXTRACTOR_TOKENS_PER_WORD', '0'],
    ['CLAIM_EXTRACTOR_DEADLINE_SECONDS', '0'],
    ['CLAIM_EXTRACTOR_MAX_TOKENS', '0'],
  ])('refuses %s=%s, naming the variable', async (name, value) => {
    expect((await rejection({ [name]: value })).message).toContain(name);
  });
});

describe('the mock adapter is configured from the environment (AC19)', () => {
  it('reads the expectations file and takes latency and invalid calls', async () => {
    const config = await claimExtractor({ MOCK_LATENCY_SECONDS: '0.5', MOCK_INVALID_CALLS: '1,2' });
    expect(config.mock).toEqual({
      expectations: readFileSync(expectations, 'utf8'),
      latencySeconds: 0.5,
      invalidCalls: [1, 2],
    });
  });

  it('uses latency 0 and no invalid call when they are not set', async () => {
    expect((await claimExtractor()).mock).toMatchObject({ latencySeconds: 0, invalidCalls: [] });
  });

  it.each([
    ['MOCK_EXPECTATIONS_FILE', 'unset', undefined],
    ['MOCK_EXPECTATIONS_FILE', 'a file that does not exist', missing],
    ['MOCK_LATENCY_SECONDS', '-0.5', '-0.5'],
    ['MOCK_INVALID_CALLS', '0', '0'],
    ['MOCK_INVALID_CALLS', 'eins', 'eins'],
  ])('refuses %s %s, naming the variable', async (name, _, value) => {
    expect((await rejection({ [name]: value })).message).toContain(name);
  });
});
