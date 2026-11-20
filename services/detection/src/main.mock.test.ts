// Stage 1, issue #29 task 3 (implementer-owned, review finding M3c): an expectations file the mock adapter cannot
// parse stops the start like any configuration error (#25 AC4: exit 1 before the port opens). stderr names
// MOCK_EXPECTATIONS_FILE and nothing of the file: labels carry Transcript text and names. Pattern of the frozen
// config.claim-extractor.test.ts ("stops the start with exit code 1 …"); no Redis is reached before the exit.
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { startDetection } from './main.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'lfc-29-mock-'));
const passwordPath = join(dir, 'redis_password');
writeFileSync(passwordPath, 'pw-29-mock\n');
const LABEL_TEXT = 'Mietpreisbremse wirkt kaum';
const SPEAKER = 'Anna Geheim';
// A label without `start`, `sentence`, `type`, … : parseExpectations refuses it.
const expectations = join(dir, 'labels-unparsable.jsonl');
writeFileSync(
  expectations,
  `${JSON.stringify({ id: 'x-01', speaker: SPEAKER, verbatim: LABEL_TEXT })}\n`,
);

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

describe('the start with an expectations file the mock cannot parse (review M3c)', () => {
  it('exits with 1, names MOCK_EXPECTATIONS_FILE on stderr and writes nothing of the file', async () => {
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
      env: {
        PORT: String(await freePort()),
        REDIS_URL: 'redis://127.0.0.1:6379',
        REDIS_PASSWORD_FILE: passwordPath,
        MODEL_ADAPTER: 'mock',
        CLAIM_EXTRACTOR_PROMPT_FILE: join(
          ROOT,
          'evals',
          'configs',
          'prompts',
          'claim_extractor.v2.de.txt',
        ),
        // With a model adapter the service will refuse to start without it (#30, owner unlock of 2026-11-19).
        VERIFIER_PROMPT_FILE: join(ROOT, 'evals', 'configs', 'prompts', 'verifier.v2.de.txt'),
        MOCK_EXPECTATIONS_FILE: expectations,
      },
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
    expect(stderr.join('')).toContain('MOCK_EXPECTATIONS_FILE');
    const written = [...stderr, ...lines].join('');
    for (const text of [LABEL_TEXT, 'Mietpreisbremse', SPEAKER, 'Geheim', expectations]) {
      expect(written).not.toContain(text);
    }
  }, 10_000);
});
