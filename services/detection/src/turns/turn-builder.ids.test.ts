// Stage 1, @issue-28 (T3), Task 1, implementer-owned: the Turn id format. The frozen tests treat ids as the builder's
// own business; the harness numbers Turns `t-{counter:03d}` (evals/src/harness/turns.py) and the id lands as `turnId`
// in logs, so the first two Turns are pinned to `t-001` and `t-002`.
import { describe, expect, it } from 'vitest';

import { createTurnBuilder } from './turn-builder.ts';
import { seg, sid, START_VALUES } from '../testing/turns.ts';

describe('Turn builder ids', () => {
  it('numbers consecutive Turns t-001, t-002 like the harness', () => {
    const builder = createTurnBuilder(START_VALUES);
    const events = [
      ...builder.push(seg(sid(1), 'A', 0, 2)),
      ...builder.push(seg(sid(2), 'B', 6, 9)),
      ...builder.end(),
    ];
    const opened = events
      .filter((event) => event.kind === 'turn-opened')
      .map((event) => event.turn.id);
    expect(opened).toEqual(['t-001', 't-002']);
  });
});
