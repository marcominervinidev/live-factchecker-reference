// What a Session is created with (ticket #29, Assumptions "Setting" and "Text-mode label mapping"): the optional body
// of POST /sessions, { setting?: { mode, speakers?: [{ name, role, public }], topic? }, speakerNames?: { <label>:
// <name> } }. The Setting follows docs/spec/topic-vorrecherche.md 1 and docs/spec/sprecher.md 1 as an internal type
// (no contract in packages/contracts yet); the label -> name mapping is what a reference-transcript Input delivers.
// Both stay in process memory with the Session's Claim Extractor and are never logged. Without a body the Session
// runs in mode „Gespräch“ without Speakers and Topic (gate 1 of #29, question 6: „Modus „Gespräch“ ohne Sprecher und
// ohne Topic“). Bounds: a name as the Claim event's `speaker` (200), a Topic as its `sentence` (1000), at most
// MAX_SPEAKERS Speakers and labels, so a Setting cannot grow every prompt of the Session without limit.
import { Segment } from '@lfc/contracts';
import { z } from 'zod';

import type { Setting } from '../claim-extractor/prompt.ts';
import { namedFields } from './segment-input.ts';

export interface SessionStart {
  readonly setting: Setting;
  readonly speakerNames: Readonly<Record<string, string>>;
}

const MAX_SPEAKERS = 20;
const Name = z.string().min(1).max(200);

const Body = z.strictObject({
  setting: z
    .strictObject({
      mode: z.enum(['broadcast', 'conversation']),
      speakers: z
        .array(
          z.strictObject({
            name: Name,
            role: z.enum(['moderator', 'host', 'guest', 'private']),
            public: z.boolean(),
          }),
        )
        .max(MAX_SPEAKERS)
        .optional(),
      topic: z.string().min(1).max(1000).optional(),
    })
    .optional(),
  speakerNames: z
    .record(Segment.shape.speaker, Name)
    .refine((names) => Object.keys(names).length <= MAX_SPEAKERS)
    .optional(),
});

const WITHOUT_SETTING: SessionStart = { setting: { mode: 'conversation' }, speakerNames: {} };

export type StartInput =
  | { readonly ok: true; readonly start: SessionStart }
  | { readonly ok: false; readonly fields: readonly string[] };

/** An empty body is the body-less creation of #27; a rejection names fields only, never a value. */
export function parseSessionStart(text: string): StartInput {
  if (text.trim() === '') return { ok: true, start: WITHOUT_SETTING };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, fields: [] };
  }
  const parsed = Body.safeParse(value);
  if (!parsed.success) {
    return { ok: false, fields: namedFields(parsed.error.issues.map((issue) => issue.path)) };
  }
  const { setting, speakerNames = {} } = parsed.data;
  if (setting === undefined) return { ok: true, start: { ...WITHOUT_SETTING, speakerNames } };
  const { mode, speakers, topic } = setting;
  return {
    ok: true,
    start: {
      setting: {
        mode,
        ...(speakers === undefined ? {} : { speakers }),
        ...(topic === undefined ? {} : { topic }),
      },
      speakerNames,
    },
  };
}
