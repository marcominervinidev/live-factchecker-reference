// Stage 1, issue #25 (T1), AC4 (no port on a bad configuration) and AC5 (/health checks no dependency), for the
// detection service as a whole, in-process and without any container: Redis is pointed at a loopback port where
// nothing listens.
//
// Public interface these tests define (built in Task 2; the same one the stage-2a steps use):
//   startDetection({ env, write?, exit?, signals? }) -> Promise   (main.ts must not start anything on import)
//     env      the environment to read (process.env in production)
//     write    sink for log lines (defaults to stdout)
//     exit     called once with the exit code (defaults to process.exit)
//     signals  where SIGTERM arrives (defaults to process)
//   On an invalid configuration it calls exit with a non-zero code without opening its port, and its promise settles.
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { startDetection } from './main.ts';

type Env = Record<string, string | undefined>;

const dir = mkdtempSync(join(tmpdir(), 'lfc-25-main-'));
const secretFile = join(dir, 'redis_password');
const SECRET = 'pw-25-main-secret';
writeFileSync(secretFile, SECRET);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// A loopback port that was free a moment ago; nothing listens on it afterwards.
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

interface Run {
  readonly port: number;
  readonly output: () => string;
  readonly exited: Promise<number>;
  readonly signals: EventEmitter;
  // /health probed from just before startDetection is called until just after exit: attempts and answers.
  readonly probes: Promise<{ attempts: number; answered: number }>;
}

// Asks /health over and over until `done` settles, then once more; counts the attempts the port answered at all.
async function probeUntil(port: number, done: Promise<unknown>): Promise<{ attempts: number; answered: number }> {
  let finished = false;
  void done.then(() => {
    finished = true;
  });
  let attempts = 0;
  let answered = 0;
  for (let last = false; !last; ) {
    last = finished;
    attempts += 1;
    const answer = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(250) }).then(
      () => true,
      () => false,
    );
    if (answer) answered += 1;
    if (!last) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { attempts, answered };
}

async function start(overrides: Env): Promise<Run> {
  const port = await freePort();
  const redisPort = await freePort();
  const lines: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(' '));
  });
  const signals = new EventEmitter();
  let resolveExit: (code: number) => void = () => undefined;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const env: Env = {
    PORT: String(port),
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    REDIS_PASSWORD_FILE: secretFile,
    ...overrides,
  };
  const probes = probeUntil(port, within(exited, 10_000, 'exit').catch(() => undefined));
  // Whether the promise resolves or rejects is not part of the contract; exit and the port are.
  startDetection({
    env,
    write: (line: string) => {
      lines.push(line);
    },
    exit: (code: number) => {
      resolveExit(code);
    },
    signals,
  }).catch(() => undefined);
  return { port, output: () => [...lines, ...stderr].join('\n'), exited, signals, probes };
}

// Polls until the service answers (any status) or the deadline passes; returns the first answer.
async function firstAnswer(port: number, path: string, deadlineMs: number): Promise<Response> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    try {
      return await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1000) });
    } catch (error) {
      if (Date.now() > until) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function refuses(port: number): Promise<boolean> {
  return fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).then(
    () => false,
    () => true,
  );
}

// Builds a Redis URL with credentials at runtime (a throwaway test token, never a real secret).
function urlWithPassword(base: string, password: string): string {
  const url = new URL(base);
  url.username = 'default';
  url.password = password;
  return url.toString();
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), ms)),
  ]);
}

describe('startDetection with an invalid configuration (AC4)', () => {
  it.each([
    { invalidClass: 'REDIS_URL missing', name: 'REDIS_URL', overrides: { REDIS_URL: undefined }, value: undefined },
    {
      invalidClass: 'REDIS_URL carrying a password',
      name: 'REDIS_URL',
      overrides: { REDIS_URL: urlWithPassword('redis://127.0.0.1:6379', 'hunter-25-main') },
      value: 'hunter-25-main',
    },
    {
      invalidClass: 'REDIS_PASSWORD_FILE unreadable',
      name: 'REDIS_PASSWORD_FILE',
      overrides: { REDIS_PASSWORD_FILE: join(dir, 'gone-25-main') },
      value: 'gone-25-main',
    },
  ])('exits non-zero with $invalidClass, names $name, prints no value and never answers /health', async ({ name, overrides, value }) => {
    const run = await start(overrides);
    const code = await within(run.exited, 2000, 'exit');
    expect(code).not.toBe(0);
    // Never open, not even for a moment before the exit: every probe from start to exit was refused.
    const probes = await run.probes;
    expect(probes.attempts).toBeGreaterThan(1);
    expect(probes.answered).toBe(0);
    expect(await refuses(run.port)).toBe(true);
    expect(run.output()).toContain(name);
    if (value !== undefined) expect(run.output()).not.toContain(value);
    expect(run.output()).not.toContain(SECRET);
  });
});

describe('startDetection with Redis unreachable (AC5)', () => {
  it('answers /health with 200 although Redis cannot be reached', async () => {
    const run = await start({});
    try {
      expect((await firstAnswer(run.port, '/health', 5000)).status).toBe(200);
    } finally {
      run.signals.emit('SIGTERM');
      await within(run.exited, 10_000, 'exit after SIGTERM');
      await run.probes;
    }
  });
});
