// Stage 1 of the kit's config helpers beyond the frozen detection tests (#25 round 3: B2, B6, B11).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ConfigError, loadServiceConfig, readSecretFile } from './config.ts';

// Round-3 review decision B11 (#25): a secret file is a regular file of at most 4 KiB.
const MAX_SECRET_BYTES = 4096;

const dir = mkdtempSync(join(tmpdir(), 'lfc-kit-config-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

async function failure(load: () => Promise<unknown>): Promise<ConfigError> {
  const error: unknown = await load().then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ConfigError);
  return error as ConfigError;
}

describe('readSecretFile', () => {
  it('refuses an empty secret file and names the variable', async () => {
    const error = await failure(() => readSecretFile({ KEY_FILE: file('empty', '\n') }, 'KEY'));
    expect(error.variable).toBe('KEY_FILE');
  });

  it('refuses a directory, names the variable and not the path', async () => {
    const path = join(dir, 'a-directory-kit');
    mkdirSync(path);
    const error = await failure(() => readSecretFile({ KEY_FILE: path }, 'KEY'));
    expect(error.message).toContain('KEY_FILE');
    expect(error.message).not.toContain('a-directory-kit');
  });

  it('reads a secret file of exactly the size limit', async () => {
    const path = file('at-limit', 'k'.repeat(MAX_SECRET_BYTES));
    expect(await readSecretFile({ KEY_FILE: path }, 'KEY')).toHaveLength(MAX_SECRET_BYTES);
  });

  it('refuses a secret file one byte over the size limit', async () => {
    const path = file('over-limit', 'k'.repeat(MAX_SECRET_BYTES + 1));
    expect((await failure(() => readSecretFile({ KEY_FILE: path }, 'KEY'))).variable).toBe(
      'KEY_FILE',
    );
  });
});

describe('loadServiceConfig and library debug output', () => {
  it.each(['DEBUG', 'NODE_DEBUG'])(
    'refuses a set %s, names it and does not print its value',
    (name) => {
      const load = (): unknown => loadServiceConfig({ PORT: '8080', [name]: 'ioredis-debug-25' });
      expect(load).toThrow(ConfigError);
      expect(load).toThrow(name);
      expect(load).not.toThrow('ioredis-debug-25');
    },
  );

  it('accepts DEBUG set to the empty string', () => {
    expect(loadServiceConfig({ PORT: '8080', DEBUG: '' }).port).toBe(8080);
  });
});
