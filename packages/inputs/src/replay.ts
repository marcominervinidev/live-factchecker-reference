// The simulated clock both replay Inputs share (docs/spec/inputs.md 1 and 5: replay "so schnell die Pipeline sie
// nimmt"; ticket #27, AC18). The clock is the finalizedAt of the Segment the consumer just took: the next Segment
// is handed out only when the consumer asks for it, and nothing waits on a timer or the wall clock.
// Order rule (owner decision 2026-11-05, review W1 variant (a): "Im Textmodus gilt die id-Reihenfolge, die Parität
// mit dem Harness bleibt"): the replay hands out Segments in id order. For the STT-recording Input that is finalizedAt
// order; for the reference transcript it is the harness's (start, end) order, so finalizedAt (= end) is not monotone
// there where Turns overlap. The clock a consumer derives from finalizedAt is monotone only in audio mode.
import type { Segment } from '@lfc/contracts';

/**
 * Replays Segments in the order given, which is id order, one per pull. For the STT-recording Input id order is
 * `finalizedAt` order; for the reference transcript it is the harness's `(start, end)` order, so `finalizedAt` is not
 * monotone where Turns overlap (owner decision 2026-11-05, W1 (a)). Every iteration starts at the first Segment
 * again; after `return()` an iteration hands out nothing more.
 */
export function replay(segments: readonly Segment[]): AsyncIterable<Segment> {
  return {
    [Symbol.asyncIterator]: () => pull(segments),
  };
}

function pull(segments: readonly Segment[]): AsyncIterator<Segment, undefined> {
  let next = 0;
  return {
    next: () => {
      const segment = segments[next];
      if (segment === undefined) return Promise.resolve({ done: true, value: undefined });
      next += 1;
      return Promise.resolve({ done: false, value: segment });
    },
    return: () => {
      next = segments.length;
      return Promise.resolve({ done: true, value: undefined });
    },
  };
}
