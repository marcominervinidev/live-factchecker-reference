// Stage 1 of REDIS_URL beyond the frozen config tests (#25 round 3, B1): nothing in the URL may override the
// connection options, so query, fragment and any path but a database number are refused.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from './config.ts';

const dir = mkdtempSync(join(tmpdir(), 'lfc-25-redis-url-'));
const secretFile = join(dir, 'redis_password');
// A random throwaway value: no literal that a secret scanner would have to be told about.
writeFileSync(secretFile, randomBytes(16).toString('hex'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const load = (url: string) =>
  loadConfig({ PORT: '8080', REDIS_URL: url, REDIS_PASSWORD_FILE: secretFile });

describe('loadConfig: REDIS_URL names the server only', () => {
  it.each([
    'redis://redis:6379?password=hunter-25-query',
    'redis://redis:6379/?db=hunter-25-query',
    'redis://redis:6379#hunter-25-fragment',
    'redis://redis:6379/hunter-25-path',
    'redis://redis:6379/1/hunter-25-path',
    'redis://hunter-25-host:0',
  ])('refuses %s, names REDIS_URL and prints none of it', async (url) => {
    const error: unknown = await load(url).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('REDIS_URL');
    expect((error as Error).message).not.toContain('hunter-25');
  });

  it.each([
    ['redis://redis', { host: 'redis', port: 6379, db: 0, tls: false }],
    ['redis://redis:6379/', { host: 'redis', port: 6379, db: 0, tls: false }],
    ['rediss://cache.internal:6380/3', { host: 'cache.internal', port: 6380, db: 3, tls: true }],
    ['redis://[::1]:6379', { host: '::1', port: 6379, db: 0, tls: false }],
  ])('reads %s as host, port, database and TLS', async (url, target) => {
    expect((await load(url)).redis).toEqual(target);
  });
});
