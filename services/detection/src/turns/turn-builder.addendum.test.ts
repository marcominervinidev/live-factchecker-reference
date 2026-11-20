// Stage 1, @issue-28 (T3), Task 1, gate-1 addendum of 2026-10-30 (coverage gaps named by the review of task 1):
// Turn building, the Segments each Turn event carries and the maximum length after an interjection.
//
// Item (a), Segment snapshot per event: no frozen test looks at `event.turn.segments`. Source: the interface in
// src/turns/types.ts and turn-builder.test.ts ("turn-opened": the Turn before its first Segment; "segment-appended":
// the Turn with the Segment in it; "turn-ended": every Segment of the Turn, in order) and the helper `turnEvents` of
// src/testing/turns.ts, which spells out exactly that sequence; AC7 (a Segment once in a Turn never changes or moves)
// and docs/spec/erkennung-modellrollen.md 2 ("Ein gesendeter Block ändert sich nicht mehr") for the rule that a
// later push never changes what an earlier event carries. Which push() returns an event of a possible interjection
// stays the builder's business (frozen interface: "may be held back or appended at once"), so the cases compare the
// events of each Turn in order, not the grouping per push, and for an interjection only its Segments and its end.
//
// Item (b), max_length after an interjection: AC2 (a Segment that would make the Turn longer than 180 s, its end
// minus the Turn's start, ends it with `max_length`; exactly 180 s stays one Turn), AC4 (an overlapping run under
// 2 s followed by the first Speaker within 3 s is an interjection and does not end the ongoing Turn), AC7 and the
// gate-1 owner decision of 2026-10-29 (a Turn's end is known only with the Segment that proves it: the maximum
// length and the interjection are both proven by the first Speaker's next Segment). Membership as
// evals/src/harness/turns.py build_turns decides it (interjection first, then the same-Speaker rules for the
// resuming Segment).
//
// Interface: turn-builder.test.ts (frozen). Ids s-0001… per test; Turn ids are taken from the events.
import { describe, expect, it } from 'vitest';

import { createTurnBuilder } from './turn-builder.ts';
import {
  bySeamOrder,
  foldTurns,
  seg,
  sid,
  START_VALUES,
  summary,
  turnEvents,
  type FoldedTurn,
} from '../testing/turns.ts';
import type { Segment } from '@lfc/contracts';
import type { EndReason, TurnEvent } from './types.ts';

function run(segments: readonly Segment[]) {
  const builder = createTurnBuilder(START_VALUES);
  const perPush = segments.map((segment) => builder.push(segment));
  const atEnd = builder.end();
  const events = [...perPush.flat(), ...atEnd];
  return { perPush, atEnd, events, turns: bySeamOrder(foldTurns(events, segments)) };
}

/** The Turn whose Segments are exactly `segments` (ids separated by spaces). */
function turnWith(turns: readonly FoldedTurn[], segments: string): FoldedTurn {
  const found = turns.find((t) => t.segmentIds.join(' ') === segments);
  if (found === undefined) throw new Error(`no Turn with Segments ${segments}`);
  return found;
}

/** The events of one Turn, in the order the builder returned them. */
function eventsOf(events: readonly TurnEvent[], turnId: string): TurnEvent[] {
  return events.filter((e) => e.turn.id === turnId);
}

/** Kind and Segment ids of each event: what a Turn event says about the Segments at that point. */
function snapshots(events: readonly TurnEvent[]): { kind: string; segments: string }[] {
  return events.map((e) => ({
    kind: e.kind,
    segments: e.turn.segments.map((s) => s.id).join(' '),
  }));
}

/** Index of the push whose events end the Turn, or 'end' when end() does. */
function endedBy(
  perPush: readonly (readonly TurnEvent[])[],
  atEnd: readonly TurnEvent[],
  turn: FoldedTurn,
) {
  const ends = (events: readonly TurnEvent[]) =>
    events.some((e) => e.kind === 'turn-ended' && e.turn.id === turn.id);
  const index = perPush.findIndex(ends);
  if (index >= 0) return index;
  return ends(atEnd) ? 'end' : 'never';
}

function row(speaker: string, segments: string, endReason: EndReason, interjection = false) {
  return { speaker, segments, endReason, interjection };
}

const [S1, S2, S3, S4, S5, S6] = [sid(1), sid(2), sid(3), sid(4), sid(5), sid(6)];

describe('createTurnBuilder: every Turn event carries the Turn’s Segments at that point (item a, AC7) @ac-7', () => {
  it('gives turn-opened no Segment, each segment-appended the Segments up to and including the appended one, and turn-ended all of them', () => {
    const segments = [
      seg(S1, 'A', 0, 2, 2.5),
      seg(S2, 'A', 2.5, 4, 4.4),
      seg(S3, 'A', 4.5, 6, 6.5),
    ];
    const { events } = run(segments);
    const id = events[0]?.turn.id ?? 'no event';
    // AC6: the end of the Input ends the open Turn with stream_end at its last Segment's finalizedAt
    expect(events).toEqual(
      turnEvents(id, 'A', segments, { endReason: 'stream_end', endKnownAt: 6.5 }),
    );
  });

  it('gives each of two Turns of a Speaker change its own Segments, event by event', () => {
    const a = [seg(S1, 'A', 0, 2), seg(S2, 'A', 2.25, 5, 5.25)];
    const b = [seg(S3, 'B', 5.5, 6, 9), seg(S4, 'B', 6.25, 8, 9.5)];
    const { events, turns } = run([...a, ...b]);
    const turnA = turnWith(turns, `${S1} ${S2}`);
    const turnB = turnWith(turns, `${S3} ${S4}`);
    // AC3 and AC7: the Speaker change is known at the finalizedAt of B's first Segment
    expect(eventsOf(events, turnA.id)).toEqual(
      turnEvents(turnA.id, 'A', a, { endReason: 'speaker_change', endKnownAt: 9 }),
    );
    expect(eventsOf(events, turnB.id)).toEqual(
      turnEvents(turnB.id, 'B', b, { endReason: 'stream_end', endKnownAt: 9.5 }),
    );
  });

  it('gives a held-back run that turns out to be no interjection one snapshot per Segment when it opens the next Turn', () => {
    // AC5 and AC7 (frozen case): B overlaps A and reaches 2.5 s with its second Segment, final at 11
    const a = [seg(S1, 'A', 0, 10, 10)];
    const b = [
      seg(S2, 'B', 6, 7, 10.5),
      seg(S3, 'B', 7.25, 8.5, 11),
      seg(S4, 'B', 8.75, 9.5, 11.5),
    ];
    const { events, turns } = run([...a, ...b]);
    const turnA = turnWith(turns, S1);
    const turnB = turnWith(turns, `${S2} ${S3} ${S4}`);
    expect(eventsOf(events, turnA.id)).toEqual(
      turnEvents(turnA.id, 'A', a, { endReason: 'speaker_change', endKnownAt: 11 }),
    );
    expect(eventsOf(events, turnB.id)).toEqual(
      turnEvents(turnB.id, 'B', b, { endReason: 'stream_end', endKnownAt: 11.5 }),
    );
  });

  it('gives an interjection of several Segments and the Turn it interrupts their own snapshots', () => {
    // AC4 (frozen case "a run of several Segments of the other Speaker is one interjection"); AC7: the interjection
    // is known when A resumes, final at 15
    const segments = [
      seg(S1, 'A', 0, 10, 10),
      seg(S2, 'B', 6, 6.5, 10),
      seg(S3, 'B', 6.75, 7.5, 10),
      seg(S4, 'A', 10.2, 15),
    ];
    const { events, turns } = run(segments);
    const turnA = turnWith(turns, `${S1} ${S4}`);
    const turnB = turnWith(turns, `${S2} ${S3}`);
    expect(snapshots(eventsOf(events, turnB.id))).toEqual([
      { kind: 'turn-opened', segments: '' },
      { kind: 'segment-appended', segments: S2 },
      { kind: 'segment-appended', segments: `${S2} ${S3}` },
      { kind: 'turn-ended', segments: `${S2} ${S3}` },
    ]);
    expect(summary(turnB)).toEqual(row('B', `${S2} ${S3}`, 'interjection', true));
    expect(turnB.endKnownAt).toBe(15);
    const [first, , , resumed] = segments;
    if (first === undefined || resumed === undefined) throw new Error('no Segments');
    expect(eventsOf(events, turnA.id)).toEqual(
      turnEvents(turnA.id, 'A', [first, resumed], { endReason: 'stream_end', endKnownAt: 15 }),
    );
  });

  it('never changes the Segments an earlier event carries when later Segments arrive', () => {
    // an interjection, the resuming Speaker, an overlap that is no interjection, and a Turn that grows after it
    const segments = [
      seg(S1, 'A', 0, 10, 10),
      seg(S2, 'B', 6, 7.5, 10),
      seg(S3, 'A', 10.2, 15),
      seg(S4, 'B', 14, 15, 15.5),
      seg(S5, 'B', 15.25, 16.5),
      seg(S6, 'B', 16.75, 18, 18.25),
    ];
    const builder = createTurnBuilder(START_VALUES);
    const returned: TurnEvent[] = [];
    const seenThen: string[] = [];
    const keep = (events: readonly TurnEvent[]) => {
      for (const event of events) {
        returned.push(event);
        seenThen.push(event.turn.segments.map((s) => s.id).join(' '));
      }
    };
    for (const segment of segments) keep(builder.push(segment));
    keep(builder.end());
    expect(returned.map((e) => e.turn.segments.map((s) => s.id).join(' '))).toEqual(seenThen);
    expect(bySeamOrder(foldTurns(returned, segments)).map(summary)).toEqual([
      row('A', `${S1} ${S3}`, 'speaker_change'),
      row('B', S2, 'interjection', true),
      row('B', `${S4} ${S5} ${S6}`, 'stream_end'),
    ]);
  });
});

describe('createTurnBuilder: the maximum length counts after an interjection (item b, AC2 with AC4) @ac-2 @ac-4', () => {
  it('ends the interrupted Turn with max_length when the first Speaker’s next Segment would make it longer than 180 s', () => {
    // A 0-90 and 91-178, B interjects 177-178 (overlap, 1 s), A resumes 178.5-181 (0.5 s after A's end): B is an
    // interjection; A's resuming Segment would make A's Turn 181 s long, so A's Turn ends and the Segment opens the
    // next Turn of A (evals/src/harness/turns.py build_turns decides the same membership)
    const result = run([
      seg(S1, 'A', 0, 90, 90),
      seg(S2, 'A', 91, 178, 178),
      seg(S3, 'B', 177, 178, 178),
      seg(S4, 'A', 178.5, 181, 181),
    ]);
    expect(result.turns.map(summary)).toEqual([
      row('A', `${S1} ${S2}`, 'max_length'),
      row('B', S3, 'interjection', true),
      row('A', S4, 'stream_end'),
    ]);
    // both ends are proven by A's Segment final at 181 (AC7, owner decision 2026-10-29); the harness's earlier
    // times (180 for the length, 178 for the interjection) are not knowable before that Segment
    const longTurn = turnWith(result.turns, `${S1} ${S2}`);
    const interjection = turnWith(result.turns, S3);
    expect(longTurn.endKnownAt).toBe(181);
    expect(interjection.endKnownAt).toBe(181);
    expect(endedBy(result.perPush, result.atEnd, longTurn)).toBe(3);
    expect(endedBy(result.perPush, result.atEnd, interjection)).toBe(3);
  });

  it('keeps the interrupted Turn as one Turn when the first Speaker’s next Segment makes it exactly 180 s long', () => {
    const result = run([
      seg(S1, 'A', 0, 90, 90),
      seg(S2, 'A', 91, 178, 178),
      seg(S3, 'B', 177, 178, 178),
      seg(S4, 'A', 178.5, 180, 180.5),
    ]);
    expect(result.turns.map(summary)).toEqual([
      row('A', `${S1} ${S2} ${S4}`, 'stream_end'),
      row('B', S3, 'interjection', true),
    ]);
    const interjection = turnWith(result.turns, S3);
    expect(interjection.endKnownAt).toBe(180.5);
    expect(endedBy(result.perPush, result.atEnd, interjection)).toBe(3);
  });
});
