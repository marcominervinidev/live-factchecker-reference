// The probe endpoints every service answers (.claude/rules/platform.md, "Logging and health"): GET /health
// means the process is up and checks nothing; GET /ready runs one check per dependency. The /ready body names
// each dependency with "ok" or "failed" only: never a host, a port, an error text or a secret. Every other request
// goes to the service's own `routes` when it has some (#27), else it gets 404; once the service stops, every answer,
// a routed one included, closes its connection.
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

/** Resolves when the dependency is reachable; rejects or hangs when it is not. */
export type Check = () => Promise<unknown>;

export interface ProbeOptions {
  readonly checks: Readonly<Record<string, Check>>;
  /** False once the service stops: /ready answers 503 `stopping`, and the connection closes after the answer. */
  readonly accepting?: (() => boolean) | undefined;
  /** Answers every request that is not a probe (the service's own routes); without it such a request gets 404. */
  readonly routes?: RequestListener | undefined;
}

/** A check that has not settled by then counts as failed. */
const CHECK_TIMEOUT_MS = 2000;

type State = 'ok' | 'failed';

const STOPPING = { ready: false, stopping: true } as const;

function state(check: Check): Promise<State> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve('failed');
    }, CHECK_TIMEOUT_MS);
    void Promise.resolve()
      .then(check)
      .then(
        () => 'ok' as const,
        () => 'failed' as const,
      )
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      });
  });
}

async function readiness(
  checks: ProbeOptions['checks'],
): Promise<{ status: number; body: object }> {
  const states = await Promise.all(
    Object.entries(checks).map(async ([name, check]) => [name, await state(check)] as const),
  );
  const ready = states.every(([, result]) => result === 'ok');
  return { status: ready ? 200 : 503, body: { ready, dependencies: Object.fromEntries(states) } };
}

function send(response: ServerResponse, status: number, body: object, open: boolean): void {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  response.writeHead(status, open ? headers : { ...headers, connection: 'close' });
  response.end(JSON.stringify(body));
}

// Asked again after the checks: a check that started before the stop never turns into a 200.
async function answerReady(
  response: ServerResponse,
  checks: ProbeOptions['checks'],
  accepting: () => boolean,
): Promise<void> {
  const { status, body } = accepting() ? await readiness(checks) : { status: 503, body: STOPPING };
  if (accepting()) send(response, status, body, true);
  else send(response, 503, STOPPING, false);
}

/** The request listener of a service: the two probes, then `routes` (or 404) for everything else. */
export function createProbeHandler(
  options: ProbeOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const accepting = options.accepting ?? (() => true);
  return (request, response) => {
    const path = (request.url ?? '').split('?')[0];
    if (request.method === 'GET' && path === '/health') {
      send(response, 200, { status: 'up' }, accepting());
    } else if (request.method === 'GET' && path === '/ready') {
      void answerReady(response, options.checks, accepting);
    } else if (options.routes !== undefined) {
      // Once the service stops, a routed answer closes its connection too, so server.close() need not wait for it.
      if (!accepting()) response.setHeader('connection', 'close');
      options.routes(request, response);
    } else {
      send(response, 404, { error: 'not found' }, accepting());
    }
  };
}
