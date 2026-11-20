// Stage 1, issue #32 (T6), contract commit (skill `new-contract`): the envelope of a Session's detection stream gets
// its second member, `topic` (ticket #32, decision 1, Marco 2026-10-27: "an envelope entry with `type: "topic"` in
// T4's envelope"). Versioning as decided for T6 (packages/contracts/README.md, row DetectionEvent; Marco 2026-11-05,
// "genauso wie empfohlen"): "when T6 adds `topic`, the envelope gets schemaVersion 2 (every member, `claim` included;
// the writer writes the current version) and the Claim event stays at 1".
//
// Public interface these tests define:
//   src/detection-event.ts   DetectionEvent   discriminated union on `type`; both members strict objects with
//                                             schemaVersion: z.literal(2) and the segment contract's sessionId rule:
//                              { schemaVersion: 2, type: 'claim', sessionId, claim: ClaimEvent }   (ClaimEvent at 1)
//                              { schemaVersion: 2, type: 'topic', sessionId, topic: TopicEvent }   (TopicEvent at 1)
//   src/testing/fixtures.ts  detectionEventFixture (type claim) at schemaVersion 2,
//                            topicDetectionEventFixture (P): the Topic event fixture in its envelope
// Conflict with the frozen tests of #29 (owner, gate 1 of #32, O1, 2026-11-18, "Tor 1 wie empfohlen": unlock both
// files, dated addendum to ADR 0005): packages/contracts/src/detection-event.test.ts pins schemaVersion 1 and rejects
// `topic`; services/detection/src/claim-extractor/claim-extractor.test.ts:266 expects `schemaVersion: 1` on a written
// envelope. The owner unlocks both in one commit at the start of #32's task branch, before the contract commit
// (.owner-pakete/unlock-29-envelope-v2.sh; the contract commit itself may touch nothing outside packages/contracts/,
// scripts/check-contract-change.sh, so .claude/frozen/29.json cannot change in it). The contract commit names ADR 0005;
// the dated addendum to docs/adr/0005-inputs-mit-zwei-naehten.md (field list and bounds of the Topic event) is its own
// commit in the same change set (the contract check asks for an ADR in the change set; no new ADR).
import { describe, expect, it } from 'vitest';

import { DetectionEvent } from './detection-event.ts';
import {
  claimEventFixture,
  detectionEventFixture,
  topicDetectionEventFixture,
  topicEventFixture,
} from './testing/fixtures.ts';

type Json = Record<string, unknown>;

const SESSION = '32a0c0de-0000-4000-8000-000000000001';

const TOPIC: Json = {
  schemaVersion: 1,
  tickAt: 80.828,
  current: ['Programmatik', 'Euro'],
  new: [{ tag: 'Euro', parent: 'Programmatik' }],
  returned: [],
  ended: [],
};

function topicEnvelope(): Json {
  return { schemaVersion: 2, type: 'topic', sessionId: SESSION, topic: { ...TOPIC } };
}

function claimEnvelope(): Json {
  return { schemaVersion: 2, type: 'claim', sessionId: SESSION, claim: { ...claimEventFixture } };
}

function without(event: Json, field: string): Json {
  return Object.fromEntries(Object.entries(event).filter(([name]) => name !== field));
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

describe('DetectionEvent carries a Topic event in its envelope (AC9)', () => {
  it('parses an envelope of type topic unchanged', () => {
    const result = DetectionEvent.safeParse(topicEnvelope());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(topicEnvelope());
  });

  it('parses the Topic event fixture in its envelope', () => {
    const result = DetectionEvent.safeParse(topicDetectionEventFixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('topic');
  });

  it('carries the Topic event fixture unchanged inside its envelope fixture', () => {
    expect(topicDetectionEventFixture).toMatchObject({ type: 'topic', topic: topicEventFixture });
  });

  it('survives a JSON round trip unchanged', () => {
    const parsed = DetectionEvent.parse(
      JSON.parse(JSON.stringify(topicDetectionEventFixture)) as unknown,
    );
    expect(parsed).toEqual(topicDetectionEventFixture);
  });
});

describe('the envelope moves to schemaVersion 2 for every member, the Claim event stays at 1', () => {
  it('parses an envelope of type claim at schemaVersion 2 with a Claim event at 1', () => {
    expect(DetectionEvent.safeParse(claimEnvelope()).success).toBe(true);
  });

  it('keeps the Claim event fixture in an envelope fixture of schemaVersion 2', () => {
    expect(detectionEventFixture).toMatchObject({ schemaVersion: 2, type: 'claim' });
    expect(DetectionEvent.safeParse(detectionEventFixture).success).toBe(true);
  });

  it.each([
    ['topic', topicEnvelope],
    ['claim', claimEnvelope],
  ])('rejects an envelope of type %s at schemaVersion 1, naming schemaVersion', (_, envelope) => {
    expectRejected({ ...envelope(), schemaVersion: 1 }, 'schemaVersion');
  });

  it('rejects a Claim event of schemaVersion 2 inside the envelope, naming claim and schemaVersion', () => {
    const event = { ...claimEnvelope(), claim: { ...claimEventFixture, schemaVersion: 2 } };
    expect(paths(event)).toContainEqual(['claim', 'schemaVersion']);
  });

  it('rejects a Topic event of schemaVersion 2 inside the envelope, naming topic and schemaVersion', () => {
    const event = { ...topicEnvelope(), topic: { ...TOPIC, schemaVersion: 2 } };
    expect(paths(event)).toContainEqual(['topic', 'schemaVersion']);
  });
});

describe('DetectionEvent rejects an invalid Topic envelope and names the field', () => {
  it.each(['schemaVersion', 'type', 'sessionId', 'topic'])(
    'rejects a Topic envelope without %s',
    (field) => {
      expect(DetectionEvent.safeParse(without(topicEnvelope(), field)).success).toBe(false);
    },
  );

  it.each([
    ['sessionId', ''],
    ['sessionId', 'x'.repeat(65)],
  ])('rejects %s = %j, the sessionId rule of the segment contract', (field, value) => {
    expectRejected({ ...topicEnvelope(), [field]: value }, field);
  });

  it('accepts a sessionId of 64 characters', () => {
    expect(
      DetectionEvent.safeParse({ ...topicEnvelope(), sessionId: 'x'.repeat(64) }).success,
    ).toBe(true);
  });

  it('rejects an envelope of type topic that carries a Claim instead of a Topic event', () => {
    const event = { ...without(topicEnvelope(), 'topic'), claim: { ...claimEventFixture } };
    expect(DetectionEvent.safeParse(event).success).toBe(false);
  });

  it('rejects an envelope of type claim that carries a Topic event instead of a Claim', () => {
    const event = { ...without(claimEnvelope(), 'claim'), topic: { ...TOPIC } };
    expect(DetectionEvent.safeParse(event).success).toBe(false);
  });

  it('rejects an unknown field of a Topic envelope and names it', () => {
    expectRejected({ ...topicEnvelope(), turnId: 't-002' }, 'turnId');
  });

  it('rejects an invalid Topic event and names topic, then the field', () => {
    const event = { ...topicEnvelope(), topic: { ...TOPIC, current: 'Euro' } };
    expect(DetectionEvent.safeParse(event).success).toBe(false);
    expect(paths(event)).toContainEqual(['topic', 'current']);
  });

  it('rejects a Topic event whose tag has 201 characters, naming topic, current and the index (O3)', () => {
    const event = { ...topicEnvelope(), topic: { ...TOPIC, current: ['Euro', 'x'.repeat(201)] } };
    expect(paths(event)).toEqual([['topic', 'current', 1]]);
  });

  it('rejects a Topic event that names its Session itself, naming topic and sessionId (O3)', () => {
    const event = { ...topicEnvelope(), topic: { ...TOPIC, sessionId: SESSION } };
    expect(paths(event)).toContainEqual(['topic', 'sessionId']);
  });

  it('rejects a type no member of the union has', () => {
    expect(DetectionEvent.safeParse({ ...topicEnvelope(), type: 'candidate' }).success).toBe(false);
  });
});
