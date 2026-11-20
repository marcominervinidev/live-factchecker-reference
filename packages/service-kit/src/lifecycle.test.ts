// Stage 1 of runService (#25 round 3): the stop deadline (B3), the drain cut (B6) and a taken port (B6).
// Fake timers for setTimeout only; sockets are real.
import { EventEmitter } from 'node:events';
import { connect, createServer, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runService } from './lifecycle.ts';
import { createLogger } from './logger.ts';

// Sources: AC7 of #25 (exit within the Compose grace period of 10 s after SIGTERM) and the owner's drain decision
// (running requests get 5 s).
const EXIT_BOUND_MS = 10_000;
const DRAIN_MS = 5000;

const cleanup: (() => void)[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const step of cleanup.splice(0)) step();
});

async function freePort(): Promise<{ port: number; blocker: Server }> {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, resolve));
  const address = blocker.address();
  return { port: typeof address === 'object' && address !== null ? address.port : 0, blocker };
}

async function until(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

function start(port: number, close: () => Promise<void>) {
  const events: string[] = [];
  const signals = new EventEmitter();
  const run = { events, signals, code: undefined as number | undefined, closed: false };
  const started = runService({
    port,
    logger: createLogger({
      service: 'kit',
      write: (line) => {
        events.push(String((JSON.parse(line) as { event: unknown }).event));
      },
    }),
    checks: {},
    close: () => {
      run.closed = true;
      return close();
    },
    signals,
    exit: (code) => {
      run.code = code;
    },
  });
  cleanup.push(() => {
    if (run.code === undefined) signals.emit('SIGTERM');
  });
  return { run, started };
}

describe('runService stop', () => {
  it('logs service.stop_failed and exits 1 at the deadline when close hangs', async () => {
    const { port, blocker } = await freePort();
    await new Promise((resolve) => blocker.close(resolve));
    const { run, started } = start(port, () => new Promise<never>(() => undefined));
    await started;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    run.signals.emit('SIGTERM');
    await until(() => run.closed);
    // Still waiting for close after the drain cut, so the deadline is not the drain timeout.
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    expect(run.code).toBeUndefined();
    await vi.advanceTimersByTimeAsync(EXIT_BOUND_MS - DRAIN_MS);
    expect(run.code).toBe(1);
    expect(run.events.filter((event) => event.startsWith('service.stop'))).toEqual([
      'service.stop_failed',
    ]);
  });

  it('cuts a request still open at the drain timeout, then closes and exits 0', async () => {
    const { port, blocker } = await freePort();
    await new Promise((resolve) => blocker.close(resolve));
    const { run, started } = start(port, () => Promise.resolve());
    await started;
    const socket: Socket = connect(port, '127.0.0.1');
    cleanup.push(() => socket.destroy());
    socket.on('error', () => undefined);
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write('GET /health HTTP/1.1\r\nHost: kit\r\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    run.signals.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(DRAIN_MS - 1);
    expect(run.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await until(() => run.code !== undefined);
    expect(run.code).toBe(0);
    expect(run.events).toContain('service.stopped');
  });

  it('logs service.port_unavailable, closes the dependencies and exits 1 when the port is taken', async () => {
    const { port, blocker } = await freePort();
    cleanup.push(() => blocker.close());
    const { run, started } = start(port, () => Promise.resolve());
    await started;
    expect(run.code).toBe(1);
    expect(run.closed).toBe(true);
    expect(run.events).toEqual(['service.port_unavailable']);
  });
});
