// Stage 1 (stock review of 2026-11-20, finding "errors are caught and discarded without any diagnostic"): what a
// failed request of the Session routes answers and logs. Source of the expectations: docs/CODING_STANDARDS.md
// "Honest errors" (a programming error never looks like an unavailable dependency) and .claude/rules/platform.md
// "Logging and health" (never an error text in a log line; `reason` is a code). The store is a fake of the
// interface, over real HTTP on a loopback port, as in routes.test.ts.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { segmentFixture } from '@lfc/contracts/testing';
import { createLogger } from '@lfc/service-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionRoutes } from './routes.ts';
import type { SessionStore } from './store.ts';

const SESSION = '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10'; // the sessionId of segmentFixture
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

/** A store whose every call rejects with the given error. */
function rejecting(error: Error): SessionStore {
  return {
    create: () => Promise.reject(error),
    append: () => Promise.reject(error),
    state: () => Promise.reject(error),
  };
}

async function post(
  store: SessionStore,
): Promise<{ status: number; body: string; lines: string[] }> {
  const lines: string[] = [];
  const logger = createLogger({ service: 'detection', write: (line) => lines.push(line) });
  const server = createServer(createSessionRoutes({ store, logger }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/sessions/${SESSION}/segments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(segmentFixture),
    signal: AbortSignal.timeout(2000),
  });
  return { status: response.status, body: await response.text(), lines };
}

function logged(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('createSessionRoutes: a failed request tells an outage from a bug', () => {
  it('answers 503 for a store that is away and logs the class of the error as reason', async () => {
    const away = new Error('connect ECONNREFUSED redis-secret-host:6379');
    const { status, body, lines } = await post(rejecting(away));
    expect([status, body]).toEqual([503, '{"error":"Session store unavailable"}']);
    const [line] = logged(lines);
    expect(line).toMatchObject({ event: 'session.request_failed', reason: 'Error' });
  });

  it('answers 500 for a programming error and logs its class, so it is not taken for an outage', async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'secret-field')");
    const { status, body, lines } = await post(rejecting(bug));
    expect([status, body]).toEqual([500, '{"error":"internal error"}']);
    const [line] = logged(lines);
    expect(line).toMatchObject({ event: 'session.request_failed', reason: 'TypeError' });
  });

  it.each([
    { what: 'an outage', error: new Error('connect ECONNREFUSED redis-secret-host:6379') },
    { what: 'a programming error', error: new TypeError('redis-secret-host:6379 is not iterable') },
  ])('never writes the error text of $what to the log or the answer', async ({ error }) => {
    const { body, lines } = await post(rejecting(error));
    expect(lines.join('') + body).not.toMatch(/ECONNREFUSED|secret-host|6379|iterable/);
  });

  it('logs exactly one line per failed request', async () => {
    const { lines } = await post(rejecting(new RangeError('out of range')));
    expect(logged(lines).map((l) => l['event'])).toEqual(['session.request_failed']);
  });
});
