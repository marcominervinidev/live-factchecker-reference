// Stage 1 of the Session store (ticket #27, Task 3) against a fake Redis whose `eval` answers like the scripts do
// (docs/process/test-strategy.md: stage 1 mocks everything but the module). What shows here: how a script reply
// becomes the state or the outcome, and that a reply outside the four outcomes is refused. Which keys and arguments
// reach a script is the module's own protocol with its Lua half, not behaviour: it and the scripts themselves are
// checked only against a real Redis, in features/session.feature (stage 2a).
import { detectionEventFixture, segmentFixture } from '@lfc/contracts/testing';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import {
  createSessionRecords,
  createSessionStore,
  type AppendOutcome,
  type SessionStoreOptions,
} from './store.ts';

const OPTIONS: SessionStoreOptions = { lifetimeSeconds: 900, byteBudget: 4096, maxSessions: 7 };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A Redis whose `eval` answers `reply` to every script. */
function fakeRedis(reply: unknown): { redis: Redis } {
  const fake = { eval: () => Promise.resolve(reply) };
  return { redis: fake as unknown as Redis };
}

describe('createSessionStore, state', () => {
  it('maps the count, the last Segment and the remaining lifetime of a known Session', async () => {
    const sessionId = '0a1b2c3d-0000-4000-8000-000000000101';
    const { redis } = fakeRedis([2, 's-0012', '12.5', 5400]);
    await expect(createSessionStore(redis, OPTIONS).state(sessionId)).resolves.toEqual({
      id: sessionId,
      segments: 2,
      lastSegmentId: 's-0012',
      lastFinalizedAt: 12.5,
      remainingSeconds: 6,
    });
  });

  it('shows a new Session without Segments with null as last Segment and null, not 0, as its finalizedAt', async () => {
    const sessionId = '0a1b2c3d-0000-4000-8000-000000000102';
    const { redis } = fakeRedis([0, null, null, 900_000]);
    await expect(createSessionStore(redis, OPTIONS).state(sessionId)).resolves.toEqual({
      id: sessionId,
      segments: 0,
      lastSegmentId: null,
      lastFinalizedAt: null,
      remainingSeconds: 900,
    });
  });

  it('rounds a remaining lifetime up to whole seconds and never below 0', async () => {
    const sessionId = '0a1b2c3d-0000-4000-8000-000000000103';
    const remaining = async (pttl: number) =>
      (await createSessionStore(fakeRedis([1, 's-1', '1', pttl]).redis, OPTIONS).state(sessionId))
        ?.remainingSeconds;
    expect([await remaining(1), await remaining(1000), await remaining(-2)]).toEqual([1, 1, 0]);
  });

  it('answers undefined for an unknown Session', async () => {
    const { redis } = fakeRedis(null);
    await expect(
      createSessionStore(redis, OPTIONS).state('0a1b2c3d-0000-4000-8000-000000000104'),
    ).resolves.toBeUndefined();
  });
});

describe('createSessionStore, create', () => {
  it('creates a Session with a fresh UUID, no Segments and the full lifetime', async () => {
    const { redis } = fakeRedis(1);
    const created = await createSessionStore(redis, OPTIONS).create();
    if (created === 'full') throw new Error('expected a new Session');
    expect(created.id).toMatch(UUID_V4);
    expect(created).toEqual({
      id: created.id,
      segments: 0,
      lastSegmentId: null,
      lastFinalizedAt: null,
      remainingSeconds: 900,
    });
  });

  it('hands out a different id for every Session', async () => {
    const store = createSessionStore(fakeRedis(1).redis, OPTIONS);
    const [first, second] = [await store.create(), await store.create()];
    if (first === 'full' || second === 'full') throw new Error('expected two new Sessions');
    expect(first.id).not.toBe(second.id);
  });

  it('answers full when the script finds no room for another Session', async () => {
    const { redis } = fakeRedis(0);
    await expect(createSessionStore(redis, OPTIONS).create()).resolves.toBe('full');
  });
});

describe('createSessionStore, append', () => {
  it.each(['accepted', 'unknown', 'not-after', 'full'] as const)(
    'hands on the outcome %s of the script unchanged',
    async (outcome: AppendOutcome) => {
      const { redis } = fakeRedis(outcome);
      await expect(
        createSessionStore(redis, OPTIONS).append(segmentFixture.sessionId, segmentFixture),
      ).resolves.toBe(outcome);
    },
  );

  it.each([['bogus'], [1], [null]])('refuses the unexpected script reply %j', async (reply) => {
    const { redis } = fakeRedis(reply);
    await expect(
      createSessionStore(redis, OPTIONS).append(segmentFixture.sessionId, segmentFixture),
    ).rejects.toThrow(Error);
  });
});

// #29 task 3 (implementer-owned, review finding M3a): the records of the Claim Extractor. The script answers 1 when it
// wrote and 0 when the Session's state hash has no lifetime left (expired or never created); that the written key
// takes the state's remaining lifetime is the Lua half and shows only against a real Redis (stage 2a).
describe('createSessionRecords', () => {
  const candidate = {
    id: 'k-01',
    turnId: 't-001',
    speaker: 'Hukgl Suubayy',
    verbatim: 'das stimmt so nicht',
    segmentIds: ['s-0001'],
    reason: 'bezug_unklar',
    note: 'Bezug unklar',
  };
  const sessionId = detectionEventFixture.sessionId;

  it('resolves when the script wrote the detection event or the Candidate record', async () => {
    const records = createSessionRecords(fakeRedis(1).redis);
    await expect(records.detection(sessionId, detectionEventFixture)).resolves.toBeUndefined();
    await expect(records.candidate(sessionId, candidate)).resolves.toBeUndefined();
  });

  it.each([[0], ['bogus'], [null]])(
    'rejects when the script answers %j: the Session has expired, nothing is written silently',
    async (reply) => {
      const records = createSessionRecords(fakeRedis(reply).redis);
      await expect(records.detection(sessionId, detectionEventFixture)).rejects.toThrow(Error);
      await expect(records.candidate(sessionId, candidate)).rejects.toThrow(Error);
    },
  );
});
