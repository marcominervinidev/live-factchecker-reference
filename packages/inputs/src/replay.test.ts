// Stage 1, issue #27 (T2), Task 2: both replay Inputs on the simulated clock (docs/spec/inputs.md 1 and 5: "so
// schnell die Pipeline sie nimmt"), AC18. Through the public interface of the two Inputs (see
// reference-transcript.test.ts and stt-recording.test.ts); src/replay.ts is their shared clock and not addressed here.
//
// What "simulated clock" means here (ticket #27, Task 2 shape): the clock is the finalizedAt of the Segment just
// taken; the consumer pulls; nothing waits on a timer. Under fake timers a replay that waited on setTimeout,
// setInterval or setImmediate would never finish, so finishing under fake timers is the proof of "no wall clock".
// "Well under a second" is checked as under 1000 ms of real time for the 45 s window (the ticket names no sharper
// bound).
//
// Fixtures: golden: synt-2026-10-06-a 01:10-01:55 (recording and transcript), the window of the parity tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { referenceTranscriptInput } from './reference-transcript.ts';
import { sttRecordingInput } from './stt-recording.ts';
import { goldenWindow } from './testing/golden.ts';
// After the modules under test on purpose: their absence is the red reason (tools/classify_red_reason.py).
import { Segment } from '@lfc/contracts';

const SESSION = '27a0c0de-0000-4000-8000-000000000018';
const WINDOW = 'golden: synt-2026-10-06-a 01:10-01:55';

const inputs = [
  {
    name: 'the STT-recording Input',
    open: async () =>
      (
        await sttRecordingInput({
          recording: goldenWindow('recording', WINDOW),
          sessionId: SESSION,
          language: 'de',
        })
      ).segments,
  },
  {
    name: 'the reference-transcript Input',
    open: async () =>
      (
        await referenceTranscriptInput({
          transcript: JSON.parse(goldenWindow('transcript', WINDOW)),
          sessionId: SESSION,
          language: 'de',
        })
      ).segments,
  },
] as const;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'Date',
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(inputs)('$name on the simulated clock (AC18)', ({ open }) => {
  it('replays the 45 s window in under a second of real time without any timer advancing', async () => {
    const segments = await open();
    const started = process.hrtime.bigint();
    const taken: Segment[] = [];
    for await (const segment of segments) taken.push(segment);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(taken.length).toBeGreaterThan(20);
    expect(elapsedMs).toBeLessThan(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('emits Segments in order of finalizedAt with ascending ids, each satisfying the segment contract', async () => {
    const taken: Segment[] = [];
    for await (const segment of await open()) taken.push(segment);
    taken.forEach((segment, i) => {
      expect(Segment.safeParse(segment).success).toBe(true);
      if (i === 0) return;
      const before = taken[i - 1];
      expect(segment.finalizedAt).toBeGreaterThanOrEqual(before?.finalizedAt ?? 0);
      expect(Number(segment.id.slice(2))).toBeGreaterThan(Number(before?.id.slice(2)));
    });
  });

  it('hands out one Segment per pull and the next only when the consumer asks for it', async () => {
    const iterator = (await open())[Symbol.asyncIterator]();
    const first = await iterator.next();
    const second = await iterator.next();
    expect(first.done).toBe(false);
    expect(second.done).toBe(false);
    if (first.done === true || second.done === true) return;
    expect(first.value.id).toBe('s-0001');
    expect(second.value.id).toBe('s-0002');
    expect(second.value.finalizedAt).toBeGreaterThanOrEqual(first.value.finalizedAt);
  });

  it('stops when the consumer stops: after return() no further Segment comes', async () => {
    const iterator = (await open())[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect((await iterator.next()).done).toBe(true);
  });

  it('replays the same Segments every time it is opened (deterministic)', async () => {
    const once: Segment[] = [];
    for await (const segment of await open()) once.push(segment);
    const again: Segment[] = [];
    for await (const segment of await open()) again.push(segment);
    expect(again).toEqual(once);
  });
});
