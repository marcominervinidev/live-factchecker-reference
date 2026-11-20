// Stage-2a support of the detection service (issue #29, T4): a client of the test project's Redis and the reads the
// step files share (every key, every string a key holds), without steps. Not loaded by cucumber.json (features/steps/**
// only); step files import it. features/steps/session.steps.ts (#27, frozen) still holds its own copies of these
// helpers (redis, withRedis, allKeys, contentOf); switching it to this module is a follow-up after #27 is closed.
import { readFileSync } from 'node:fs';

import { Redis } from 'ioredis';

import { required } from './service.ts';

/** A client of the Redis database at `url` (default: the test project's REDIS_URL), connected for `use` only. */
export async function withRedis<T>(
  url: string | undefined,
  use: (client: Redis) => Promise<T>,
): Promise<T> {
  const target = new URL(url ?? required('REDIS_URL'));
  const client = new Redis({
    host: target.hostname,
    port: Number(target.port || 6379),
    db: Number(target.pathname.slice(1) || '0'),
    password: readFileSync(required('REDIS_PASSWORD_FILE'), 'utf8').replace(/\r?\n$/, ''),
    lazyConnect: true,
    // the ready check runs INFO, which the ACL denies (compose.yml)
    enableReadyCheck: false,
    maxRetriesPerRequest: 1,
  });
  try {
    await client.connect();
    return await use(client);
  } finally {
    client.disconnect();
  }
}

/** Every key of the database, by SCAN. */
export async function allKeys(client: Redis): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await client.scan(cursor, 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

/** Every string a key holds, whatever its type (stream, hash, list, set, sorted set, string). */
export async function contentOf(client: Redis, key: string): Promise<string> {
  const type = await client.type(key);
  if (type === 'string') return (await client.get(key)) ?? '';
  if (type === 'hash') return JSON.stringify(await client.hgetall(key));
  if (type === 'list') return JSON.stringify(await client.lrange(key, 0, -1));
  if (type === 'set') return JSON.stringify(await client.smembers(key));
  if (type === 'zset') return JSON.stringify(await client.zrange(key, 0, '-1'));
  if (type === 'stream') return JSON.stringify(await client.xrange(key, '-', '+'));
  return '';
}
