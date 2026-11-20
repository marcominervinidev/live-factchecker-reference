// Stage 1 of the server limits of runService (#27, review round 2, S3): at most 256 sockets at once (the README and
// security finding S3), a further one is dropped. The time limits (request 10 s, headers 5 s) are not tested here: Node checks them on its
// own timers, so a test would wait at least 5 s of real time per case. Sockets are real. One complete exchange shows
// that runService hands its checks, its routes and its running state to the probe handler (Stryker lifecycle.ts:109
// and :111).
import { EventEmitter } from 'node:events';
import { get as httpGet } from 'node:http';
import { connect, createServer, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { runService } from './lifecycle.ts';
import { createLogger } from './logger.ts';

/** packages/service-kit README and security finding S3: the service port holds at most 256 sockets. */
const MAX_SOCKETS = 256;

const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const step of cleanup.splice(0)) step();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

interface OpenSocket {
  readonly socket: Socket;
  readonly closed: () => boolean;
  /** Settles when the server drops the socket. */
  readonly dropped: Promise<void>;
}

function open(port: number): Promise<OpenSocket> {
  return new Promise((resolve, reject) => {
    let isClosed = false;
    const socket = connect(port, '127.0.0.1');
    const dropped = new Promise<void>((settle) => {
      socket.on('close', () => {
        isClosed = true;
        settle();
      });
    });
    socket.on('error', () => undefined);
    socket.once('connect', () => {
      resolve({ socket, closed: () => isClosed, dropped });
    });
    socket.once('error', reject);
  });
}

/** One HTTP exchange over an open socket: the server serves it, so it was kept. */
function exchange(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    socket.once('data', (chunk: Buffer) => {
      resolve(chunk.toString('utf8'));
    });
    socket.write('GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n');
  });
}

function ask(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path, agent: false }, (response) => {
      let body = '';
      response.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body });
      });
    }).on('error', reject);
  });
}

describe('runService request handling', () => {
  // Kills lifecycle.ts:109 (probe handler options -> {}) and :111 (accepting -> () => undefined).
  it('answers /ready from its checks while running and hands other requests to its routes', async () => {
    const port = await freePort();
    const signals = new EventEmitter();
    let exited: (code: number) => void = () => undefined;
    const exitCode = new Promise<number>((resolve) => {
      exited = resolve;
    });
    await runService({
      port,
      logger: createLogger({ service: 'kit', write: () => undefined }),
      checks: { db: () => Promise.resolve() },
      routes: (request, response) => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(`routed ${request.url ?? ''}`);
      },
      close: () => Promise.resolve(),
      signals,
      exit: (code) => {
        exited(code);
      },
    });
    expect(await ask(port, '/ready')).toEqual({
      status: 200,
      body: '{"ready":true,"dependencies":{"db":"ok"}}',
    });
    expect(await ask(port, '/sessions/x')).toEqual({ status: 200, body: 'routed /sessions/x' });
    signals.emit('SIGTERM');
    expect(await exitCode).toBe(0);
  });
});

describe('runService limits', () => {
  it(`drops a connection beyond ${MAX_SOCKETS} and keeps the others`, async () => {
    const port = await freePort();
    const signals = new EventEmitter();
    await runService({
      port,
      logger: createLogger({ service: 'kit', write: () => undefined }),
      checks: {},
      close: () => Promise.resolve(),
      signals,
      exit: () => undefined,
    });
    cleanup.push(() => signals.emit('SIGTERM'));
    const sockets: OpenSocket[] = [];
    cleanup.push(() => {
      for (const { socket } of sockets) socket.destroy();
    });
    for (let i = 0; i <= MAX_SOCKETS; i += 1) sockets.push(await open(port));
    const [first, beyond] = [sockets[0], sockets[MAX_SOCKETS]];
    if (first === undefined || beyond === undefined) throw new Error('expected the sockets');
    // The server takes the sockets in order: the last one is beyond the limit. An exchange on the first one after
    // that shows it is still served and lets any further drop arrive before the count.
    await beyond.dropped;
    expect(await exchange(first.socket)).toMatch(/^HTTP\/1\.1 200 /);
    expect(sockets.flatMap((s, i) => (s.closed() ? [i] : []))).toEqual([MAX_SOCKETS]);
  });
});
