// Stage 1, issue #29 (T4), Task 1: the envelope of a Session's detection stream (ADR 0005, addendum 2026-10-25),
// discriminated by `type`: `claim` now, `topic` added by T6. Field list after the ticket's decision 1 (Marco,
// 2026-10-27): { schemaVersion, type: "claim", sessionId, claim }.
//
// Public interface these tests define (built in Task 1, skill `new-contract`, its own commit):
//   src/detection-event.ts   export const DetectionEvent   a Zod schema, a discriminated union on `type` whose `claim`
//                                                          member is a strict object with schemaVersion: z.literal(2)
//                            export type DetectionEvent    its inferred type
//   src/index.ts             exports DetectionEvent
//   src/testing/fixtures.ts  export const detectionEventFixture: DetectionEvent   a valid example (type "claim")
//   A rejection names the failing field: the first element of an issue's path is that field; a rejection inside the
//   Claim names `claim` first and the Claim's field second.
// sessionId: the bounds of the segment contract's sessionId (min 1, max 64), the Session ids of #27 are UUIDs.
// Owner unlock for #32 (T6), gate 1 of #32, O1, 2026-11-18 (Marco: "Tor 1 wie empfohlen"): T6 adds the member
// `topic`, so the envelope is at schemaVersion 2 for every member, `claim` included, and the Claim event stays at 1
// (packages/contracts/README.md, decision of 2026-11-05; ADR 0005, addendum of #32). The `topic` member itself is
// tested in src/detection-event.topic.test.ts (#32).
import { describe, expect, it } from 'vitest';

import { DetectionEvent } from './detection-event.ts';
import { claimEventFixture, detectionEventFixture } from './testing/fixtures.ts';

type Json = Record<string, unknown>;

const SESSION = '29a0c0de-0000-4000-8000-000000000001';

function valid(): Json {
  return { schemaVersion: 2, type: 'claim', sessionId: SESSION, claim: { ...claimEventFixture } };
}

function paths(value: unknown): (string | number)[][] {
  const result = DetectionEvent.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => [...issue.path] as (string | number)[]);
}

function expectRejected(value: unknown, field: string): void {
  expect(DetectionEvent.safeParse(value).success).toBe(false);
  expect(paths(value).map((path) => path[0])).toContain(field);
}

describe('DetectionEvent accepts a Claim event in its envelope (AC11)', () => {
  it('parses an envelope of type claim unchanged', () => {
    const result = DetectionEvent.safeParse(valid());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(valid());
  });

  it('parses the fixture of @lfc/contracts/testing, an envelope of type claim', () => {
    const result = DetectionEvent.safeParse(detectionEventFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('claim');
  });

  it('survives a JSON round trip unchanged', () => {
    const parsed = DetectionEvent.parse(
      JSON.parse(JSON.stringify(detectionEventFixture)) as unknown,
    );
    expect(parsed).toEqual(detectionEventFixture);
  });

  it('accepts a sessionId of 64 characters', () => {
    expect(DetectionEvent.safeParse({ ...valid(), sessionId: 'x'.repeat(64) }).success).toBe(true);
  });
});

describe('DetectionEvent rejects an invalid envelope and names the field', () => {
  it.each(['schemaVersion', 'type', 'sessionId', 'claim'])('rejects an envelope without %s', (field) => {
    const event = valid();
    delete event[field];
    expect(DetectionEvent.safeParse(event).success).toBe(false);
  });

  it.each([
    ['schemaVersion', 1],
    ['sessionId', ''],
    ['sessionId', 'x'.repeat(65)],
  ])('rejects %s = %j', (field, value) => {
    expectRejected({ ...valid(), [field]: value }, field);
  });

  it('rejects a type topic carrying a Claim and a type no member of the union has', () => {
    expect(DetectionEvent.safeParse({ ...valid(), type: 'topic' }).success).toBe(false);
    expect(DetectionEvent.safeParse({ ...valid(), type: 'candidate' }).success).toBe(false);
  });

  it('rejects an unknown envelope field and names it', () => {
    expectRejected({ ...valid(), turnId: 't-002' }, 'turnId');
  });

  it('rejects an invalid Claim and names claim, then the Claim field', () => {
    const event = { ...valid(), claim: { ...claimEventFixture, kind: 'prognose' } };
    expect(DetectionEvent.safeParse(event).success).toBe(false);
    expect(paths(event)).toContainEqual(['claim', 'kind']);
  });

  it('rejects a Claim that carries repeatOf, naming claim and repeatOf', () => {
    const event = { ...valid(), claim: { ...claimEventFixture, repeatOf: null } };
    expect(paths(event)).toContainEqual(['claim', 'repeatOf']);
  });
});
