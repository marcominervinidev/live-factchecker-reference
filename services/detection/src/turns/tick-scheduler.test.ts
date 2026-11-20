// Stage 1, @issue-28 (T3), Task 2: the skip rule and its counters, AC9 to AC15 (docs/spec/erkennung-modellrollen.md
// 2: skip while the previous call of the same extractor for the same Turn has not returned, the next Tick carries the
// whole increase, no parallel calls per Turn and extractor, skipped Ticks are counted and reported; ADR 0004). Port of
// on_tick, on_return and the `sent` cursor of call_claim_extractor (evals/src/harness/pipeline.py).
//
// Public interface these tests define (built in Task 2), next to tick-plan.test.ts and turn-builder.test.ts:
//   src/turns/tick-scheduler.ts
//     export type ExtractorName = 'claim_extractor' | 'topic_extractor';   (the harness's role names, which T8 reads
//                                                                           as skipped_ticks)
//     export interface ExtractorCall {
//       readonly turn: Turn;                  // the Turn the call is for
//       readonly segments: readonly Segment[]; // the Turn's Segments not yet sent to this extractor, in order
//       readonly final: boolean;              // the final analysis of the Turn
//       readonly at: number;                  // Session audio time at which the call starts
//     }
//     export interface Extractor {             // the port T4 (Claim Extractor) and T6 (Topic Extractor) implement
//       call(call: ExtractorCall): Promise<{ readonly latencySeconds: number }>;   // resolves when the call is done
//     }
//     export function createTickScheduler(options: {
//       sessionId: string;
//       extractors: Readonly<Record<ExtractorName, Extractor>>;
//       logger: Logger;                       // @lfc/service-kit
//     }): {
//       tick(tick: Tick): Promise<void>;      // a Tick of tick-plan.ts, in order of time
//       drain(): Promise<void>;               // lets every call in flight return and runs what waits for it
//       readonly skippedTicks: Readonly<Record<ExtractorName, number>>;
//     }
//   Simulated clock: a call that starts at `at` returns at `at + latencySeconds`; before a Tick at time t is handled,
//   every call returning at or before t has returned (AC13). The fakes below resolve at once and report a scripted
//   latency; nothing waits on the wall clock.
//   Log event of a skipped Tick: event `tick.skipped` with the Session id, the extractor and the Turn id, nothing
//   else (field names are the implementer's within the logger's closed field list; ticket #28, Assumptions).
import { describe, expect, it } from 'vitest';

import { createTickScheduler, type Extractor, type ExtractorName } from './tick-scheduler.ts';
import { seg, SESSION, sid } from '../testing/turns.ts';
import { createLogger } from '@lfc/service-kit';
import type { Segment } from '@lfc/contracts';
import type { Tick } from './tick-plan.ts';
import type { EndedTurn, Turn } from './types.ts';

interface Call {
  readonly extractor: ExtractorName;
  readonly turn: string;
  readonly segments: string;
  readonly final: boolean;
  readonly at: number;
  readonly returns: number;
}

type Latency = number | readonly number[];

/** A fake extractor: records every call and reports the scripted latency (the last one repeats). */
function fake(name: ExtractorName, latency: Latency, calls: Call[]): Extractor {
  let index = 0;
  return {
    call({ turn, segments, final, at }) {
      const list = typeof latency === 'number' ? [latency] : latency;
      const latencySeconds = list[Math.min(index, list.length - 1)] ?? 0;
      index += 1;
      calls.push({
        extractor: name,
        turn: turn.id,
        segments: segments.map((s) => s.id).join(' '),
        final,
        at,
        returns: at + latencySeconds,
      });
      return Promise.resolve({ latencySeconds });
    },
  };
}

function setup(claim: Latency, topic: Latency) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const scheduler = createTickScheduler({
    sessionId: SESSION,
    extractors: {
      claim_extractor: fake('claim_extractor', claim, calls),
      topic_extractor: fake('topic_extractor', topic, calls),
    },
    logger: createLogger({ service: 'detection', write: (line) => lines.push(line) }),
  });
  const of = (name: ExtractorName) =>
    calls
      .filter((c) => c.extractor === name)
      .map((c) => ({
        turn: c.turn,
        segments: c.segments,
        final: c.final,
        at: c.at,
        returns: c.returns,
      }));
  const events = (name: string) =>
    lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((e) => e['event'] === name);
  return { scheduler, calls, lines, of, events };
}

async function feed(
  scheduler: { tick(t: Tick): Promise<void>; drain(): Promise<void> },
  ticks: readonly Tick[],
) {
  for (const tick of ticks) await scheduler.tick(tick);
  await scheduler.drain();
}

// One Turn t-a of Speaker A: eight Segments of 2.5 s each, finalized at their end.
const TEXT = 'Mietpreisbremse wirkt kaum';
const A: Segment[] = Array.from({ length: 8 }, (_, i) =>
  seg(sid(i + 1), 'A', i * 2.5, (i + 1) * 2.5, (i + 1) * 2.5, TEXT),
);

function turn(id: string, speaker: string, segments: readonly Segment[]): Turn {
  return { id, speaker, interjection: false, segments };
}

function ended(
  id: string,
  speaker: string,
  segments: readonly Segment[],
  endKnownAt: number,
): EndedTurn {
  return { ...turn(id, speaker, segments), endReason: 'stream_end', endKnownAt };
}

/** A non-final Tick of t-a at `time` covering its first `upto` Segments. */
function tickA(time: number, upto: number): Tick {
  return { turn: turn('t-a', 'A', A.slice(0, upto)), time, upto, final: false };
}

/** The final analysis of t-a at `time`, the Turn ending after its first `count` Segments. */
function finalA(time: number, count: number): Tick {
  return { turn: ended('t-a', 'A', A.slice(0, count), time), time, upto: count, final: true };
}

const ids = (from: number, to: number) =>
  A.slice(from - 1, to)
    .map((s) => s.id)
    .join(' ');

describe('createTickScheduler: both extractors get every Tick (AC10) @ac-10', () => {
  it('starts one call of the Claim Extractor and one of the Topic Extractor for every Tick', async () => {
    const { scheduler, of } = setup(1, 1);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), finalA(12, 5)]);
    const expected = [
      { turn: 't-a', segments: ids(1, 2), final: false, at: 5, returns: 6 },
      { turn: 't-a', segments: ids(3, 4), final: false, at: 10, returns: 11 },
      { turn: 't-a', segments: ids(5, 5), final: true, at: 12, returns: 13 },
    ];
    expect(of('claim_extractor')).toEqual(expected);
    expect(of('topic_extractor')).toEqual(expected);
  });
});

describe('createTickScheduler: a Tick during a call of the same extractor for the same Turn is skipped (AC11) @ac-11', () => {
  it('starts no call for a non-final Tick while the previous call has not returned, and counts it for that extractor', async () => {
    const { scheduler, of } = setup(6, 1);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), finalA(12, 5)]);
    expect(of('claim_extractor')).toEqual([
      { turn: 't-a', segments: ids(1, 2), final: false, at: 5, returns: 11 },
      { turn: 't-a', segments: ids(3, 5), final: true, at: 12, returns: 18 },
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 1, topic_extractor: 0 });
  });

  it('gives the next call after a skip every Segment not yet sent, in order', async () => {
    const { scheduler, of } = setup(6, 1);
    await feed(scheduler, [tickA(5, 2), tickA(7.5, 3), tickA(12.5, 5), finalA(13, 5)]);
    expect(of('claim_extractor').map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, ids(1, 2), false],
      [12.5, ids(3, 5), false],
      [18.5, '', true],
    ]);
    expect(scheduler.skippedTicks.claim_extractor).toBe(1);
  });

  it('counts every skipped Tick', async () => {
    const { scheduler, of } = setup(20, 1);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), tickA(15, 6), finalA(20, 8)]);
    expect(of('claim_extractor').map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, ids(1, 2), false],
      [25, ids(3, 8), true],
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 2, topic_extractor: 0 });
  });
});

describe('createTickScheduler: the final analysis is never skipped (AC12) @ac-12', () => {
  it('starts a final analysis that falls due during a call when that call returns, and does not count it', async () => {
    const { scheduler, of } = setup(6, 1);
    await feed(scheduler, [tickA(5, 2), finalA(7.5, 3)]);
    expect(of('claim_extractor')).toEqual([
      { turn: 't-a', segments: ids(1, 2), final: false, at: 5, returns: 11 },
      { turn: 't-a', segments: ids(3, 3), final: true, at: 11, returns: 17 },
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('starts it at the return even without a new Segment, when a non-final Tick and the final analysis fall due together', async () => {
    const { scheduler, of } = setup(6, 1);
    await feed(scheduler, [tickA(5, 2), finalA(5, 2)]);
    expect(of('claim_extractor').map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, ids(1, 2), false],
      [11, '', true],
    ]);
    expect(of('topic_extractor').map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, ids(1, 2), false],
      [6, '', true],
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });
});

describe('createTickScheduler: never two calls of one extractor for one Turn at once (AC13, negative) @ac-13', () => {
  it('counts a call that returns exactly when a Tick falls due as returned: the Tick starts a call, nothing is counted', async () => {
    const { scheduler, of } = setup(5, 5);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), finalA(15, 6)]);
    expect(of('claim_extractor').map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, ids(1, 2), false],
      [10, ids(3, 4), false],
      [15, ids(5, 6), true],
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('starts every call of an extractor for a Turn only after the previous one returned', async () => {
    const { scheduler, calls } = setup([7, 3, 9, 1], [4, 12, 2]);
    await feed(scheduler, [
      tickA(2.5, 1),
      tickA(5, 2),
      tickA(7.5, 3),
      tickA(10, 4),
      tickA(12.5, 5),
      tickA(15, 6),
      tickA(17.5, 7),
      finalA(20, 8),
    ]);
    for (const name of ['claim_extractor', 'topic_extractor'] as const) {
      const own = calls.filter((c) => c.extractor === name);
      own.slice(1).forEach((c, i) => {
        expect(c.at).toBeGreaterThanOrEqual(own[i]?.returns ?? Number.NaN);
      });
    }
  });

  it('runs the Topic Extractor independently of a slow Claim Extractor: none of its Ticks is skipped', async () => {
    const { scheduler, of } = setup(30, 1);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), tickA(15, 6), finalA(20, 8)]);
    expect(of('topic_extractor').map((c) => c.at)).toEqual([5, 10, 15, 20]);
    expect(scheduler.skippedTicks.topic_extractor).toBe(0);
  });

  it('runs a call for an interjection while a call of the same extractor for the ongoing Turn is in flight', async () => {
    const { scheduler, of } = setup(6, 6);
    const b = seg(sid(9), 'B', 5.5, 6.5, 8);
    const turnB: EndedTurn = {
      ...ended('t-b', 'B', [b], 8),
      interjection: true,
      endReason: 'interjection',
    };
    const interjection: Tick = { turn: turnB, time: 8, upto: 1, final: true };
    await feed(scheduler, [tickA(5, 2), interjection, tickA(12.5, 5), finalA(13, 5)]);
    expect(of('claim_extractor').filter((c) => c.turn === 't-b')).toEqual([
      { turn: 't-b', segments: b.id, final: true, at: 8, returns: 14 },
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });
});

describe('createTickScheduler: a Tick without a new Segment starts nothing (AC14, negative) @ac-14', () => {
  it('starts no call and counts nothing for a non-final Tick with no Segment beyond those already sent', async () => {
    const { scheduler, of } = setup(1, 1);
    await feed(scheduler, [tickA(5, 2), tickA(8, 2)]);
    expect(of('claim_extractor').map((c) => c.at)).toEqual([5]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('does not count such a Tick as skipped while the previous call is still in flight either', async () => {
    const { scheduler, of } = setup(6, 6);
    await feed(scheduler, [tickA(5, 2), tickA(8, 2)]);
    expect(of('claim_extractor').map((c) => c.at)).toEqual([5]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });
});

describe('createTickScheduler: skipped Ticks are counted and logged per extractor (AC15) @ac-15', () => {
  it('writes one tick.skipped event per skipped Tick with the Session id, the extractor and the Turn id, and nothing else', async () => {
    const { scheduler, events } = setup(6, 1);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), finalA(12, 5)]);
    const skipped = events('tick.skipped');
    expect(skipped).toHaveLength(1);
    const entry: Record<string, unknown> = skipped[0] ?? {};
    expect(entry['sessionId']).toBe(SESSION);
    const others = Object.entries(entry)
      .filter(([key]) => !['time', 'service', 'event', 'sessionId'].includes(key))
      .map(([, value]) => value);
    expect(others.sort()).toEqual(['claim_extractor', 't-a']);
  });

  it('writes no Transcript text into any log line', async () => {
    const { scheduler, lines } = setup(20, 6);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), tickA(15, 6), finalA(20, 8)]);
    expect(lines.length).toBeGreaterThan(0);
    for (const word of TEXT.split(' ')) {
      expect(lines.filter((line) => line.includes(word))).toEqual([]);
    }
  });

  it('counts the skipped Ticks of each extractor on its own', async () => {
    const { scheduler, events } = setup(20, 6);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), tickA(15, 6), finalA(20, 8)]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 2, topic_extractor: 1 });
    const named = events('tick.skipped').map((e) => Object.values(e));
    expect(named.filter((values) => values.includes('claim_extractor'))).toHaveLength(2);
    expect(named.filter((values) => values.includes('topic_extractor'))).toHaveLength(1);
  });

  it('reports zero for both extractors and writes no tick.skipped event when no Tick was skipped', async () => {
    const { scheduler, events } = setup(1, 1);
    await feed(scheduler, [tickA(5, 2), tickA(10, 4), finalA(12, 5)]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
    expect(events('tick.skipped')).toEqual([]);
  });
});

describe('createTickScheduler: exactly one final analysis per extractor and Turn (AC9) @ac-9', () => {
  it('gives a Turn of a single word one final analysis from each extractor, covering its Segment', async () => {
    const { scheduler, of } = setup(1, 1);
    const word = seg(sid(1), 'A', 0, 0.5, 0.5, 'nein');
    await feed(scheduler, [
      { turn: ended('t-w', 'A', [word], 0.5), time: 0.5, upto: 1, final: true },
    ]);
    const expected = [{ turn: 't-w', segments: word.id, final: true, at: 0.5, returns: 1.5 }];
    expect(of('claim_extractor')).toEqual(expected);
    expect(of('topic_extractor')).toEqual(expected);
  });
});
