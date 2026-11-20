// Stage 1, issue #25 (T1), AC5 and the body rule of AC6: the probe endpoints of the service kit
// (`.claude/rules/platform.md`, "Logging and health": `/health` = process up, `/ready` = dependencies reachable).
// AC6 against a real Redis is stage 2a (services/detection/features/readiness.feature).
//
// Public interface these tests define (built in Task 2):
//   createProbeHandler({ checks }) -> a node:http request listener serving GET /health and GET /ready
//   checks: Record<dependencyName, () => Promise<unknown>>; a check that resolves means "ok", one that rejects "failed".
//   /ready body: JSON in which every dependency name carries the string "ok" or "failed".
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createProbeHandler } from './health.ts';
import { dependencyStates } from './testing/probe-body.ts';

type Checks = Parameters<typeof createProbeHandler>[0]['checks'];

const servers: Server[] = [];

async function serve(checks: Checks): Promise<string> {
  const server = createServer(createProbeHandler({ checks }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function get(base: string, path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(2000) });
  return { status: response.status, body: await response.text() };
}

const ok = (): Promise<void> => Promise.resolve();
const unreachable = (): Promise<never> =>
  Promise.reject(new Error('connect ECONNREFUSED 10.25.0.7:6379 (AUTH hunter-25-ready failed)'));
const neverSettles = (): Promise<never> => new Promise<never>(() => undefined);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('/health (AC5)', () => {
  it('answers 200 while every dependency check fails', async () => {
    const base = await serve({ redis: unreachable });
    expect((await get(base, '/health')).status).toBe(200);
  });

  it('answers 200 at once even when a dependency check never settles', async () => {
    const base = await serve({ redis: neverSettles });
    expect((await get(base, '/health')).status).toBe(200);
  });
});

describe('/ready (AC6, body rule)', () => {
  it('answers 200 and names every dependency ok when every check succeeds', async () => {
    const base = await serve({ redis: ok, search: ok });
    const answer = await get(base, '/ready');
    expect(answer.status).toBe(200);
    expect(dependencyStates(answer.body)).toEqual({ redis: 'ok', search: 'ok' });
  });

  it('answers 503 and names the failing dependency failed and the others ok when one check fails', async () => {
    const base = await serve({ redis: unreachable, search: ok });
    const answer = await get(base, '/ready');
    expect(answer.status).toBe(503);
    expect(dependencyStates(answer.body)).toEqual({ redis: 'failed', search: 'ok' });
  });

  it('puts no host, no port, no error text and no secret from a failing check into the body', async () => {
    const base = await serve({ redis: unreachable });
    const { body } = await get(base, '/ready');
    for (const leak of ['10.25.0.7', '6379', 'ECONNREFUSED', 'AUTH', 'hunter-25-ready']) {
      expect(body).not.toContain(leak);
    }
  });
});
