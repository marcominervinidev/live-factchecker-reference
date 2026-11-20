// Stage-2a step library of the detection service (issue #25, T1). In-process: the service is started through
// startDetection (src/main.ts) with an injected log sink, exit and signal source; Redis is the real container of the
// test project, whose REDIS_URL and REDIS_PASSWORD_FILE `test:integration` passes to this process. Steps observe
// behaviour only: HTTP answers, the exit code, the log lines, and the client list Redis itself reports.
// Later tickets extend this file's vocabulary; they never copy it (.claude/rules/tests.md).
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { After, Given, Then, When, World, setWorldConstructor, type IWorldOptions } from '@cucumber/cucumber';
import { dependencyStates } from '@lfc/service-kit/testing';

import { startDetection } from '../../src/main.ts';

const STOP_DEADLINE_MS = 10_000; // AC7: the Compose default grace period
// #161: Cucumber's default step timeout is 5 s. Six steps wait longer on their own deadlines, so they get an outer
// guard above them and a slow run fails with the deadline it waited on, not with "function timed out". Every other
// step and the After hook keep the 5 s.
// The four start and wait steps: at most about 7.6 s (CLIENT LIST with its 2-s idle timeout, then /health within
// 5 s plus one 500-ms probe), without a reply that trickles in.
const START_STEP_TIMEOUT_MS = 10_000;
// The steps after SIGTERM: the /ready loop runs STOP_DEADLINE_MS plus one 500-ms probe, the exit step the 10 s the
// scenario names.
const AFTER_SIGTERM_STEP_TIMEOUT_MS = 12_000;

class DetectionWorld extends World {
  port = 0;
  lines: string[] = [];
  linesAtSigterm = 0;
  sigtermAt = 0;
  exitCode: number | undefined;
  exited: Promise<number> = new Promise<number>(() => undefined);
  signals = new EventEmitter();
  answer: { status: number; body: string } | undefined;
  readyAfterSigterm: Promise<number[]> = Promise.resolve([]);
  baselineClients = 0;
  leaks: string[] = [];
  scratch: string | undefined;

  constructor(options: IWorldOptions) {
    super(options);
  }
}
setWorldConstructor(DetectionWorld);

// ---- helpers ------------------------------------------------------------------------------------------------

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set: test:integration must provide the Redis of the test project`);
  }
  return value;
}

// Secret files written by a shell usually end in one newline; the secret is the text before it.
function readSecret(file: string): string {
  // Same convention as the service (open question 4 of gate 1, round 2: strip exactly one trailing newline).
  return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not happen within ${ms} ms`)), Math.max(ms, 0))),
  ]);
}

async function get(port: number, path: string, timeoutMs = 2000): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, body: await response.text() };
}

async function eventually(condition: () => Promise<boolean>, deadlineMs: number, what: string): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    if (await condition().catch(() => false)) return;
    if (Date.now() > until) throw new Error(`${what} not reached within ${deadlineMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Number of clients Redis reports, not counting the connection that asks (RESP over a plain socket, no client library).
async function redisClientCount(): Promise<number> {
  const target = new URL(required('REDIS_URL'));
  const password = readSecret(required('REDIS_PASSWORD_FILE'));
  const bulk = (s: string): string => `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  const socket = new Socket();
  try {
    const reply = await new Promise<string>((resolve, reject) => {
      let buffer = '';
      socket.setTimeout(2000, () => reject(new Error('Redis did not answer CLIENT LIST')));
      socket.on('error', reject);
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        if (buffer.startsWith('-')) reject(new Error('Redis refused AUTH'));
        const match = /^\+OK\r\n\$(\d+)\r\n/.exec(buffer);
        if (match?.[1] !== undefined) {
          const start = match[0].length;
          const length = Number(match[1]);
          if (Buffer.byteLength(buffer.slice(start)) >= length) resolve(buffer.slice(start, start + length));
        }
      });
      socket.connect(Number(target.port || 6379), target.hostname, () => {
        socket.write(`*2\r\n${bulk('AUTH')}${bulk(password)}*2\r\n${bulk('CLIENT')}${bulk('LIST')}`);
      });
    });
    return reply.split('\n').filter((line) => line.trim() !== '').length - 1;
  } finally {
    socket.destroy();
  }
}

async function start(world: DetectionWorld, env: Record<string, string>): Promise<void> {
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
  await eventually(async () => (await get(world.port, '/health', 500)).status === 200, 5000, 'the service answering /health');
}

// ---- steps --------------------------------------------------------------------------------------------------

Given('the detection service runs with the Redis of the test project', { timeout: START_STEP_TIMEOUT_MS }, async function (this: DetectionWorld) {
  this.baselineClients = await redisClientCount();
  await start(this, { REDIS_URL: required('REDIS_URL'), REDIS_PASSWORD_FILE: required('REDIS_PASSWORD_FILE') });
});

Given(
  'the detection service runs with Redis expected at a loopback port where nothing listens',
  { timeout: START_STEP_TIMEOUT_MS },
  async function (this: DetectionWorld) {
    const redisPort = await freePort();
    this.scratch = mkdtempSync(join(tmpdir(), 'lfc-25-2a-'));
    const secretFile = join(this.scratch, 'redis_password');
    const secret = 'pw-25-2a-unreachable';
    writeFileSync(secretFile, secret);
    this.leaks = ['127.0.0.1', String(redisPort), 'ECONNREFUSED', secret, 'redis://'];
    await start(this, { REDIS_URL: `redis://127.0.0.1:${redisPort}`, REDIS_PASSWORD_FILE: secretFile });
  },
);

Given('{string} answers with status {int}', { timeout: START_STEP_TIMEOUT_MS }, async function (this: DetectionWorld, path: string, status: number) {
  await eventually(async () => (await get(this.port, path, 1000)).status === status, 5000, `${path} answering ${status}`);
});

Given('the service holds a connection to Redis', { timeout: START_STEP_TIMEOUT_MS }, async function (this: DetectionWorld) {
  await eventually(async () => (await redisClientCount()) > this.baselineClients, 5000, 'a Redis connection of the service');
});

When('the client asks the service for {string}', async function (this: DetectionWorld, path: string) {
  this.answer = await get(this.port, path);
});

When('the service receives SIGTERM', function (this: DetectionWorld) {
  this.linesAtSigterm = this.lines.length;
  this.sigtermAt = Date.now();
  this.signals.emit('SIGTERM');
  // Ask /ready until the service has exited (or the deadline passed); keep every status that came back.
  this.readyAfterSigterm = (async () => {
    const statuses: number[] = [];
    while (this.exitCode === undefined && Date.now() - this.sigtermAt < STOP_DEADLINE_MS) {
      try {
        statuses.push((await get(this.port, '/ready', 500)).status);
      } catch {
        // refused or reset: the service no longer accepts this request
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return statuses;
  })();
});

Then('the service answers with status {int}', function (this: DetectionWorld, status: number) {
  if (this.answer?.status !== status) throw new Error(`expected status ${status}, got ${String(this.answer?.status)}`);
});

Then('the body names the dependency {string} as {string}', function (this: DetectionWorld, name: string, state: string) {
  const states = dependencyStates(this.answer?.body ?? 'null');
  if (states[name] !== state) throw new Error(`expected ${name} to be ${state}, body names ${JSON.stringify(states)}`);
});

Then(
  'the body reveals no host, no port, no error text and no secret of the Redis connection',
  function (this: DetectionWorld) {
    const body = this.answer?.body ?? '';
    const found = this.leaks.filter((leak) => body.includes(leak));
    if (found.length > 0) throw new Error(`the /ready body reveals ${found.length} detail(s) of the Redis connection`);
  },
);

Then(/^no "\/ready" answer after SIGTERM has status 200$/, { timeout: AFTER_SIGTERM_STEP_TIMEOUT_MS }, async function (this: DetectionWorld) {
  const statuses = await this.readyAfterSigterm;
  if (statuses.includes(200)) throw new Error(`/ready answered 200 after SIGTERM (statuses: ${statuses.join(', ')})`);
});

Then('the service exits with code {int} within {int} seconds', { timeout: AFTER_SIGTERM_STEP_TIMEOUT_MS }, async function (this: DetectionWorld, code: number, seconds: number) {
  const remaining = seconds * 1000 - (Date.now() - this.sigtermAt);
  const actual = await within(this.exited, remaining, 'exit after SIGTERM');
  if (actual !== code) throw new Error(`expected exit code ${code}, got ${actual}`);
});

Then('the service holds no connection to Redis anymore', async function (this: DetectionWorld) {
  await eventually(async () => (await redisClientCount()) === this.baselineClients, 2000, 'Redis connection of the service closed');
});

Then('exactly one stop event was logged after SIGTERM', function (this: DetectionWorld) {
  const events = this.lines.slice(this.linesAtSigterm).map((line) => {
    const parsed: unknown = JSON.parse(line);
    const event = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['event'] : undefined;
    return typeof event === 'string' ? event : '';
  });
  const stops = events.filter((event) => /stop/i.test(event));
  if (stops.length !== 1) throw new Error(`expected one stop event after SIGTERM, got ${stops.length}: ${JSON.stringify(events)}`);
});

Then('the port of the service refuses new connections', async function (this: DetectionWorld) {
  const refused = await get(this.port, '/health', 1000).then(
    () => false,
    () => true,
  );
  if (!refused) throw new Error('the service still answers /health after it exited');
});

After(async function (this: DetectionWorld) {
  if (this.port !== 0 && this.exitCode === undefined) {
    this.signals.emit('SIGTERM');
    await within(this.exited, STOP_DEADLINE_MS, 'exit in cleanup').catch(() => undefined);
  }
  if (this.scratch !== undefined) rmSync(this.scratch, { recursive: true, force: true });
});
