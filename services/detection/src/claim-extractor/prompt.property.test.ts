// Stage 1, issue #29 (T4), Task 2: properties of the prompt assembly (fast-check; ticket Task 2 "fast-check for
// append-only, cap and breakpoint invariants"), AC3 to AC7. Interface: prompt.test.ts (header).
// Generators: a Turn as Segments on a 1/8 s grid split into the calls of its Ticks; Claim lists of 0 to 250 Claims;
// context Turns of 0 to 400 words. Fixed seeds, so a failure reproduces.
// Delta (AC4, owner decision on gate 1 question 9 of 2026-11-03: "Harness-Regel: zusätzlich die vom Deckel verdrängten
// listen"): every Claim not in the Claim list block, as evals/src/harness/pipeline.py delta_cards does:
//   `return [c for c in self.known_until(t) if c["id"] not in ps.frozen_ids]`
import { createClaimPrompt, prefixBlock, attributionBlock, type ClaimShort } from './prompt.ts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seg, sid } from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';

const PARAMETERS = {
  contextTokenCap: 600,
  claimListCap: 100,
  cacheBlockBreakpoint: 20,
  tokensPerWord: 2.1,
};
const FIXED = ['prefix', 'attribution', 'claim_list', 'context'];

function prompt(
  claims: readonly ClaimShort[] = [],
  context: readonly { speaker: string; start: number; end: number; text: string }[] = [],
) {
  return createClaimPrompt({
    prefix: prefixBlock('Anweisung', { mode: 'conversation' }),
    attribution: attributionBlock(['A'], {}),
    claims,
    context,
    parameters: PARAMETERS,
  });
}

function claimsOf(count: number): ClaimShort[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${String(i + 1).padStart(2, '0')}`,
    speaker: 'A',
    sentence: `Satz ${i + 1}.`,
  }));
}

/** A Turn of 1 to 60 Segments, split into 1 to 70 calls (an empty call is a final analysis without new Segments). */
const turnCalls = fc
  .integer({ min: 1, max: 60 })
  .chain((count) =>
    fc.tuple(
      fc.constant(
        Array.from({ length: count }, (_, i) =>
          seg(sid(i + 1), 'A', i * 2, i * 2 + 1.875, i * 2 + 2, `wort${i + 1} und mehr`),
        ),
      ),
      fc.array(fc.integer({ min: 0, max: count }), { minLength: 0, maxLength: 69 }),
    ),
  )
  .map(([segments, cuts]) => {
    const bounds = [...new Set([0, ...cuts, segments.length])].sort((a, b) => a - b);
    const calls: Segment[][] = [];
    for (let i = 1; i < bounds.length; i += 1) calls.push(segments.slice(bounds[i - 1], bounds[i]));
    calls.push([]);
    return calls;
  });

const ids = (text: string) => [...text.matchAll(/^(s-\d+) \[/gm)].map((m) => m[1]);

describe('prompt properties (AC3 to AC7)', () => {
  it('append-only: every call repeats the blocks before it byte for byte and adds one Turn block (AC6)', () => {
    fc.assert(
      fc.property(turnCalls, (calls) => {
        const p = prompt();
        let before: readonly { kind: string; text: string }[] = [];
        calls.forEach((segments, i) => {
          const blocks = p.next({ speaker: 'A', segments, final: i === calls.length - 1 }, []);
          const stable = blocks.filter((b) => FIXED.includes(b.kind) || b.kind === 'turn');
          expect(stable).toHaveLength(FIXED.length + i + 1);
          expect(stable.slice(0, before.length).map((b) => [b.kind, b.text])).toEqual(
            before.map((b) => [b.kind, b.text]),
          );
          before = stable;
        });
      }),
      { seed: 290201, numRuns: 150 },
    );
  });

  it('every Segment of the Turn is in exactly one Turn block, the block of the call that sent it, in order (AC6)', () => {
    fc.assert(
      fc.property(turnCalls, (calls) => {
        const p = prompt();
        let blocks: readonly { kind: string; text: string }[] = [];
        calls.forEach((segments, i) => {
          blocks = p.next({ speaker: 'A', segments, final: i === calls.length - 1 }, []);
        });
        const turns = blocks.filter((b) => b.kind === 'turn');
        expect(turns.map((b) => ids(b.text))).toEqual(
          calls.map((segments) => segments.map((s) => s.id)),
        );
      }),
      { seed: 290202, numRuns: 150 },
    );
  });

  it('cache breakpoints: at most four, always prefix, context and the last Turn block, others only every 20th (AC7)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 130 }), (k) => {
        const p = prompt();
        let blocks: readonly { kind: string; cache: boolean }[] = [];
        for (let n = 1; n <= k; n += 1) {
          blocks = p.next(
            {
              speaker: 'A',
              segments: [seg(sid(n), 'A', n, n + 0.5, n + 0.5, 'Wort')],
              final: false,
            },
            [],
          );
        }
        const turnIndex = blocks.flatMap((b, i) => (b.kind === 'turn' ? [i] : []));
        const marked = blocks.flatMap((b, i) => (b.cache ? [i] : []));
        expect(marked.length).toBeLessThanOrEqual(4);
        expect(blocks[0]?.cache).toBe(true);
        expect(blocks.find((b) => b.kind === 'context')?.cache).toBe(true);
        expect(blocks[turnIndex.at(-1) ?? -1]?.cache).toBe(true);
        const intermediate = turnIndex
          .map((index, n) => ({ index, number: n + 1 }))
          .filter(({ index }) => blocks[index]?.cache && index !== turnIndex.at(-1));
        const multiples = turnIndex.map((_, n) => n + 1).filter((n) => n % 20 === 0 && n !== k);
        expect(intermediate.map((m) => m.number)).toEqual(multiples.slice(-1));
      }),
      { seed: 290203, numRuns: 130 },
    );
  });

  it('the Claim list holds the newest min(n, 100) Claims, the delta every other Claim, displaced ones first (AC3, AC4)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 250 }), fc.integer({ min: 0, max: 30 }), (n, later) => {
        const all = claimsOf(n + later);
        const p = prompt(all.slice(0, n));
        const blocks = p.next(
          { speaker: 'A', segments: [seg(sid(1), 'A', 0, 1, 1, 'Wort')], final: false },
          all,
        );
        const listed = (blocks.find((b) => b.kind === 'claim_list')?.text ?? '')
          .split('\n')
          .slice(1)
          .map((l) => l.split(' · ')[0]);
        const delta = (blocks.find((b) => b.kind === 'delta')?.text ?? '')
          .split('\n')
          .slice(1)
          .map((l) => l.split(' · ')[0]);
        expect(n === 0 ? [] : listed).toEqual(all.slice(Math.max(0, n - 100), n).map((c) => c.id));
        expect(delta).toEqual(
          [...all.slice(0, Math.max(0, n - 100)), ...all.slice(n)].map((c) => c.id),
        );
      }),
      { seed: 290204, numRuns: 200 },
    );
  });

  it('the context Turns keep at most 600 estimated tokens, cut from the beginning of the older Turn first (AC5)', () => {
    const estimate = (count: number) => (count === 0 ? 0 : Math.ceil(count * 2.1));
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        (older, newer) => {
          const words = (p: string, c: number) => Array.from({ length: c }, (_, i) => `${p}${i}`);
          const context = [
            { speaker: 'A', start: 1, end: 2, text: words('o', older).join(' ') },
            { speaker: 'B', start: 3, end: 4, text: words('n', newer).join(' ') },
          ].filter((c) => c.text !== '');
          const p = prompt([], context);
          const text =
            p
              .next(
                { speaker: 'A', segments: [seg(sid(1), 'A', 5, 6, 6, 'Wort')], final: false },
                [],
              )
              .find((b) => b.kind === 'context')?.text ?? '';
          const kept = (prefix: string) =>
            text.split(/\s+/).filter((w) => new RegExp(`^${prefix}\\d+$`).test(w));
          const o = kept('o');
          const nw = kept('n');
          expect(estimate(o.length) + estimate(nw.length)).toBeLessThanOrEqual(600);
          expect(o).toEqual(words('o', older).slice(older - o.length));
          expect(nw).toEqual(words('n', newer).slice(newer - nw.length));
          if (estimate(older) + estimate(newer) <= 600)
            expect([o.length, nw.length]).toEqual([older, newer]);
          if (nw.length < newer) expect(o).toEqual([]);
        },
      ),
      { seed: 290205, numRuns: 300 },
    );
  });
});
