// Stage 1 of the Session routes (#27, review round 2, R2 and M13) against an in-memory SessionStore, over real
// HTTP on a loopback port: the answers the stage-2a scenarios do not reach (405, 413, 415, 503, 409 full, ids that
// are not a Session's) and when `segment.accepted` is logged. The store here is a fake of the interface, never Redis.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Segment } from '@lfc/contracts';
import { segmentFixture } from '@lfc/contracts/testing';
import { createLogger } from '@lfc/service-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { createSessionRoutes } from './routes.ts';
import { MAX_BODY_BYTES } from './segment-input.ts';
import type { AppendOutcome, SessionState, SessionStore } from './store.ts';

const SESSION = '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10'; // the sessionId of segmentFixture
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

/**
 * An in-memory store: appends answer `outcome`, create answers `create`, state knows only the Session `known`;
 * `calls` counts every use.
 */
function fakeStore(
  outcome: AppendOutcome = 'accepted',
  create: SessionState | 'full' = 'full',
  known?: SessionState,
) {
  const calls: string[] = [];
  const store: SessionStore = {
    create: () => {
      calls.push('create');
      return Promise.resolve(create);
    },
    append: (sessionId: string, segment: Segment) => {
      calls.push(`append ${sessionId} ${segment.id}`);
      return Promise.resolve(outcome);
    },
    state: (sessionId: string) => {
      calls.push(`state ${sessionId}`);
      return Promise.resolve(sessionId === known?.id ? known : undefined);
    },
  };
  return { store, calls };
}

/** A store whose Redis is away: every call rejects with an error text that must not reach a log line. */
const failingStore: SessionStore = {
  create: () => Promise.reject(new Error('connect ECONNREFUSED redis-secret-host:6379')),
  append: () => Promise.reject(new Error('connect ECONNREFUSED redis-secret-host:6379')),
  state: () => Promise.reject(new Error('connect ECONNREFUSED redis-secret-host:6379')),
};

async function serve(store: SessionStore): Promise<{ port: number; lines: string[] }> {
  const lines: string[] = [];
  const logger = createLogger({ service: 'detection', write: (line) => lines.push(line) });
  const server = createServer(createSessionRoutes({ store, logger }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, lines };
}

interface Answer {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
}

async function call(
  port: number,
  method: string,
  path: string,
  body?: string,
  type = 'application/json',
): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': type },
    body: body ?? null,
    // A route that never answers fails its test instead of hanging it.
    signal: AbortSignal.timeout(2000),
  });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

const segmentBody = JSON.stringify(segmentFixture);
const segmentsPath = `/sessions/${SESSION}/segments`;

/** The `error` of a JSON answer; its wording has no source, only that it is there and a text. */
function errorOf(body: string): unknown {
  return (JSON.parse(body) as { error?: unknown }).error;
}

function events(lines: readonly string[]): unknown[] {
  return lines.map((line) => (JSON.parse(line) as { event: unknown }).event);
}

describe('createSessionRoutes', () => {
  it.each([
    { method: 'GET', path: '/sessions', allow: 'POST' },
    { method: 'POST', path: `/sessions/${SESSION}`, allow: 'GET' },
    { method: 'PUT', path: segmentsPath, allow: 'POST' },
  ])(
    'answers $method $path with 405, allow $allow and a JSON error, and never asks the store',
    async ({ method, path, allow }) => {
      const { store, calls } = fakeStore();
      const { port } = await serve(store);
      const answer = await call(port, method, path);
      expect([answer.status, answer.headers.get('allow'), typeof errorOf(answer.body)]).toEqual([
        405,
        allow,
        'string',
      ]);
      expect(calls).toEqual([]);
    },
  );

  it.each(['/', '/session', '/sessions/x/segments/more', `/sessions/${SESSION}/words`])(
    'answers the unknown path %s with 404 not found',
    async (path) => {
      const { port } = await serve(fakeStore().store);
      const answer = await call(port, 'GET', path);
      expect([answer.status, answer.body]).toEqual([404, '{"error":"not found"}']);
    },
  );

  it.each(['not-a-uuid', SESSION.toUpperCase(), `${SESSION}0`, `0${SESSION}`, 'session:x'])(
    'answers the id %s with 404 Session unknown and never asks the store',
    async (id) => {
      const { store, calls } = fakeStore();
      const { port } = await serve(store);
      expect((await call(port, 'GET', `/sessions/${id}`)).status).toBe(404);
      const answer = await call(port, 'POST', `/sessions/${id}/segments`, segmentBody);
      expect([answer.status, answer.body]).toEqual([404, '{"error":"Session unknown"}']);
      expect(calls).toEqual([]);
    },
  );

  it('answers a body over the limit with 413, closes the connection and never asks the store', async () => {
    const { store, calls } = fakeStore();
    const { port } = await serve(store);
    const answer = await call(port, 'POST', segmentsPath, 'x'.repeat(MAX_BODY_BYTES + 1));
    expect([answer.status, answer.headers.get('connection'), typeof errorOf(answer.body)]).toEqual([
      413,
      'close',
      'string',
    ]);
    expect(answer.body).not.toContain('xxx');
    expect(calls).toEqual([]);
  });

  it('answers a body that is not application/json with 415, closes the connection and never asks the store', async () => {
    const { store, calls } = fakeStore();
    const { port } = await serve(store);
    const answer = await call(port, 'POST', segmentsPath, segmentBody, 'text/plain');
    expect([answer.status, answer.headers.get('connection'), typeof errorOf(answer.body)]).toEqual([
      415,
      'close',
      'string',
    ]);
    expect(answer.body).not.toContain('text/plain');
    expect(calls).toEqual([]);
  });

  it('accepts application/json with a charset', async () => {
    const { port } = await serve(fakeStore().store);
    const answer = await call(
      port,
      'POST',
      segmentsPath,
      segmentBody,
      'application/json; charset=utf-8',
    );
    expect(answer.status).toBe(204);
  });

  it('accepts application/json with whitespace before its parameters', async () => {
    const { port } = await serve(fakeStore().store);
    const answer = await call(
      port,
      'POST',
      segmentsPath,
      segmentBody,
      'application/json ; charset=utf-8',
    );
    expect(answer.status).toBe(204);
  });

  it('answers 503 when the store fails and logs no error text', async () => {
    const { port, lines } = await serve(failingStore);
    const answer = await call(port, 'POST', segmentsPath, segmentBody);
    expect([answer.status, answer.body]).toEqual([503, '{"error":"Session store unavailable"}']);
    expect(events(lines)).toEqual(['session.request_failed']);
    expect(lines.join('')).not.toMatch(/ECONNREFUSED|secret-host|6379/);
  });

  it('answers a full Session with 409 and a fixed text naming no number', async () => {
    const { port, lines } = await serve(fakeStore('full').store);
    const answer = await call(port, 'POST', segmentsPath, segmentBody);
    expect([answer.status, answer.body]).toEqual([409, '{"error":"Session full"}']);
    expect(lines).toEqual([]);
  });

  it('answers 409 with a fixed text when no room is left for another Session', async () => {
    const { port } = await serve(fakeStore('accepted', 'full').store);
    const answer = await call(port, 'POST', '/sessions');
    expect([answer.status, answer.body]).toEqual([409, '{"error":"no room for another Session"}']);
  });

  it('answers 422 naming sessionId when the Segment belongs to another Session', async () => {
    const { store, calls } = fakeStore();
    const { port } = await serve(store);
    const other = '27a0c0de-0000-4000-8000-000000000013';
    const answer = await call(port, 'POST', `/sessions/${other}/segments`, segmentBody);
    expect(answer.status).toBe(422);
    expect(JSON.parse(answer.body)).toEqual({
      error: 'Segment belongs to another Session',
      fields: ['sessionId'],
    });
    expect(calls).toEqual([]);
  });

  it('logs segment.accepted once, with the Session id and the Segment id, after the store took it', async () => {
    const { store, calls } = fakeStore('accepted');
    const { port, lines } = await serve(store);
    expect((await call(port, 'POST', segmentsPath, segmentBody)).status).toBe(204);
    expect(calls).toEqual([`append ${SESSION} s-0412`]);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({
        event: 'segment.accepted',
        sessionId: SESSION,
        segmentId: 's-0412',
      }),
    ]);
  });

  it.each(['unknown', 'not-after', 'full'] as const)(
    'logs nothing when the store answers %s',
    async (outcome) => {
      const { port, lines } = await serve(fakeStore(outcome).store);
      expect((await call(port, 'POST', segmentsPath, segmentBody)).status).toBeGreaterThanOrEqual(
        400,
      );
      expect(lines).toEqual([]);
    },
  );

  // Kills routes.ts:82 (case 'unknown' without a body falls through to 409 not-after).
  it('answers 404 Session unknown when the store does not know the Session', async () => {
    const { port } = await serve(fakeStore('unknown').store);
    const answer = await call(port, 'POST', segmentsPath, segmentBody);
    expect([answer.status, answer.body]).toEqual([404, '{"error":"Session unknown"}']);
  });

  it('logs nothing for a Segment that violates the contract', async () => {
    const { port, lines } = await serve(fakeStore().store);
    const body = JSON.stringify({ ...segmentFixture, speaker: 'Kallac Haqy' });
    const answer = await call(port, 'POST', segmentsPath, body);
    expect([answer.status, JSON.parse(answer.body)]).toEqual([
      400,
      { error: 'Segment violates the segment contract', fields: ['speaker'] },
    ]);
    expect(lines).toEqual([]);
  });
});

const knownState: SessionState = {
  id: SESSION,
  segments: 3,
  lastSegmentId: 's-0412',
  lastFinalizedAt: 14.01,
  remainingSeconds: 812,
};

describe('createSessionRoutes, Session state and creation', () => {
  it('answers GET for a known Session with 200 and its state', async () => {
    const { store, calls } = fakeStore('accepted', 'full', knownState);
    const { port } = await serve(store);
    const answer = await call(port, 'GET', `/sessions/${SESSION}`);
    expect([answer.status, JSON.parse(answer.body)]).toEqual([200, knownState]);
    expect(answer.headers.get('content-type')).toBe('application/json');
    expect(calls).toEqual([`state ${SESSION}`]);
  });

  it('answers GET for a well-formed id the store does not know with 404 Session unknown', async () => {
    const other = '27a0c0de-0000-4000-8000-000000000014';
    const { store, calls } = fakeStore('accepted', 'full', knownState);
    const { port } = await serve(store);
    const answer = await call(port, 'GET', `/sessions/${other}`);
    expect([answer.status, answer.body]).toEqual([404, '{"error":"Session unknown"}']);
    expect(calls).toEqual([`state ${other}`]);
  });

  it('answers POST /sessions with 201 and the state of the new Session, its id included', async () => {
    const created: SessionState = {
      ...knownState,
      segments: 0,
      lastSegmentId: null,
      lastFinalizedAt: null,
    };
    const { port } = await serve(fakeStore('accepted', created).store);
    const answer = await call(port, 'POST', '/sessions');
    expect([answer.status, JSON.parse(answer.body)]).toEqual([201, created]);
  });
});

describe('createSessionRoutes, answers', () => {
  it('answers 409 naming the field id when the Segment is not after the last accepted one', async () => {
    const { port } = await serve(fakeStore('not-after').store);
    const answer = await call(port, 'POST', segmentsPath, segmentBody);
    expect([answer.status, JSON.parse(answer.body)]).toEqual([
      409,
      { error: 'Segment is not after the last accepted Segment', fields: ['id'] },
    ]);
  });

  it('answers an accepted Segment with 204, no-store, no content type and a connection kept open', async () => {
    const { port } = await serve(fakeStore('accepted').store);
    const answer = await call(port, 'POST', segmentsPath, segmentBody);
    expect([
      answer.status,
      answer.body,
      answer.headers.get('cache-control'),
      answer.headers.get('content-type'),
    ]).toEqual([204, '', 'no-store', null]);
    expect(answer.headers.get('connection')).not.toBe('close');
  });

  it('answers a rejection with JSON, no-store and a connection kept open', async () => {
    const { port } = await serve(fakeStore('full').store);
    const answer = await call(port, 'POST', segmentsPath, segmentBody);
    expect([
      answer.status,
      answer.headers.get('cache-control'),
      answer.headers.get('content-type'),
    ]).toEqual([409, 'no-store', 'application/json']);
    expect(answer.headers.get('connection')).not.toBe('close');
  });
});
