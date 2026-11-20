// Stage 1, @issue-28 (T3), Task 2, gate-1 addendum of 2026-10-30 (coverage gaps S7 and P12 named by the review of
// task 2): the skip rule when a Tick without a new Segment falls due during a call, and the Ticks of an interjection
// when a Tick is shorter than an interjection may be.
//
// Item S7, a Tick without a new Segment while a call is in flight: AC14 (such a Tick starts no call and is not
// counted), AC11 (a non-final Tick during the call starts nothing, is counted, the next call carries every Segment
// not yet sent), AC12 (the final analysis starts when the call in flight returns, never skipped, not counted), AC13
// (never two calls of one extractor for one Turn in flight at once). The Tick of AC14 does not end the call in flight,
// so the Ticks after it are judged against that call. The case with controllable promises calls tick() without
// awaiting it, as a live Session does (services/detection/README.md "Ticks": the lane order needs no await, a Session
// awaits tick() only in a replay run), and checks AC13 on the extractor port itself.
//
// Item P12, an interjection with tickSeconds below interjectionMaxSeconds: AC4 (the interjection is a Turn of its own,
// the first Speaker's later Segments join the ongoing Turn), AC8 ("within a Turn": the speech of a Turn's own Segments
// counts, so the interjection's speech never counts for the interrupted Turn, and an interjection that reaches a
// multiple of tickSeconds gets its own non-final Tick), AC9 (exactly one final analysis per Turn, an interjection
// included, at the time its end is known: the first Speaker's resumption, owner decision 2026-10-29), AC13 (Turns
// run independently, nothing is counted as skipped), AC17 (each Turn's Segments go to each extractor exactly once).
// The harness gives an interjection Turn its own non-final Ticks the same way (evals/src/harness/pipeline.py run:
// tick_plan for every Turn).
//
// PENDING OWNER DECISION F2 OF 2026-10-30, recommendation: release time. A held-back run (AC4, AC7) joins a Turn only
// when it is decided, so a non-final Tick of its Segments falls due at the time the run is released (the
// finalizedAt of the Segment that decides it), not at the earlier finalizedAt of the Segment that reaches the
// multiple, as AC8 read literally and the harness would have it: the ticket's knowable-times Assumption and the owner
// decision of 2026-10-29 for the final analysis of an interjection (15, not 10). Pinned for an interjection (released
// when A resumes) and for a run that turns out to be no interjection (released by a third Speaker, AC5). The Tick
// plan sees only the Turn events (next(event), frozen interface); how the release time gets there is the
// implementer's choice within that interface. These two cases are red on task/28-2 (it says 10) until the decision
// and the code exist; with the start values (5 s Ticks, interjections under 2 s) they never apply.
//
// Interfaces: tick-scheduler.test.ts, tick-plan.test.ts, turn-builder.test.ts (frozen). Fakes only at the extractor
// port: scripted latencies on Session audio time, or promises the test settles; nothing waits on the wall clock.
import {
  createTickScheduler,
  type Extractor,
  type ExtractorCall,
  type ExtractorName,
} from './tick-scheduler.ts';
import { createTickPlan, type Tick } from './tick-plan.ts';
import { createTurnBuilder } from './turn-builder.ts';
import { describe, expect, it } from 'vitest';
import { seg, SESSION, sid, START_VALUES } from '../testing/turns.ts';
import { createLogger } from '@lfc/service-kit';
import type { Segment } from '@lfc/contracts';
import type { EndedTurn, Turn, TurnEvent, TurnParameters } from './types.ts';

interface Call {
  readonly extractor: ExtractorName;
  readonly turn: string;
  readonly segments: string;
  readonly final: boolean;
  readonly at: number;
  readonly returns: number;
}

/** A fake extractor that records every call and reports a fixed latency at once. */
function fake(name: ExtractorName, latencySeconds: number, calls: Call[]): Extractor {
  return {
    call({ turn, segments, final, at }) {
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

function logger(lines: string[]) {
  return createLogger({ service: 'detection', write: (line) => lines.push(line) });
}

function setup(claim: number, topic: number) {
  const calls: Call[] = [];
  const scheduler = createTickScheduler({
    sessionId: SESSION,
    extractors: {
      claim_extractor: fake('claim_extractor', claim, calls),
      topic_extractor: fake('topic_extractor', topic, calls),
    },
    logger: logger([]),
  });
  const of = (name: ExtractorName) =>
    calls
      .filter((c) => c.extractor === name)
      .map(({ segments, final, at, returns }) => ({ segments, final, at, returns }));
  return { scheduler, of };
}

async function feed(
  scheduler: { tick(t: Tick): Promise<void>; drain(): Promise<void> },
  ticks: readonly Tick[],
) {
  for (const tick of ticks) await scheduler.tick(tick);
  await scheduler.drain();
}

/** Lets every pending promise reaction run (the microtask queue drains before setImmediate fires). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// One Turn t-s7 of Speaker A: eight Segments of 2.5 s each, finalized at their end.
const A: Segment[] = Array.from({ length: 8 }, (_, i) =>
  seg(sid(i + 1), 'A', i * 2.5, (i + 1) * 2.5, (i + 1) * 2.5),
);

function turnA(upto: number): Turn {
  return { id: 't-s7', speaker: 'A', interjection: false, segments: A.slice(0, upto) };
}

/** A non-final Tick of t-s7 at `time` covering its first `upto` Segments. */
function tickA(time: number, upto: number): Tick {
  return { turn: turnA(upto), time, upto, final: false };
}

/** The final analysis of t-s7 at `time`, the Turn ending after its first `count` Segments. */
function finalA(time: number, count: number): Tick {
  const ended: EndedTurn = { ...turnA(count), endReason: 'stream_end', endKnownAt: time };
  return { turn: ended, time, upto: count, final: true };
}

const ids = (from: number, to: number) =>
  A.slice(from - 1, to)
    .map((s) => s.id)
    .join(' ');

describe('createTickScheduler: a Tick without a new Segment leaves the call in flight running (item S7, AC14 with AC11 to AC13) @ac-14', () => {
  it('skips and counts a non-final Tick that falls due after such a Tick but before the call in flight returns', async () => {
    // Claim call at 5 returns at 11; the Tick at 8 covers no new Segment (AC14); the Tick at 10 brings Segments 3
    // and 4 while the call at 5 is still in flight (AC11); the final analysis at 12 carries 3 to 5 (AC11, AC12)
    const { scheduler, of } = setup(6, 1);
    await feed(scheduler, [tickA(5, 2), tickA(8, 2), tickA(10, 4), finalA(12, 5)]);
    expect(of('claim_extractor')).toEqual([
      { segments: ids(1, 2), final: false, at: 5, returns: 11 },
      { segments: ids(3, 5), final: true, at: 12, returns: 18 },
    ]);
    expect(of('topic_extractor').map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, ids(1, 2), false],
      [10, ids(3, 4), false],
      [12, ids(5, 5), true],
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 1, topic_extractor: 0 });
  });

  it('starts the final analysis that falls due after such a Tick only when the call in flight returns', async () => {
    // the Turn ends at 9, while the claim call of 5 runs until 11 (AC12): the final analysis starts at 11
    const { scheduler, of } = setup(6, 1);
    await feed(scheduler, [tickA(5, 2), tickA(8, 2), finalA(9, 3)]);
    expect(of('claim_extractor')).toEqual([
      { segments: ids(1, 2), final: false, at: 5, returns: 11 },
      { segments: ids(3, 3), final: true, at: 11, returns: 17 },
    ]);
    expect(of('topic_extractor').map((c) => [c.at, c.segments, c.final])).toEqual([
      [5, ids(1, 2), false],
      [9, ids(3, 3), true],
    ]);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('never has a second call of the extractor for the Turn in flight while the first one has not returned', async () => {
    const started: { call: ExtractorCall; settle: (latencySeconds: number) => void }[] = [];
    let inFlight = 0;
    let mostInFlight = 0;
    const claim: Extractor = {
      call(call) {
        inFlight += 1;
        mostInFlight = Math.max(mostInFlight, inFlight);
        const outcome = Promise.withResolvers<{ readonly latencySeconds: number }>();
        started.push({
          call,
          settle: (latencySeconds) => {
            inFlight -= 1;
            outcome.resolve({ latencySeconds });
          },
        });
        return outcome.promise;
      },
    };
    const topic: Extractor = { call: () => Promise.resolve({ latencySeconds: 1 }) };
    const scheduler = createTickScheduler({
      sessionId: SESSION,
      extractors: { claim_extractor: claim, topic_extractor: topic },
      logger: logger([]),
    });
    const seen = () =>
      started.map(({ call }) => [call.at, call.segments.map((s) => s.id).join(' '), call.final]);

    const ticking = [tickA(5, 2), tickA(8, 2), tickA(10, 4), finalA(12, 5)].map((t) =>
      scheduler.tick(t),
    );
    await flush();
    expect(seen()).toEqual([[5, ids(1, 2), false]]);

    started[0]?.settle(6); // returns at 11: the Tick at 10 was skipped, the final analysis starts at 12
    await flush();
    expect(seen()).toEqual([
      [5, ids(1, 2), false],
      [12, ids(3, 5), true],
    ]);

    started[1]?.settle(1);
    await Promise.all(ticking);
    await scheduler.drain();
    expect(mostInFlight).toBe(1);
    expect(seen()).toHaveLength(2);
    expect(scheduler.skippedTicks).toEqual({ claim_extractor: 1, topic_extractor: 0 });
  });
});

// tickSeconds 1 s, shorter than an interjection may be (interjectionMaxSeconds 2 s); the other values are spec 8's.
const SHORT_TICKS: TurnParameters = { ...START_VALUES, tickSeconds: 1 };

/** Turn building, Tick plan and scheduler driven the way the Session drives them (Task 3), fakes at the port. */
async function replay(segments: readonly Segment[], parameters: TurnParameters) {
  const builder = createTurnBuilder(parameters);
  const plan = createTickPlan(parameters);
  const calls: Call[] = [];
  const scheduler = createTickScheduler({
    sessionId: SESSION,
    extractors: {
      claim_extractor: fake('claim_extractor', 0.25, calls),
      topic_extractor: fake('topic_extractor', 0.25, calls),
    },
    logger: logger([]),
  });
  const ticks: Tick[] = [];
  const turns: EndedTurn[] = [];
  const handle = async (events: readonly TurnEvent[]) => {
    for (const event of events) {
      if (event.kind === 'turn-ended') turns.push(event.turn);
      for (const tick of plan.next(event)) {
        ticks.push(tick);
        await scheduler.tick(tick);
      }
    }
  };
  for (const segment of segments) await handle(builder.push(segment));
  await handle(builder.end());
  await scheduler.drain();
  const turnOf = (segmentIds: string) => {
    const found = turns.find((t) => t.segments.map((s) => s.id).join(' ') === segmentIds);
    if (found === undefined) throw new Error(`no Turn with Segments ${segmentIds}`);
    return found;
  };
  const ticksOf = (turn: Turn) =>
    ticks
      .filter((t) => t.turn.id === turn.id)
      .map((t) => ({ time: t.time, upto: t.upto, final: t.final }));
  const sentTo = (name: ExtractorName, turn: Turn) =>
    calls
      .filter((c) => c.extractor === name && c.turn === turn.id)
      .flatMap((c) => (c.segments === '' ? [] : c.segments.split(' ')));
  const finalsTo = (name: ExtractorName, turn: Turn) =>
    calls.filter((c) => c.extractor === name && c.turn === turn.id && c.final).length;
  return { turnOf, ticksOf, sentTo, finalsTo, skipped: { ...scheduler.skippedTicks } };
}

const [S1, S2, S3] = [sid(1), sid(2), sid(3)];

describe('Turn building, Tick plan and scheduler: an interjection when a Tick is shorter than it (item P12, AC4 with AC8, AC9, AC13) @ac-8 @ac-9', () => {
  it('gives an interjection of 1.5 s its own non-final Tick and its final analysis, and counts its speech for no other Turn', async () => {
    // A 0-10, B interjects 6-7.5 (overlap, 1.5 s, held back until A resumes), A resumes 10.2-15
    const { turnOf, ticksOf, sentTo, finalsTo, skipped } = await replay(
      [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 10.2, 15)],
      SHORT_TICKS,
    );
    const interjection = turnOf(S2);
    const interrupted = turnOf(`${S1} ${S3}`);
    expect([interjection.endReason, interjection.interjection]).toEqual(['interjection', true]);

    // its time is pinned in the cases of owner decision F2 below
    const own = ticksOf(interjection);
    expect(own.filter((t) => !t.final).map((t) => t.upto)).toEqual([1]);
    expect(own.filter((t) => t.final)).toEqual([{ time: 15, upto: 1, final: true }]);

    // A's speech is 10 s with S1 and 14.8 s with S3, without B's 1.5 s: one Tick each, then the final analysis
    expect(ticksOf(interrupted)).toEqual([
      { time: 10, upto: 1, final: false },
      { time: 15, upto: 2, final: false },
      { time: 15, upto: 2, final: true },
    ]);

    for (const name of ['claim_extractor', 'topic_extractor'] as const) {
      expect(sentTo(name, interjection)).toEqual([S2]);
      expect(finalsTo(name, interjection)).toBe(1);
      expect(sentTo(name, interrupted)).toEqual([S1, S3]);
      expect(finalsTo(name, interrupted)).toBe(1);
    }
    expect(skipped).toEqual({ claim_extractor: 0, topic_extractor: 0 });
  });

  it('gives an interjection of 0.875 s, below one Tick of speech, only its final analysis', async () => {
    const { turnOf, ticksOf } = await replay(
      [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 6.875, 10), seg(S3, 'A', 10.2, 15)],
      SHORT_TICKS,
    );
    const interjection = turnOf(S2);
    expect([interjection.endReason, interjection.interjection]).toEqual(['interjection', true]);
    expect(ticksOf(interjection)).toEqual([{ time: 15, upto: 1, final: true }]);
  });
});

describe('Tick plan: a non-final Tick of a held-back run falls due when the run is released (pending owner decision F2 of 2026-10-30, AC7 with AC8) @ac-8', () => {
  it('lets the interjection’s non-final Tick fall due at 15, when A resumes, not at 10, when its Segment was final', async () => {
    const { turnOf, ticksOf } = await replay(
      [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'A', 10.2, 15)],
      SHORT_TICKS,
    );
    expect(ticksOf(turnOf(S2))).toEqual([
      { time: 15, upto: 1, final: false },
      { time: 15, upto: 1, final: true },
    ]);
  });

  it('lets the non-final Tick of a run released as no interjection by a third Speaker fall due at the release, 15', async () => {
    // A 0-10, B 6-7.5 overlapping (held), C 10.2-15: no interjection (AC5), A ends with speaker_change at 15, B's run
    // opens the next Turn and ends when C starts after it (AC3), both known with C's Segment, final at 15 (AC7)
    const { turnOf, ticksOf } = await replay(
      [seg(S1, 'A', 0, 10, 10), seg(S2, 'B', 6, 7.5, 10), seg(S3, 'C', 10.2, 15)],
      SHORT_TICKS,
    );
    const released = turnOf(S2);
    expect([released.endReason, released.interjection]).toEqual(['speaker_change', false]);
    expect(ticksOf(released)).toEqual([
      { time: 15, upto: 1, final: false },
      { time: 15, upto: 1, final: true },
    ]);
    // A's own Segment was never held: its Tick stays at its finalizedAt (AC8)
    expect(ticksOf(turnOf(S1))).toEqual([
      { time: 10, upto: 1, final: false },
      { time: 15, upto: 1, final: true },
    ]);
  });
});
