// Stage 1, @issue-28 (T3), Task 3: the Turn parameters as configuration (ticket #28: "Parameters are the start values
// of spec section 8 …, read from configuration"; docs/spec/erkennung-modellrollen.md 8; .claude/rules/platform.md:
// configuration from the environment only, validated at startup).
//
// Public interface these tests define (built in Task 3):
//   loadConfig(env) -> { ..., turnParameters: TurnParameters }   (TurnParameters of src/turns/types.ts)
//   TICK_SECONDS             optional, default 5     -> turnParameters.tickSeconds
//   TURN_PAUSE_END_SECONDS   optional, default 3     -> turnParameters.turnPauseEndSeconds
//   TURN_MAX_SECONDS         optional, default 180   -> turnParameters.turnMaxSeconds
//   INTERJECTION_MAX_SECONDS optional, default 2     -> turnParameters.interjectionMaxSeconds
//   The names are the spec's parameter names in upper case. A value is a finite number of seconds above 0; an
//   invalid value throws (or rejects with) an Error whose message names the variable. Whether fractions are allowed
//   is left open (the spec gives whole seconds only).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const dir = mkdtempSync(join(tmpdir(), 'lfc-28-config-'));
const redisPasswordPath = join(dir, 'redis_password');
writeFileSync(redisPasswordPath, 'pw-28-config-secret');

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function env(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    PORT: '8080',
    REDIS_URL: 'redis://127.0.0.1:6379',
    REDIS_PASSWORD_FILE: redisPasswordPath,
    ...overrides,
  };
}

const VARIABLES = [
  { variable: 'TICK_SECONDS', field: 'tickSeconds', other: '4' },
  { variable: 'TURN_PAUSE_END_SECONDS', field: 'turnPauseEndSeconds', other: '4' },
  { variable: 'TURN_MAX_SECONDS', field: 'turnMaxSeconds', other: '120' },
  { variable: 'INTERJECTION_MAX_SECONDS', field: 'interjectionMaxSeconds', other: '1' },
] as const;

// docs/spec/erkennung-modellrollen.md section 8
const START = {
  tickSeconds: 5,
  turnPauseEndSeconds: 3,
  turnMaxSeconds: 180,
  interjectionMaxSeconds: 2,
};

describe('loadConfig, Turn parameters @issue-28', () => {
  it('uses the start values of spec section 8 when no Turn parameter is set @ac-1 @ac-2 @ac-4 @ac-8', async () => {
    expect((await loadConfig(env())).turnParameters).toEqual(START);
  });

  it.each(VARIABLES)(
    'reads $variable into $field and keeps the other start values',
    async ({ variable, field, other }) => {
      expect((await loadConfig(env({ [variable]: other }))).turnParameters).toEqual({
        ...START,
        [field]: Number(other),
      });
    },
  );

  it.each(
    VARIABLES.flatMap(({ variable }) => [
      { variable, invalidClass: '0 (no time)', value: '0' },
      { variable, invalidClass: 'a negative number', value: '-3' },
      { variable, invalidClass: 'no number', value: 'five' },
      { variable, invalidClass: 'not finite (Infinity)', value: 'Infinity' },
      { variable, invalidClass: 'not finite (1e400)', value: '1e400' },
    ]),
  )(
    'rejects $variable set to $invalidClass and names the variable',
    async ({ variable, value }) => {
      await expect(
        Promise.resolve().then(() => loadConfig(env({ [variable]: value }))),
      ).rejects.toThrow(new RegExp(variable));
    },
  );
});
