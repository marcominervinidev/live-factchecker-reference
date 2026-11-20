// Stage 1 of the Session wiring in main.ts (ticket #27, Task 3), in-process and without any container, like
// main.test.ts (#25, frozen): Redis is pointed at a loopback port where nothing listens. What shows without a Redis
// connection: the effective Session lifetime is logged once at start-up, and the Session routes are wired to the
// service's logger and a store on that connection (POST /sessions answers 503 and logs `session.request_failed`).
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { startDetection } from './main.ts';

const dir = mkdtempSync(join(tmpdir(), 'lfc-27-main-session-'));
const secretFile = join(dir, 'redis_password');
// Throwaway test value, not a credential.
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
writeFileSync(secretFile, 'redis-dummy-27-main-session');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A loopback port that was free a moment ago; nothing listens on it afterwards. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(new Error(`${what} did not happen within ${ms} ms`));
      }, ms),
    ),
  ]);
}

describe('startDetection, Session wiring with Redis unreachable', () => {
  it('logs the Session lifetime once and answers POST /sessions with 503 from the wired Session routes', async () => {
    const port = await freePort();
    const redisPort = await freePort();
    const lines: string[] = [];
    const signals = new EventEmitter();
    let resolveExit: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    // startDetection settles once the port is open (runService has listened and logged service.started).
    await startDetection({
      env: {
        PORT: String(port),
        REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        REDIS_PASSWORD_FILE: secretFile,
        SESSION_LIFETIME_SECONDS: '6',
      },
      write: (line) => {
        lines.push(line);
      },
      exit: (code) => {
        resolveExit(code);
      },
      signals,
    });
    try {
      const answer = await fetch(`http://127.0.0.1:${port}/sessions`, {
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      });
      expect([answer.status, await answer.text()]).toEqual([
        503,
        '{"error":"Session store unavailable"}',
      ]);
      const entries = lines.map(
        (line) => JSON.parse(line) as { event: string; durationMs?: number },
      );
      expect(entries.filter((entry) => entry.event === 'session.lifetime')).toEqual([
        expect.objectContaining({ event: 'session.lifetime', durationMs: 6000 }),
      ]);
      expect(entries.map((entry) => entry.event)).toContain('session.request_failed');
    } finally {
      signals.emit('SIGTERM');
      await within(exited, 10_000, 'exit after SIGTERM');
    }
  });
});
