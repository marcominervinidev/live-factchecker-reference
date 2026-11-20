// The Claim event (ADR 0005, addendum 2026-10-25: Claim and Topic events per Session on an internal Redis stream,
// schema in packages/contracts; fields as decided on #29, decision 1, Marco 2026-10-27; rules of gate 1, question 8,
// 2026-11-03): one accepted Claim on a Session's detection stream. Times in seconds of Session audio time,
// `emittedAt` on the Input's clock. The Session is named by the envelope (detection-event.ts), never here.
// Upper bounds of the free-text fields (owner Marco, 2026-11-05, review W4, "genauso wie empfohlen"): `speaker` at
// most 200, `sentence` and `verbatim` at most 1000 characters; the 316 labels of Golden Set version 1 reach 41, 232
// and 332. The generated JSON Schema carries the field rules; the cross-field rules below live only here.
import { z } from 'zod';

import { AudioSeconds, unknownFieldsNamed } from './common.ts';
import { Segment } from './segment.ts';

/** `c-` and at least two digits, the running number per Conversation (spec 4.1, AC11: `c-01`, `c-02`). */
const ClaimId = z.string().regex(/^c-[0-9]{2,15}$/);

export const ClaimEvent = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: ClaimId,
    /** `t-` and at least three digits, the Turn ids of #28. */
    turnId: z.string().regex(/^t-[0-9]{3,15}$/),
    source: z.enum(['claim_extractor', 'resolver']),
    /** The Speaker's name as the Claim gives it (spec 4.1). */
    speaker: z.string().min(1).max(200),
    /** The Session label of the Turn, as in the segment contract; never a name. */
    speakerLabel: Segment.shape.speaker,
    sentence: z.string().min(1).max(1000),
    verbatim: z.string().min(1).max(1000),
    /** The Segments holding `verbatim`, ids as in the segment contract; never empty (AC8). */
    segmentIds: z.array(Segment.shape.id).min(1),
    type: z.enum(['zahl', 'ereignis', 'zitat', 'ursache']),
    checkworthiness: z.enum(['hoch', 'niedrig']),
    kind: z.enum(['tatsache', 'widerspruch', 'zustimmung', 'meinung_mit_kern']),
    /** The id of the Claim this one answers; set for `widerspruch` and `zustimmung` (spec 4.1). */
    refersTo: ClaimId.nullable(),
    /** Start of the first and end of the last of its Segments. */
    start: AudioSeconds,
    end: AudioSeconds,
    /** End of the last word of `verbatim`. */
    lastWordEnd: AudioSeconds,
    /** Session clock time at which the call returned. */
    emittedAt: AudioSeconds,
  })
  .check(unknownFieldsNamed)
  .refine((claim) => claim.end >= claim.start, {
    path: ['end'],
    message: 'end is earlier than start',
  })
  .refine((claim) => claim.lastWordEnd >= claim.start && claim.lastWordEnd <= claim.end, {
    path: ['lastWordEnd'],
    message: 'lastWordEnd lies outside start to end',
  })
  .refine((claim) => claim.emittedAt >= claim.lastWordEnd, {
    path: ['emittedAt'],
    message: 'emittedAt is earlier than lastWordEnd',
  })
  .refine(
    (claim) =>
      !(claim.kind === 'widerspruch' || claim.kind === 'zustimmung') || claim.refersTo !== null,
    { path: ['refersTo'], message: 'refersTo is missing for widerspruch or zustimmung' },
  );

export type ClaimEvent = z.infer<typeof ClaimEvent>;
