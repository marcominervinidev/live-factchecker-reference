// The segment contract (docs/spec/inputs.md 4.1 and 4.2; ADR 0005, addenda of 2026-10-25, 2026-10-27 and
// 2026-10-29; format ADR 0012): one final Segment at the segment seam, one Speaker, word times in audio seconds.
// The generated JSON Schema (json-schema/segment.schema.json) carries the field rules; the cross-field rules
// below live only here.
import { z } from 'zod';

import { AudioSeconds, unknownFieldsNamed, Word } from './common.ts';

export const Segment = z
  .strictObject({
    schemaVersion: z.literal(1),
    /** Unique per Session, ascending in order of finalization. */
    id: z.string().regex(/^s-[0-9]{1,15}$/),
    sessionId: z.string().min(1).max(64),
    /** Session label of the diarisation, A, B, ... by first appearance; never a name. */
    speaker: z.string().regex(/^[A-Z]+$/),
    /** Start of the first word. */
    start: AudioSeconds,
    /** End of the last word. */
    end: AudioSeconds,
    /** Audio time at which the Segment became final; never before its end. */
    finalizedAt: AudioSeconds,
    language: z.string().min(1).max(35),
    /** Ordered by start (gate 1, 2026-10-29: variant (a)); overlapping words stay valid. */
    words: z.array(Word).min(1).max(500),
  })
  .check(unknownFieldsNamed)
  .refine((segment) => segment.start === segment.words[0]?.start, {
    path: ['start'],
    message: 'start is not the start of the first word',
  })
  .refine((segment) => segment.end === segment.words.at(-1)?.end, {
    path: ['end'],
    message: 'end is not the end of the last word',
  })
  .refine(
    (segment) =>
      segment.words.every((word, i) => word.start >= (segment.words[i - 1]?.start ?? word.start)),
    { path: ['words'], message: 'a word starts before the word in front of it' },
  )
  .refine((segment) => segment.finalizedAt >= segment.end, {
    path: ['finalizedAt'],
    message: 'finalizedAt is earlier than end',
  });

export type Segment = z.infer<typeof Segment>;
