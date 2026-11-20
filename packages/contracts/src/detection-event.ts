// The envelope of a Session's detection stream (ADR 0005, addendum 2026-10-25; fields as decided on #29, decision 1,
// Marco 2026-10-27): one entry per event, discriminated by `type`. `claim` carries a Claim event, `topic` a Topic event
// (#32, T6). With `topic` the envelope is at schemaVersion 2 for every member, `claim` included, and the Claim event
// stays at 1 (review W6, Marco 2026-11-05, "genauso wie empfohlen"; gate 1 of #32, O1; ADR 0005, addendum 2026-11-18).
import { z } from 'zod';

import { ClaimEvent } from './claim-event.ts';
import { unknownFieldsNamed } from './common.ts';
import { Segment } from './segment.ts';
import { TopicEvent } from './topic-event.ts';

const ClaimDetectionEvent = z
  .strictObject({
    schemaVersion: z.literal(2),
    type: z.literal('claim'),
    /** The segment contract's sessionId rule, taken from it, never copied (review W5, Marco 2026-11-05). */
    sessionId: Segment.shape.sessionId,
    claim: ClaimEvent,
  })
  .check(unknownFieldsNamed);

const TopicDetectionEvent = z
  .strictObject({
    schemaVersion: z.literal(2),
    type: z.literal('topic'),
    sessionId: Segment.shape.sessionId,
    topic: TopicEvent,
  })
  .check(unknownFieldsNamed);

export const DetectionEvent = z.discriminatedUnion('type', [
  ClaimDetectionEvent,
  TopicDetectionEvent,
]);

export type DetectionEvent = z.infer<typeof DetectionEvent>;
