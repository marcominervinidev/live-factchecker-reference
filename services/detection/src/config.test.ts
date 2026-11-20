// Stage 1, issue #25 (T1), AC3 and AC4 (error content): configuration of the detection service from the
// environment only, secrets as `<NAME>_FILE` (`.claude/rules/platform.md`, "Configuration"; ticket #25, Assumptions:
// the Redis password arrives as REDIS_PASSWORD_FILE, never inside REDIS_URL). The process part of AC4 (exit before
// the port opens) is in main.test.ts.
//
// Public interface these tests define (built in Task 2):
//   loadConfig(env) -> { port: number; redisUrl: string; redisPassword: string }   (sync or async)
//   An invalid environment throws (or rejects with) an Error whose message names the variable and holds no value.
// PORT (name, range 1..65535) and "strip exactly one trailing newline" from a secret file follow the test designer's
// recommendation in open question 4 of gate 1 (round 2); they change if the owner answers otherwise.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

type Env = Record<string, string | undefined>;

const dir = mkdtempSync(join(tmpdir(), 'lfc-25-config-'));
const secretFile = join(dir, 'redis_password');
const SECRET = 'pw-25-config-secret';
writeFileSync(secretFile, SECRET);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(overrides: Env = {}): Env {
  return { PORT: '8080', REDIS_URL: 'redis://redis:6379', REDIS_PASSWORD_FILE: secretFile, ...overrides };
}

// Builds a Redis URL with credentials at runtime (a throwaway test token, never a real secret).
function urlWithPassword(base: string, password: string): string {
  const url = new URL(base);
  url.username = 'default';
  url.password = password;
  return url.toString();
}

// Works whether loadConfig throws synchronously or returns a rejected promise.
async function load(e: Env): Promise<Awaited<ReturnType<typeof loadConfig>>> {
  return await loadConfig(e);
}

async function failure(e: Env): Promise<string> {
  const error: unknown = await load(e).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(Error);
  return (error as Error).message;
}

describe('loadConfig: valid environment (AC3)', () => {
  it('reads the Redis URL and the port from the environment', async () => {
    const config = await load(env());
    expect(config.redisUrl).toBe('redis://redis:6379');
    expect(config.port).toBe(8080);
  });

  it('reads the Redis password from the file named by REDIS_PASSWORD_FILE', async () => {
    expect((await load(env())).redisPassword).toBe(SECRET);
  });

  // Depends on the owner's answer to open question 4 of gate 1 (round 2): recommendation "strip exactly one
  // trailing newline", because secret files written by a shell (`echo`, `make ci-secrets`) end in one.
  it.each([
    { ending: 'one LF', content: `${SECRET}\n`, expected: SECRET },
    { ending: 'one CRLF', content: `${SECRET}\r\n`, expected: SECRET },
    { ending: 'two LF, of which one is kept', content: `${SECRET}\n\n`, expected: `${SECRET}\n` },
  ])('strips exactly one trailing newline from the secret file ($ending)', async ({ content, expected }) => {
    const file = join(dir, `redis_password_newline_${content.length}_${content.includes('\r') ? 'crlf' : 'lf'}`);
    writeFileSync(file, content);
    expect((await load(env({ REDIS_PASSWORD_FILE: file }))).redisPassword).toBe(expected);
  });

  it.each(['1', '65535'])('accepts PORT=%s at the boundary of the port range', async (port) => {
    expect((await load(env({ PORT: port }))).port).toBe(Number(port));
  });
});

describe('loadConfig: invalid environment (AC4)', () => {
  it.each(['REDIS_URL', 'REDIS_PASSWORD_FILE', 'PORT'])('refuses a missing %s and names it', async (name) => {
    expect(await failure(env({ [name]: undefined }))).toContain(name);
  });

  it('refuses a REDIS_URL that is not a URL, names it and does not print it', async () => {
    const message = await failure(env({ REDIS_URL: 'redis-25 at port six' }));
    expect(message).toContain('REDIS_URL');
    expect(message).not.toContain('redis-25 at port six');
  });

  it('refuses a REDIS_URL that carries a password, names it and does not print the password', async () => {
    const message = await failure(env({ REDIS_URL: urlWithPassword('redis://redis:6379', 'hunter-25-url') }));
    expect(message).toContain('REDIS_URL');
    expect(message).not.toContain('hunter-25-url');
  });

  it('refuses a REDIS_PASSWORD_FILE that cannot be read, names it and does not print the path', async () => {
    const missing = join(dir, 'no-such-secret-25');
    const message = await failure(env({ REDIS_PASSWORD_FILE: missing }));
    expect(message).toContain('REDIS_PASSWORD_FILE');
    expect(message).not.toContain('no-such-secret-25');
  });

  it.each(['0', '65536'])('refuses PORT=%s just outside the port range and names PORT', async (port) => {
    expect(await failure(env({ PORT: port }))).toContain('PORT');
  });

  it('refuses a PORT that is not a number, names it and does not print it', async () => {
    const message = await failure(env({ PORT: 'eighty-25' }));
    expect(message).toContain('PORT');
    expect(message).not.toContain('eighty-25');
  });

  it('never prints the secret read from REDIS_PASSWORD_FILE when another variable is invalid', async () => {
    expect(await failure(env({ REDIS_URL: 'redis-25 at port six' }))).not.toContain(SECRET);
  });
});
