// Stage 1, issue #27 (T2), Task 3: the Session lifetime as configuration (ADR 0009, docs/spec/datenschutz.md 2:
// 15 minutes after the last Segment; .claude/rules/platform.md: configuration from the environment only).
//
// Public interface these tests define (built in Task 3):
//   loadConfig(env) -> { ..., sessionLifetimeSeconds: number }
//   SESSION_LIFETIME_SECONDS  optional, a whole number of seconds of at least 1; unset means 900 (15 minutes).
//   An invalid value throws (or rejects with) an Error whose message names SESSION_LIFETIME_SECONDS.
// Stage 2a sets a few seconds through this variable (features/session.feature).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const dir = mkdtempSync(join(tmpdir(), 'lfc-27-config-'));
const secretFile = join(dir, 'redis_password');
writeFileSync(secretFile, 'pw-27-config-secret');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(lifetime?: string): Record<string, string | undefined> {
  return {
    PORT: '8080',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_PASSWORD_FILE: secretFile,
    SESSION_LIFETIME_SECONDS: lifetime,
  };
}

describe('loadConfig, Session lifetime', () => {
  it('uses 900 seconds (15 minutes) when SESSION_LIFETIME_SECONDS is unset', async () => {
    expect((await loadConfig(env())).sessionLifetimeSeconds).toBe(900);
  });

  it.each([
    { validClass: 'the lowest value 1 (boundary)', value: '1', seconds: 1 },
    { validClass: 'a few seconds for stage 2a', value: '6', seconds: 6 },
    { validClass: 'the default written out', value: '900', seconds: 900 },
  ])('accepts $validClass', async ({ value, seconds }) => {
    expect((await loadConfig(env(value))).sessionLifetimeSeconds).toBe(seconds);
  });

  it.each([
    { invalidClass: '0 (below the lowest value)', value: '0' },
    { invalidClass: 'a negative number', value: '-5' },
    { invalidClass: 'a fraction', value: '1.5' },
    { invalidClass: 'no number', value: 'fifteen' },
  ])('rejects $invalidClass and names SESSION_LIFETIME_SECONDS', async ({ value }) => {
    await expect(Promise.resolve().then(() => loadConfig(env(value)))).rejects.toThrow(
      /SESSION_LIFETIME_SECONDS/,
    );
  });
});
