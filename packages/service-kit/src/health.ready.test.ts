// Stage 1 of /ready beyond the frozen tests (#25 round 3): the 2 s check timeout (B6) and the stop that arrives
// while a check runs (B4). Fake timers for setTimeout only; the HTTP exchange is real, over node:http.
import { createServer, get as httpGet, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProbeHandler, type ProbeOptions } from './health.ts';

// Gate-1 decision 3 (#25): a check that hangs longer than 2 s counts as failed.
const CHECK_TIMEOUT_MS = 2000;

const servers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function serve(options: ProbeOptions): Promise<number> {
  const server = createServer(createProbeHandler(options));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

interface Answer {
  status: number;
  connection: string | undefined;
  body: string;
}

function ask(port: number, path: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path, agent: false }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      response.on('end', () => {
        const { connection } = response.headers;
        resolve({ status: response.statusCode ?? 0, connection, body });
      });
    }).on('error', reject);
  });
}

async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

describe('/ready check timeout', () => {
  it('answers 503 with the dependency failed once a check hangs for the timeout, not before', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let asked = false;
    const port = await serve({
      checks: {
        redis: () => {
          asked = true;
          return new Promise<never>(() => undefined);
        },
      },
    });
    let answer: Answer | undefined;
    void ask(port, '/ready').then((a) => (answer = a));
    await until(() => asked);
    await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS - 1);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await until(() => answer !== undefined);
    expect(answer?.status).toBe(503);
    expect(JSON.parse(answer?.body ?? '{}')).toMatchObject({ dependencies: { redis: 'failed' } });
  });
});

describe('/ready during the stop', () => {
  it('answers 503 stopping, never 200, when the stop begins while a passing check runs', async () => {
    let accepting = true;
    let pass: (() => void) | undefined;
    const port = await serve({
      checks: { redis: () => new Promise<void>((resolve) => (pass = resolve)) },
      accepting: () => accepting,
    });
    const answer = ask(port, '/ready');
    await until(() => pass !== undefined);
    accepting = false;
    pass?.();
    const { status, connection, body } = await answer;
    expect(status).toBe(503);
    expect(connection).toBe('close');
    expect(JSON.parse(body)).toEqual({ ready: false, stopping: true });
  });
});
