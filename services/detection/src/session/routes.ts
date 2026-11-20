// The Session routes of the detection service (ticket #27; internal: the edge does not route them, AC13). Every
// answer is JSON; a rejection names the failing fields or says "Session unknown", never a word of the Segment.
//   POST /sessions                  201 the state of the new Session | 400 Setting invalid | 409 no room (MAX_SESSIONS
//                                   live) | 413 | 415; optional body { setting?, speakerNames? } (#29, session-start.ts)
//   POST /sessions/{id}/segments    204 accepted | 400 contract, or body incomplete (client gone; not logged)
//                                   | 404 Session unknown | 409 not after the last Segment, or Session full (byte
//                                   budget) | 413 body over 512 KiB | 415 not JSON | 422 other sessionId
//   GET  /sessions/{id}             200 { id, segments, lastSegmentId, lastFinalizedAt, remainingSeconds } | 404
//   POST /sessions/{id}/end         204 once every call of the Session has returned, also a second time | 404 (#29;
//                                   gate 1 of #29, question 2: „Eigene interne Route `POST /sessions/{id}/end`“)
// An accepted Segment writes one log event `segment.accepted` with the Session id and the Segment id only, then goes
// to the Session's analysis (session-pipelines.ts) when the service runs one.
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

import type { Segment } from '@lfc/contracts';
import type { Logger } from '@lfc/service-kit';

import { parseSegment, readBody } from './segment-input.ts';
import type { SessionPipelines } from './session-pipelines.ts';
import { parseSessionStart } from './session-start.ts';
import type { AppendOutcome, SessionStore } from './store.ts';

export interface SessionRoutesOptions {
  readonly store: SessionStore;
  readonly logger: Logger;
  /** The analysis of each Session; absent without a model adapter (MODEL_ADAPTER unset). */
  readonly pipelines?: SessionPipelines | undefined;
}

/** The form of the ids the store hands out (randomUUID); anything else is no Session and never reaches Redis. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const UNKNOWN = { error: 'Session unknown' } as const;

/** One answer: status, JSON body if any, and whether the connection closes (the request body was not read whole). */
interface Answer {
  readonly status: number;
  readonly body?: object;
  readonly close?: boolean;
}

/** What a route does once path and method match; parameters it does not need are left off. */
type Handler = (
  response: ServerResponse,
  options: SessionRoutesOptions,
  request: IncomingMessage,
) => Promise<void>;

type SessionHandler = (
  response: ServerResponse,
  options: SessionRoutesOptions,
  sessionId: string,
  request: IncomingMessage,
) => Promise<void>;

interface Target {
  readonly method: 'GET' | 'POST';
  readonly handle: Handler;
}

/** A Segment either passed every check before the store or is refused with its answer. */
type Received =
  | { readonly ok: true; readonly segment: Segment }
  | { readonly ok: false; readonly answer: Answer };

function send(response: ServerResponse, status: number, body?: object, close = false): void {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (close) headers['connection'] = 'close';
  response.writeHead(status, headers);
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function answer(response: ServerResponse, { status, body, close }: Answer): void {
  send(response, status, body, close);
}

function rejected(status: number, error: string, fields: readonly string[]): Answer {
  return { status, body: { error, fields } };
}

function refused(refusal: Answer): Received {
  return { ok: false, answer: refusal };
}

const NOT_JSON: Answer = {
  status: 415,
  body: { error: 'Segment must be sent as application/json' },
  close: true,
};

const SETTING_NOT_JSON: Answer = {
  status: 415,
  body: { error: 'Setting must be sent as application/json' },
};

// An aborted upload is the client's doing: answered if anyone still listens, never logged as a store failure.
const BODY_REFUSED: Readonly<Record<'too-large' | 'aborted', Answer>> = {
  'too-large': { status: 413, body: { error: 'body too large' }, close: true },
  aborted: { status: 400, body: { error: 'body incomplete' }, close: true },
};

const OTHER_SESSION = rejected(422, 'Segment belongs to another Session', ['sessionId']);

const APPEND_REFUSED: Readonly<Record<Exclude<AppendOutcome, 'accepted'>, Answer>> = {
  unknown: { status: 404, body: UNKNOWN },
  'not-after': rejected(409, 'Segment is not after the last accepted Segment', ['id']),
  full: { status: 409, body: { error: 'Session full' } },
};

/** `application/json`, with or without parameters such as `; charset=utf-8`. */
function isJson(request: IncomingMessage): boolean {
  const type = (request.headers['content-type'] ?? '').split(';')[0] ?? '';
  return type.trim().toLowerCase() === 'application/json';
}

function checkSegment(text: string, sessionId: string): Received {
  const input = parseSegment(text);
  if (!input.ok)
    return refused(rejected(400, 'Segment violates the segment contract', input.fields));
  if (input.segment.sessionId !== sessionId) return refused(OTHER_SESSION);
  return { ok: true, segment: input.segment };
}

async function receiveSegment(request: IncomingMessage, sessionId: string): Promise<Received> {
  if (!isJson(request)) return refused(NOT_JSON);
  const body = await readBody(request);
  if (!body.ok) return refused(BODY_REFUSED[body.reason]);
  return checkSegment(body.text, sessionId);
}

async function acceptSegment(
  response: ServerResponse,
  options: SessionRoutesOptions,
  sessionId: string,
  request: IncomingMessage,
): Promise<void> {
  const received = await receiveSegment(request, sessionId);
  if (!received.ok) {
    answer(response, received.answer);
    return;
  }
  const outcome = await options.store.append(sessionId, received.segment);
  if (outcome !== 'accepted') {
    answer(response, APPEND_REFUSED[outcome]);
    return;
  }
  // Logged only once the store has taken the Segment; a rejection or a failing store logs no accept.
  send(response, 204);
  options.logger.log({ event: 'segment.accepted', sessionId, segmentId: received.segment.id });
  options.pipelines?.accept(sessionId, received.segment);
}

async function endInput(
  response: ServerResponse,
  options: SessionRoutesOptions,
  sessionId: string,
): Promise<void> {
  if ((await options.store.state(sessionId)) === undefined) {
    send(response, 404, UNKNOWN);
    return;
  }
  await options.pipelines?.end(sessionId);
  send(response, 204);
}

async function readState(
  response: ServerResponse,
  options: SessionRoutesOptions,
  sessionId: string,
): Promise<void> {
  const state = await options.store.state(sessionId);
  if (state === undefined) send(response, 404, UNKNOWN);
  else send(response, 200, state);
}

async function createSession(
  response: ServerResponse,
  options: SessionRoutesOptions,
  request: IncomingMessage,
): Promise<void> {
  const body = await readBody(request);
  if (!body.ok) {
    answer(response, BODY_REFUSED[body.reason]);
    return;
  }
  if (body.text !== '' && !isJson(request)) {
    answer(response, SETTING_NOT_JSON);
    return;
  }
  const input = parseSessionStart(body.text);
  if (!input.ok) {
    answer(response, rejected(400, 'Setting invalid', input.fields));
    return;
  }
  const created = await options.store.create();
  if (created === 'full') {
    send(response, 409, { error: 'no room for another Session' });
    return;
  }
  options.pipelines?.open(created.id, input.start);
  send(response, 201, created);
}

/** Checked after the method, so a malformed id answers 404 "Session unknown" like an expired one. */
function forSession(sessionId: string, handle: SessionHandler): Handler {
  return async (response, options, request) => {
    // SESSION_ID is anchored with fixed-width hex groups and no nested quantifier: linear time, no ReDoS.
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos
    if (SESSION_ID.test(sessionId)) await handle(response, options, sessionId, request);
    else send(response, 404, UNKNOWN);
  };
}

function sessionTarget(id: string, rest: string | undefined): Target | undefined {
  if (rest === undefined) return { method: 'GET', handle: forSession(id, readState) };
  if (rest === 'end') return { method: 'POST', handle: forSession(id, endInput) };
  if (rest !== 'segments') return undefined;
  return { method: 'POST', handle: forSession(id, acceptSegment) };
}

/** `/sessions`, `/sessions/{id}`, `/sessions/{id}/segments` or `/sessions/{id}/end`, query ignored; else no route. */
function findTarget(url: string | undefined): Target | undefined {
  const path = (url ?? '').split('?')[0] ?? '';
  const [, root, id, rest, ...more] = path.split('/');
  if (root !== 'sessions' || more.length > 0) return undefined;
  if (id === undefined) return { method: 'POST', handle: createSession };
  return sessionTarget(id, rest);
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: SessionRoutesOptions,
): Promise<void> {
  const target = findTarget(request.url);
  if (target === undefined) {
    send(response, 404, { error: 'not found' });
    return;
  }
  if (request.method !== target.method) {
    response.setHeader('allow', target.method);
    send(response, 405, { error: 'method not allowed' });
    return;
  }
  await target.handle(response, options, request);
}

/** The request listener for runService's `routes`; a failure (Redis away) answers 503 and logs no error text. */
export function createSessionRoutes(options: SessionRoutesOptions): RequestListener {
  return (request, response) => {
    route(request, response, options).catch(() => {
      options.logger.log({ event: 'session.request_failed' });
      if (!response.headersSent) send(response, 503, { error: 'Session store unavailable' });
      else response.destroy();
    });
  };
}
