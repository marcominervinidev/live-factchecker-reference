// The random order of an acceptance run (review R6): casePlan is what run.ts runs; two fixed seeds put the canary
// at different places among the real cases of features/25. Plans only, no step runs.
import { describe, expect, it } from 'vitest';

import { canaryFeature, casePlan, plannedTitles } from './cases.ts';

const CANARY = {
  title: 'Canary',
  expected: 'Wenn ich per HTTPS /health abfrage, antwortet der Eingang mit 200.',
};

describe('casePlan', () => {
  it('runs the ticket cases and the canary in an order fixed by the seed', () => {
    expect(casePlan('25', '/tmp/case.feature', 7)).toEqual({
      paths: ['features/25/**/*.feature', '/tmp/case.feature'],
      order: 'random:7',
    });
  });

  it('puts the canary at different places for two seeds, the real cases all planned', async () => {
    const file = canaryFeature(CANARY);
    const [first, second] = await Promise.all(
      [1, 2].map((seed) => plannedTitles(casePlan('25', file, seed))),
    );
    expect(first?.indexOf('Canary')).not.toBe(second?.indexOf('Canary'));
    expect([...(first ?? [])].sort()).toEqual([...(second ?? [])].sort());
    expect(first).toHaveLength(4);
  });

  it('gives the same order for the same seed', async () => {
    const file = canaryFeature(CANARY);
    expect(await plannedTitles(casePlan('25', file, 5))).toEqual(
      await plannedTitles(casePlan('25', file, 5)),
    );
  });
});
