// Evidence for the acceptance report, loaded only by the acceptance runner (cucumber.json): after every request step
// of the API driver (tests/api/steps/edge.steps.ts) it attaches the exchange the edge answered, read from the
// world's last answer. It asserts nothing; the judge reads the evidence, the runner copies it into report.json.
import { readFileSync } from 'node:fs';
import https from 'node:https';
import tls, { type TLSSocket } from 'node:tls';

import { AfterStep, BeforeStep, Status } from '@cucumber/cucumber';

import {
  EXCHANGE_MEDIA_TYPE,
  tlsFacts,
  tlsFailure,
  type ConnectOptions,
  type Exchange,
  type TlsFacts,
} from '../runner/exchange.ts';

// The TLS check of the request step's own connection (judge J1, round 4): every tls.connect, whatever agent the
// library uses, reports its handshake here, a completed one with its verdict, a failed one as authorized=false
// with the error code. The facts are reset before every step, so a step that opened no connection shows
// `TLS not observed`, never another step's facts; the global agent keeps no connection alive, so every request of
// the stage-3 library does its own handshake.
const caPath = process.env['LFC_EDGE_CA_FILE'];
const caFile =
  caPath === undefined || caPath === '' ? undefined : { path: caPath, bytes: readFileSync(caPath) };
let handshake: TlsFacts | null = null;

// No kept-alive connection and no resumed TLS session: a resumed session presents no certificate, so its line would
// read issuer=none and single out whichever case ran first.
Object.assign(https.globalAgent, { keepAlive: false, maxCachedSessions: 0 });
Object.assign(https.globalAgent.options, { keepAlive: false, maxCachedSessions: 0 });

const connectTls = tls.connect as (...args: unknown[]) => TLSSocket;
const observed = (...args: unknown[]): TLSSocket => {
  const socket = connectTls(...args);
  const options =
    args.find((arg): arg is ConnectOptions => typeof arg === 'object' && arg !== null) ?? {};
  let secured = false;
  socket.once('secureConnect', () => {
    secured = true;
    handshake = tlsFacts(options, socket, caFile);
  });
  socket.once('error', (error: unknown) => {
    if (!secured) handshake = tlsFailure(options, error, caFile);
  });
  return socket;
};
Reflect.set(tls, 'connect', observed);

BeforeStep(function () {
  handshake = null;
});

const REQUEST_STEP = /^the client asks the edge for "(.*)"$/;
/** Probe bodies are small; anything longer is cut, the judge needs the shape, not the bytes. */
const BODY_LIMIT = 2048;

interface Answer {
  readonly status: number;
  readonly body: string;
  readonly edgeMark: string | undefined;
}

function isAnswer(value: unknown): value is Answer {
  if (typeof value !== 'object' || value === null) return false;
  const mark: unknown = Reflect.get(value, 'edgeMark');
  return (
    typeof Reflect.get(value, 'status') === 'number' &&
    typeof Reflect.get(value, 'body') === 'string' &&
    (mark === undefined || typeof mark === 'string')
  );
}

type AnswerFields = Pick<Exchange, 'status' | 'edgeMark' | 'body'>;

const NO_ANSWER: AnswerFields = { status: null, edgeMark: null, body: '' };

const answerFields = (answer: Answer): AnswerFields => ({
  status: answer.status,
  edgeMark: answer.edgeMark ?? null,
  body: answer.body.slice(0, BODY_LIMIT),
});

/** The exchange of one request step; only a passed step's answer counts. */
function exchangeOf(path: string, passed: boolean, answer: unknown): Exchange {
  const answered = passed && isAnswer(answer);
  return {
    method: 'GET',
    path,
    ...(answered ? answerFields(answer) : NO_ANSWER),
    at: new Date().toISOString(),
    // A passed request step always leaves its answer in the World; without one the hook reads the wrong field.
    fault:
      passed && !answered
        ? 'the request step passed, but the World holds no answer under `answer`'
        : null,
    tls: handshake,
  };
}

AfterStep(function ({ pickleStep, result }) {
  const path = REQUEST_STEP.exec(pickleStep.text)?.[1];
  if (path === undefined) return;
  const exchange = exchangeOf(path, result.status === Status.PASSED, Reflect.get(this, 'answer'));
  this.attach(JSON.stringify(exchange), EXCHANGE_MEDIA_TYPE);
});
