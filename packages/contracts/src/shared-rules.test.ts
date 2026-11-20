// Stage 1, issue #29 (T4), Task 1, review W5: the rules the detection stream shares with the segment contract
// come from one place (owner Marco, 2026-11-05, "genauso wie empfohlen": "speakerLabel, segmentIds, sessionId rules
// shared with the segment contract from one place in packages/contracts, no duplicated regex"; README, Pitfalls).
// A copy would let the Claim event drift when Segment changes; these cases fail as soon as one field gets its own rule.
import { describe, expect, it } from 'vitest';

import { ClaimEvent } from './claim-event.ts';
import { DetectionEvent } from './detection-event.ts';
import { Segment } from './segment.ts';

describe('rules shared with the segment contract', () => {
  it('speakerLabel of the Claim event is the Segment speaker rule', () => {
    expect(ClaimEvent.shape.speakerLabel).toBe(Segment.shape.speaker);
  });

  it('every segmentIds entry of the Claim event follows the Segment id rule', () => {
    expect(ClaimEvent.shape.segmentIds.element).toBe(Segment.shape.id);
  });

  it('sessionId of every envelope member is the Segment sessionId rule', () => {
    for (const member of DetectionEvent.options) {
      expect(member.shape.sessionId).toBe(Segment.shape.sessionId);
    }
  });
});
