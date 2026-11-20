// Stage-2a support of the detection service (issue #27, T2): helpers without steps, so that step files share them
// instead of copying them. Not loaded by cucumber.json (features/steps/** only); step files import it.
// detection.steps.ts (#25, frozen) still holds its own copies of required, freePort, eventually and the start logic;
// switching it to this module is a follow-up after #25 is closed (.claude/frozen/27.json, "followUp").
import type { EventEmitter } from 'node:events';
import { createServer } from 'node:net';

import { startDetection } from '../../src/main.ts';

/** The part of the stage-2a World a running service needs (fields of detection.steps.ts). */
export interface ServiceWorld {
  port: number;
  lines: string[];
  exitCode: number | undefined;
  exited: Promise<number>;
  signals: EventEmitter;
}

export function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set: test:integration must provide the Redis of the test project`,
    );
  }
  return value;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

export async function eventually(
  condition: () => Promise<boolean>,
  deadlineMs: number,
  what: string,
): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (await condition().catch(() => false)) return;
    if (Date.now() > until) throw new Error(`${what} not reached within ${deadlineMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The Redis of the test project as the service's environment (REDIS_URL, REDIS_PASSWORD_FILE from test:integration). */
export function testProjectRedis(): Record<string, string> {
  return { REDIS_URL: required('REDIS_URL'), REDIS_PASSWORD_FILE: required('REDIS_PASSWORD_FILE') };
}

/** Starts the service in-process on a free port with the given environment; resolves once /health answers 200. */
export async function startService(
  world: ServiceWorld,
  env: Record<string, string>,
): Promise<void> {
  world.port = await freePort();
  world.exited = new Promise<number>((resolve) => {
    startDetection({
      env: { ...env, PORT: String(world.port) },
      write: (line: string) => {
        world.lines.push(line);
      },
      exit: (code: number) => {
        world.exitCode = code;
        resolve(code);
      },
      signals: world.signals,
    }).catch(() => undefined);
  });
  await eventually(
    async () => {
      const response = await fetch(`http://127.0.0.1:${world.port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      return response.status === 200;
    },
    5000,
    'the service answering /health',
  );
}
