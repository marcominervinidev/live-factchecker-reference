// Stage 1 of the Session limits in the configuration (#27, owner decision 2026-10-29): SESSION_BYTE_BUDGET (whole
// bytes from 1, default 3 MiB) and MAX_SESSIONS (whole number from 1, default 20); an invalid value names its
// variable and never its value. For all three whole-number settings, SESSION_LIFETIME_SECONDS included, only plain
// decimal digits count as a whole number (no exponent, hex, sign or whitespace).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const dir = mkdtempSync(join(tmpdir(), 'lfc-27-limits-'));
const secretFile = join(dir, 'redis_password');
// Throwaway test value, not a credential.
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret
writeFileSync(secretFile, 'redis-dummy-27-limits');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    PORT: '8080',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_PASSWORD_FILE: secretFile,
    ...extra,
  };
}

describe('loadConfig, Session limits', () => {
  it('uses a byte budget of 3 MiB and 20 Sessions when both are unset or empty', async () => {
    for (const value of [undefined, '']) {
      const config = await loadConfig(env({ SESSION_BYTE_BUDGET: value, MAX_SESSIONS: value }));
      expect([config.sessionByteBudget, config.maxSessions]).toEqual([3 * 1024 * 1024, 20]);
    }
  });

  it.each([
    { name: 'SESSION_BYTE_BUDGET', field: 'sessionByteBudget' },
    { name: 'MAX_SESSIONS', field: 'maxSessions' },
  ] as const)('accepts 1 and a large whole number for $name', async ({ name, field }) => {
    expect((await loadConfig(env({ [name]: '1' })))[field]).toBe(1);
    expect((await loadConfig(env({ [name]: '1000000' })))[field]).toBe(1_000_000);
  });

  it.each(
    ['SESSION_BYTE_BUDGET', 'MAX_SESSIONS'].flatMap((name) =>
      ['0', '-1', '1.5', '4MiB', '9007199254740993', '1e3', '0x10', '+5', ' 5'].map((value) => ({
        name,
        value,
      })),
    ),
  )('rejects $name=$value and names the variable', async ({ name, value }) => {
    await expect(loadConfig(env({ [name]: value }))).rejects.toThrow(new RegExp(name));
  });

  it.each(['SESSION_LIFETIME_SECONDS', 'SESSION_BYTE_BUDGET', 'MAX_SESSIONS'])(
    'rejects %s=1e3, 0x10 and +5, names the variable and never repeats the value',
    async (name) => {
      for (const value of ['1e3', '0x10', '+5']) {
        const refusal = loadConfig(env({ [name]: value }));
        await expect(refusal).rejects.toThrow(name);
        await expect(refusal).rejects.not.toThrow(value);
      }
    },
  );
});
