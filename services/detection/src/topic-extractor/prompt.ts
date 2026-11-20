// The request of the Topic Extractor (docs/spec/erkennung-modellrollen.md 6; #32 AC6) and its output schema. Port of
// evals/src/harness/pipeline.py call_topic_extractor (blocks prefix, context, window, new; text mode) and
// schemas.py TOPIC; breakpoints as prompt.py assign_breakpoints sets them for these kinds (after the prefix and the
// tag list, so the cacheable prefix ends after the tag list). Pure, no I/O.
import type { Segment } from '@lfc/contracts';
import type { ContentBlock } from '@lfc/providers';
import { z } from 'zod';

import { fmt, pythonJson } from '../claim-extractor/prompt.ts';
import { segmentText } from '../claim-extractor/output-schema.ts';
import type { TagList } from './tag-list.ts';

/** schemas.py TOPIC, the schema sent to the model, unchanged. */
export const topicJsonSchema = {
  type: 'object',
  properties: {
    current: { type: 'array', items: { type: 'string' } },
    new: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tag: { type: 'string' },
          parent: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: ['tag', 'parent'],
        additionalProperties: false,
      },
    },
    returned: { type: 'array', items: { type: 'string' } },
    ended: { type: 'array', items: { type: 'string' } },
  },
  required: ['current', 'new', 'returned', 'ended'],
  additionalProperties: false,
} as const;

/**
 * TOPIC as validated: a tag the Topic event cannot carry (empty, or more than 200 code points, gate 1 of #32, O3)
 * violates the schema and is repeated like any other violation (AC10).
 */
const Tag = z.string().min(1).max(200);

export const TopicExtractorOutput = z.strictObject({
  current: z.array(Tag),
  new: z.array(z.strictObject({ tag: Tag, parent: Tag.nullable() })),
  returned: z.array(Tag),
  ended: z.array(Tag),
});

const STATUS = { active: 'aktiv', ended: 'beendet' } as const;

/** Block 1: the instruction trimmed, then the output schema (prompt.py prefix_block without a Setting). */
export function topicPrefixBlock(instruction: string): ContentBlock {
  const text = `${instruction.trim()}\n\n## Ausgabeschema (JSON)\n${pythonJson(topicJsonSchema)}`;
  return { kind: 'prefix', text, cache: true, system: true };
}

function tagListText(tagList: TagList, topic: string | undefined): string {
  const lines = tagList.tags.map(
    (t) => `- ${t.tag} (${STATUS[t.status]}${t.parent === null ? '' : `, unter ${t.parent}`})`,
  );
  const body =
    lines.length > 0 ? lines.join('\n') : `(leer; Anfangs-Topic aus dem Setting: ${topic ?? ''})`;
  return `Tag-Liste:\n${body}`;
}

/** render_segments(segments, False, False, True): each Segment with its Speaker as delivered at the seam. */
function segmentLines(
  segments: readonly Segment[],
  names: Readonly<Record<string, string>>,
): string {
  return segments
    .map((s) => {
      const speaker = Object.hasOwn(names, s.speaker) ? names[s.speaker] : s.speaker;
      return `[${fmt(s.start)}–${fmt(s.end)}] ${speaker ?? s.speaker}: ${segmentText(s)}`;
    })
    .join('\n');
}

function block(kind: string, text: string, cache = false): ContentBlock {
  return { kind, text, cache, system: false };
}

/** The blocks of one call: instruction with schema, tag list, window, new since the last analysis (AC6). */
export function topicBlocks(options: {
  readonly prefix: ContentBlock;
  readonly tagList: TagList;
  readonly topic: string | undefined;
  readonly windowSeconds: number;
  readonly window: readonly Segment[];
  readonly fresh: readonly Segment[];
  readonly names: Readonly<Record<string, string>>;
}): ContentBlock[] {
  const { window, fresh, names } = options;
  return [
    options.prefix,
    block('context', tagListText(options.tagList, options.topic), true),
    block(
      'window',
      `Fenster (letzte ${String(options.windowSeconds)} s):\n${
        window.length > 0 ? segmentLines(window, names) : '(kein Fenster)'
      }`,
    ),
    block(
      'new',
      `Neu seit der letzten Analyse:\n${
        fresh.length > 0 ? segmentLines(fresh, names) : '(nichts Neues)'
      }`,
    ),
  ];
}
