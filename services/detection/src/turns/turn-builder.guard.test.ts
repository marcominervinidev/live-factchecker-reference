// Stage 1, @issue-28 (T3), Task 1, implementer-owned: the guard of the Turn builder after the end of the Input
// (review finding R1). A Segment after end() fails fast; a second end() has nothing left to end. The error is checked
// for the state it names, not its wording (review W1).
import { describe, expect, it } from 'vitest';

import { createTurnBuilder } from './turn-builder.ts';
import { seg, sid, START_VALUES } from '../testing/turns.ts';

describe('Turn builder after the end of the Input', () => {
  it('throws on a Segment pushed after end()', () => {
    const builder = createTurnBuilder(START_VALUES);
    builder.push(seg(sid(1), 'A', 0, 2));
    builder.end();
    // Only the state the README and TurnBuilder.end() name ("the end of the Input"), not the sentence around it.
    expect(() => builder.push(seg(sid(2), 'A', 3, 4))).toThrow(/end of the Input/i);
  });

  it('returns no events from a second end()', () => {
    const builder = createTurnBuilder(START_VALUES);
    builder.push(seg(sid(1), 'A', 0, 2));
    expect(builder.end().map((event) => event.kind)).toEqual(['turn-ended']);
    expect(builder.end()).toEqual([]);
  });
});
