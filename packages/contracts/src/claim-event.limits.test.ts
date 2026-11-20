// Stage 1, issue #29 (T4), Task 1, review W4: the upper bounds of the Claim event's free-text fields (owner Marco,
// 2026-11-05, "genauso wie empfohlen": `sentence` and `verbatim` at most 1000 characters, the other free-text
// fields a sensible bound; ADR 0005, addendum 2026-11-05). `speaker` is a name and gets 200 characters.
// One case per bound: the bound itself is accepted, one character more is rejected and the rejection names the
// field; the envelope names it under `claim`. Every string here is ASCII, so a character is one UTF-16 code unit.
// Black box: only ClaimEvent.safeParse and DetectionEvent.safeParse.
import { describe, expect, it } from 'vitest';

import { ClaimEvent } from './claim-event.ts';
import { DetectionEvent } from './detection-event.ts';
import { claimEventFixture, detectionEventFixture } from './testing/fixtures.ts';

const BOUNDS = [
  ['speaker', 200],
  ['sentence', 1000],
  ['verbatim', 1000],
] as const;

/** ASCII text of exactly `length` characters. */
function textOf(length: number): string {
  return 'abcdefghij'.repeat(Math.ceil(length / 10)).slice(0, length);
}

describe('ClaimEvent upper bounds of the free-text fields', () => {
  it.each(BOUNDS)('accepts a %s of exactly %i characters', (field, bound) => {
    expect(ClaimEvent.safeParse({ ...claimEventFixture, [field]: textOf(bound) }).success).toBe(
      true,
    );
  });

  it.each(BOUNDS)('rejects a %s of %i characters plus one and names the field', (field, bound) => {
    const result = ClaimEvent.safeParse({ ...claimEventFixture, [field]: textOf(bound + 1) });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([[field]]);
  });

  it.each(BOUNDS)(
    'the envelope rejects a claim whose %s is too long, under claim',
    (field, bound) => {
      const claim = { ...claimEventFixture, [field]: textOf(bound + 1) };
      const result = DetectionEvent.safeParse({ ...detectionEventFixture, claim });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([['claim', field]]);
    },
  );
});
