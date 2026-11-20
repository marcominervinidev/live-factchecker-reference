// Stage 1, @issue-28 (T3), Task 3: the Turn parameters take whole seconds from 1 only (review finding W1 of task 3:
// a tiny TICK_SECONDS such as 1e-19 would never end the Tick plan's threshold loop; docs/spec/erkennung-modellrollen.md
// 8 gives whole seconds only). Written by the implementer next to the frozen config.turns.test.ts, which leaves the
// question of fractions open. An invalid value names the variable.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const dir = mkdtempSync(join(tmpdir(), 'lfc-28-whole-'));
const redisPasswordPath = join(dir, 'redis_password');
writeFileSync(redisPasswordPath, 'pw-25-28-whole-dummy');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(overrides: Record<string, string>): Record<string, string | undefined> {
  return {
    PORT: '8080',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_PASSWORD_FILE: redisPasswordPath,
    ...overrides,
  };
}

describe('loadConfig, Turn parameters in whole seconds @issue-28', () => {
  it.each([
    { value: '0.5', invalidClass: 'a fraction' },
    { value: '0.0000000000000000001', invalidClass: 'a tiny fraction' },
    { value: '0', invalidClass: '0' },
  ])('rejects TICK_SECONDS set to $invalidClass and names the variable', async ({ value }) => {
    await expect(
      Promise.resolve().then(() => loadConfig(env({ TICK_SECONDS: value }))),
    ).rejects.toThrow(/TICK_SECONDS/);
  });

  it('accepts 1 second, the smallest whole value', async () => {
    expect((await loadConfig(env({ TICK_SECONDS: '1' }))).turnParameters.tickSeconds).toBe(1);
  });
});
