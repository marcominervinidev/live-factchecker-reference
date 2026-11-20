// Building blocks the schemas share (.claude/rules/contracts.md). A change here changes every schema that uses
// it: scripts/check-contract-change.sh then asks for a schemaVersion bump of an existing schema.
import { z } from 'zod';

/** Audio time in seconds since the start of the Input (docs/spec/inputs.md 4.1); 0 to 86400 (one day). */
export const AudioSeconds = z.number().nonnegative().max(86_400);

/**
 * A strict object reports its unknown fields in one `unrecognized_keys` issue with an empty path; this check adds
 * one issue per unknown field whose path is that field, so a rejection names the field like every other rejection.
 * Zod's own issue stays. It runs even when another field already failed, so an unknown field is never hidden
 * behind a type error; `addIssue` marks its issues as continuable, so the rules across fields still run.
 */
export const unknownFieldsNamed = z.superRefine<unknown>(
  (_value, ctx) => {
    for (const issue of [...ctx.issues]) {
      if (issue.code !== 'unrecognized_keys' || (issue.path?.length ?? 0) > 0) continue;
      for (const key of issue.keys) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'unknown field' });
      }
    }
  },
  { when: () => true },
);

/** One word with its audio times (inputs 4.1); a word may end where it starts, never before. */
export const Word = z
  .strictObject({
    w: z.string().max(100),
    start: AudioSeconds,
    end: AudioSeconds,
  })
  .check(unknownFieldsNamed)
  .refine((word) => word.end >= word.start, {
    path: ['end'],
    message: 'a word ends before it starts',
  });
