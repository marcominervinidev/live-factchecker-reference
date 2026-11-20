// The tag list of a Session (docs/spec/erkennung-modellrollen.md 6; docs/spec/topic-vorrecherche.md 1 and 2): Topics
// with status and parent, seeded from the Setting (#32 AC1), merged with a validated result of the Topic Extractor
// (AC7, AC8) and diffed to decide whether a Topic event is due (AC9). Pure functions, no I/O.
// Reference: evals/src/harness/pipeline.py process_topics (`new`, then `returned`, then `ended`; `returned` and
// `ended` only for tags in the list). Deviation (ticket, Assumptions): the harness starts empty, this list starts
// with the Setting's Topic as its current Topic.

export type TopicStatus = 'active' | 'ended';

export interface TopicTag {
  readonly tag: string;
  readonly status: TopicStatus;
  readonly parent: string | null;
}

export interface NewTopicTag {
  readonly tag: string;
  readonly parent: string | null;
}

/** The output schema of spec 6 (harness schemas.py TOPIC). */
export interface TopicOutput {
  readonly current: readonly string[];
  readonly new: readonly NewTopicTag[];
  readonly returned: readonly string[];
  readonly ended: readonly string[];
}

export interface TagList {
  /** In order of first appearance. */
  readonly tags: readonly TopicTag[];
  readonly current: readonly string[];
}

export interface AppliedOutput {
  readonly tagList: TagList;
  /** Only what changed the list: a tag added, a status changed. */
  readonly applied: {
    readonly new: readonly NewTopicTag[];
    readonly returned: readonly string[];
    readonly ended: readonly string[];
  };
  /** Entries of `returned` and `ended` naming a tag not in the list (AC8). */
  readonly unknown: number;
  /** A tag added, a status changed or the current Topics changed as a set (AC9). */
  readonly changed: boolean;
}

export function seedTagList(topic: string | undefined): TagList {
  if (topic === undefined) return { tags: [], current: [] };
  return { tags: [{ tag: topic, status: 'active', parent: null }], current: [topic] };
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((tag) => right.has(tag));
}

export function applyTopicOutput(list: TagList, output: TopicOutput): AppliedOutput {
  const tags = new Map<string, TopicTag>(list.tags.map((t) => [t.tag, t]));
  const added: NewTopicTag[] = [];
  for (const entry of output.new) {
    if (tags.has(entry.tag)) continue;
    tags.set(entry.tag, { tag: entry.tag, status: 'active', parent: entry.parent });
    added.push({ tag: entry.tag, parent: entry.parent });
  }
  let unknown = 0;
  const setStatus = (names: readonly string[], status: TopicStatus): string[] => {
    const changed: string[] = [];
    for (const name of names) {
      const tag = tags.get(name);
      if (tag === undefined) unknown += 1;
      else if (tag.status !== status) {
        tags.set(name, { ...tag, status });
        changed.push(name);
      }
    }
    return changed;
  };
  const returned = setStatus(output.returned, 'active');
  const ended = setStatus(output.ended, 'ended');
  return {
    tagList: { tags: [...tags.values()], current: [...output.current] },
    applied: { new: added, returned, ended },
    unknown,
    changed:
      added.length > 0 ||
      returned.length > 0 ||
      ended.length > 0 ||
      !sameSet(list.current, output.current),
  };
}
