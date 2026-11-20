// The Topic event (ADR 0005, addendum 2026-10-25: Claim and Topic events per Session on an internal Redis stream,
// schema in packages/contracts; fields as decided on #32, decision 1, Marco 2026-10-27, "alles ja"; bounds of gate 1
// of #32, O3, 2026-11-18; ADR 0005, addendum 2026-11-18): one validated result of the Topic Extractor that changed
// the tag list or the current Topics. `new`, `returned` and `ended` list only what the result changed ("as applied").
// The Session is named by the envelope (detection-event.ts), never here.
import { z } from 'zod';

import { AudioSeconds, unknownFieldsNamed } from './common.ts';

/** A tag of 1 to 200 characters, counted in Unicode code points as Zod counts a string's length (O3). */
const Tag = z.string().min(1).max(200);

const NewTag = z
  .strictObject({
    tag: Tag,
    /** The parent Topic, or null for a Topic of its own. */
    parent: Tag.nullable(),
  })
  .check(unknownFieldsNamed);

export const TopicEvent = z
  .strictObject({
    schemaVersion: z.literal(1),
    /** The time of the Tick: the start of the call in Session audio time, a deferred final analysis included. */
    tickAt: AudioSeconds,
    /** The current Topics as the result gives them. */
    current: z.array(Tag),
    new: z.array(NewTag),
    returned: z.array(Tag),
    ended: z.array(Tag),
  })
  .check(unknownFieldsNamed);

export type TopicEvent = z.infer<typeof TopicEvent>;
