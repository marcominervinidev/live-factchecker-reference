// Start and stop of a service (twelve factors: port binding, disposability). The probes listen on the port
// from the configuration. On SIGTERM `server.close()` closes the listener at once, so new connections are
// refused; only a request on an open keep-alive connection still arrives, and /ready answers it 503. Running
// requests finish (cut after DRAIN_TIMEOUT_MS), then `close` releases the dependencies, one stop event is
// logged and the service exits 0. Whatever hangs, STOP_DEADLINE_MS after SIGTERM it logs `service.stop_failed`
// and exits 1, inside the Compose grace period of 10 s. The deadline timer is not unref'd: it also ends a stop
// that waits on a promise with no open handle.
import { createServer, type RequestListener, type Server } from 'node:http';

import { createProbeHandler, type Check } from './health.ts';
import type { Logger } from './logger.ts';

/** Where SIGTERM arrives: the process in production, an emitter in tests. */
export interface Signals {
  once(signal: 'SIGTERM', listener: () => void): unknown;
}

export interface ServiceOptions {
  readonly port: number;
  readonly logger: Logger;
  readonly checks: Readonly<Record<string, Check>>;
  /** The service's own routes: every request that is not GET /health or GET /ready (health.ts). */
  readonly routes?: RequestListener | undefined;
  /** Releases the dependencies; called once the port has closed. Background work ends here first (T3). */
  readonly close: () => Promise<void>;
  readonly signals?: Signals | undefined;
  readonly exit?: ((code: number) => void) | undefined;
}

/** Running requests get this long after SIGTERM; then their connections are cut. */
const DRAIN_TIMEOUT_MS = 5000;
/** From SIGTERM to exit at the latest, below the Compose grace period of 10 s. */
const STOP_DEADLINE_MS = 9000;

/**
 * Limits of the HTTP server, so a slow or a crowding client cannot hold the service: a request must be complete
 * within 10 s and its headers within 5 s (else 408, checked every second), and at most MAX_CONNECTIONS sockets are
 * open at once (a further one is dropped).
 */
const REQUEST_TIMEOUT_MS = 10_000;
const HEADERS_TIMEOUT_MS = 5000;
const CONNECTIONS_CHECKING_INTERVAL_MS = 1000;
const MAX_CONNECTIONS = 256;

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function stopper(server: Server, options: ServiceOptions, exit: (code: number) => void) {
  return async (): Promise<void> => {
    const since = performance.now();
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      const durationMs = Math.round(performance.now() - since);
      options.logger.log({
        event: code === 0 ? 'service.stopped' : 'service.stop_failed',
        durationMs,
      });
      exit(code);
    };
    const deadline = setTimeout(() => {
      finish(1);
    }, STOP_DEADLINE_MS);
    const cut = setTimeout(() => {
      server.closeAllConnections();
    }, DRAIN_TIMEOUT_MS);
    cut.unref();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    clearTimeout(cut);
    await options.close().then(
      () => {
        finish(0);
      },
      () => {
        finish(1);
      },
    );
  };
}

/** Resolves once the port is open; calls `exit` once, after SIGTERM or when the port cannot be opened. */
export async function runService(options: ServiceOptions): Promise<void> {
  const signals = options.signals ?? process;
  const exit =
    options.exit ??
    ((code: number) => {
      process.exit(code);
    });
  let accepting = true;
  const server = createServer(
    {
      requestTimeout: REQUEST_TIMEOUT_MS,
      headersTimeout: HEADERS_TIMEOUT_MS,
      connectionsCheckingInterval: CONNECTIONS_CHECKING_INTERVAL_MS,
    },
    createProbeHandler({
      checks: options.checks,
      accepting: () => accepting,
      routes: options.routes,
    }),
  );
  server.maxConnections = MAX_CONNECTIONS;
  try {
    await listen(server, options.port);
  } catch {
    options.logger.log({ event: 'service.port_unavailable' });
    await options.close().catch(() => undefined);
    exit(1);
    return;
  }
  options.logger.log({ event: 'service.started' });
  const stop = stopper(server, options, exit);
  signals.once('SIGTERM', () => {
    accepting = false;
    void stop();
  });
}
