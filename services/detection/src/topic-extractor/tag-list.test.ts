// Stage 1, issue #32 (T6), Task 1: the tag list of a Session (docs/spec/erkennung-modellrollen.md 6: "Topics und
// Unter-Topics der Conversation mit Status, beginnend mit dem Anfangs-Topic aus dem Setting";
// docs/spec/topic-vorrecherche.md 1 and 2), its seed from the Setting (AC1), the merge of a validated result (AC7,
// AC8) and the decision whether a Topic event is due (AC9). Pure functions, no I/O.
// Reference semantics: evals/src/harness/pipeline.py process_topics (`setdefault` for `new`; `returned` and `ended`
// only for tags in the list). Deviation named by the ticket (Assumptions): the harness starts empty, here the list
// starts with the Setting's Topic.
//
// Public interface these tests define (proposal of the test designer for gate 1):
//   src/topic-extractor/tag-list.ts
//     export type TopicStatus = 'active' | 'ended'
//     export interface TopicTag { readonly tag: string; readonly status: TopicStatus; readonly parent: string | null }
//     export interface TopicOutput { readonly current: readonly string[];
//       readonly new: readonly { readonly tag: string; readonly parent: string | null }[];
//       readonly returned: readonly string[]; readonly ended: readonly string[] }        // the output schema of spec 6
//     export interface TagList { readonly tags: readonly TopicTag[]; readonly current: readonly string[] }
//     export function seedTagList(topic: string | undefined): TagList
//     export function applyTopicOutput(list: TagList, output: TopicOutput): {
//       readonly tagList: TagList;               // the list after the merge; tags in order of first appearance
//       readonly applied: { readonly new: readonly { tag: string; parent: string | null }[];
//                           readonly returned: readonly string[]; readonly ended: readonly string[] };
//       readonly unknown: number;                // entries of returned and ended naming a tag not in the list (AC8)
//       readonly changed: boolean;               // a tag added, a status changed or the current Topics changed (AC9)
//     }
// Settled by the test designer under P1 (round 2, 2026-11-17; critic of 2026-11-17, questions 6, 11, 17):
// - a seeded list has the Setting's Topic as its current Topics (none without a Topic), so a first result that only
//   confirms it is no Topic event (AC9: "A result that changes nothing emits no event");
// - `applied` lists only what changed a status: a `returned` tag already active and an `ended` tag already ended are
//   not listed; the current Topics compare as a set, so a reordered `current` is no change (topic-vorrecherche 2:
//   "`current`, `ended`: nichts");
// - a tag in `new` and in `returned` or `ended` of the same result is known, never unknown; the merge applies `new`,
//   then `returned`, then `ended` (harness pipeline.py process_topics).
import { describe, expect, it } from 'vitest';

import { applyTopicOutput, seedTagList, type TagList, type TopicOutput } from './tag-list.ts';

const TOPIC = 'Mieten Berlin';

function output(partial: Partial<TopicOutput>): TopicOutput {
  return { current: [], new: [], returned: [], ended: [], ...partial };
}

function list(tags: TagList['tags'], current: readonly string[] = []): TagList {
  return Object.freeze({ tags: Object.freeze(tags.map((t) => Object.freeze({ ...t }))), current });
}

const SEEDED_AND_TWO = list(
  [
    { tag: TOPIC, status: 'active', parent: null },
    { tag: 'Mietpreisbremse', status: 'active', parent: TOPIC },
    { tag: 'Neubau', status: 'ended', parent: TOPIC },
  ],
  [TOPIC, 'Mietpreisbremse'],
);

describe('seedTagList starts the tag list from the Setting (AC1)', () => {
  it('holds exactly the Topic of the Setting, active and without parent', () => {
    expect(seedTagList(TOPIC).tags).toEqual([{ tag: TOPIC, status: 'active', parent: null }]);
  });

  it('starts empty when the Setting names no Topic', () => {
    expect(seedTagList(undefined).tags).toEqual([]);
  });

  it('has the Topic of the Setting as its current Topics, and none without a Topic', () => {
    expect(seedTagList(TOPIC).current).toEqual([TOPIC]);
    expect(seedTagList(undefined).current).toEqual([]);
  });

  it('is no Topic event for a first result that only confirms the Topic of the Setting', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({ current: [TOPIC], new: [{ tag: TOPIC, parent: null }] }),
    );
    expect(result.changed).toBe(false);
  });
});

describe('a tag in new is added once (AC7)', () => {
  it('adds a tag not yet in the list as active with the given parent and reports it as new', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({
        current: [TOPIC, 'Mietpreisbremse'],
        new: [{ tag: 'Mietpreisbremse', parent: TOPIC }],
      }),
    );
    expect(result.tagList.tags).toEqual([
      { tag: TOPIC, status: 'active', parent: null },
      { tag: 'Mietpreisbremse', status: 'active', parent: TOPIC },
    ]);
    expect(result.applied.new).toEqual([{ tag: 'Mietpreisbremse', parent: TOPIC }]);
    expect(result.changed).toBe(true);
  });

  it('adds a new tag without parent as a Topic of its own', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({ current: ['Rente'], new: [{ tag: 'Rente', parent: null }] }),
    );
    expect(result.tagList.tags).toContainEqual({ tag: 'Rente', status: 'active', parent: null });
  });

  it('keeps the given parent even when the parent is not in the list', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({ new: [{ tag: 'Schengen', parent: 'Europa' }] }),
    );
    expect(result.tagList.tags).toContainEqual({
      tag: 'Schengen',
      status: 'active',
      parent: 'Europa',
    });
  });

  it('appends new tags after the existing ones, in the order of the result', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({
        new: [
          { tag: 'Neubau', parent: TOPIC },
          { tag: 'Mietpreisbremse', parent: TOPIC },
        ],
      }),
    );
    expect(result.tagList.tags.map((t) => t.tag)).toEqual([TOPIC, 'Neubau', 'Mietpreisbremse']);
  });

  it('changes nothing for a tag in new that is already in the list and does not report it as new', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({
        current: [TOPIC, 'Mietpreisbremse'],
        new: [{ tag: 'Mietpreisbremse', parent: TOPIC }],
      }),
    );
    expect(result.tagList.tags).toEqual(SEEDED_AND_TWO.tags);
    expect(result.applied.new).toEqual([]);
  });

  it('does not report the Topic of the Setting as new when the result opens it (it was seeded, AC1)', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({ current: [TOPIC], new: [{ tag: TOPIC, parent: null }] }),
    );
    expect(result.tagList.tags).toEqual([{ tag: TOPIC, status: 'active', parent: null }]);
    expect(result.applied.new).toEqual([]);
  });

  it('keeps the parent of an existing tag when new names it with another parent', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ new: [{ tag: 'Mietpreisbremse', parent: 'Neubau' }] }),
    );
    expect(result.tagList.tags).toEqual(SEEDED_AND_TWO.tags);
    expect(result.applied.new).toEqual([]);
  });

  it('keeps an ended tag ended when new names it again', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ new: [{ tag: 'Neubau', parent: TOPIC }] }),
    );
    expect(result.tagList.tags).toContainEqual({ tag: 'Neubau', status: 'ended', parent: TOPIC });
    expect(result.applied.new).toEqual([]);
  });

  it('adds a tag named twice in the same new list once and reports it once', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({
        new: [
          { tag: 'Neubau', parent: TOPIC },
          { tag: 'Neubau', parent: TOPIC },
        ],
      }),
    );
    expect(result.tagList.tags.filter((t) => t.tag === 'Neubau')).toHaveLength(1);
    expect(result.applied.new).toEqual([{ tag: 'Neubau', parent: TOPIC }]);
  });
});

describe('returned and ended change the status of tags in the list only (AC8)', () => {
  it('sets a returned tag of the list to active and reports it as returned', () => {
    const result = applyTopicOutput(SEEDED_AND_TWO, output({ returned: ['Neubau'] }));
    expect(result.tagList.tags).toContainEqual({ tag: 'Neubau', status: 'active', parent: TOPIC });
    expect(result.applied.returned).toEqual(['Neubau']);
    expect(result.unknown).toBe(0);
    expect(result.changed).toBe(true);
  });

  it('sets an ended tag of the list to ended and reports it as ended', () => {
    const result = applyTopicOutput(SEEDED_AND_TWO, output({ ended: ['Mietpreisbremse'] }));
    expect(result.tagList.tags).toContainEqual({
      tag: 'Mietpreisbremse',
      status: 'ended',
      parent: TOPIC,
    });
    expect(result.applied.ended).toEqual(['Mietpreisbremse']);
    expect(result.unknown).toBe(0);
    expect(result.changed).toBe(true);
  });

  it('counts a returned tag that is not in the list as unknown and changes nothing', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ current: [TOPIC, 'Mietpreisbremse'], returned: ['Euro'] }),
    );
    expect(result.tagList.tags).toEqual(SEEDED_AND_TWO.tags);
    expect(result.applied.returned).toEqual([]);
    expect(result.unknown).toBe(1);
  });

  it('counts an ended tag that is not in the list as unknown and changes nothing', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ current: [TOPIC, 'Mietpreisbremse'], ended: ['Euro'] }),
    );
    expect(result.tagList.tags).toEqual(SEEDED_AND_TWO.tags);
    expect(result.applied.ended).toEqual([]);
    expect(result.unknown).toBe(1);
  });

  it('counts every unknown tag of returned and ended, and applies the known ones of the same result', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ returned: ['Euro', 'Neubau'], ended: ['Schengen', 'Mietpreisbremse'] }),
    );
    expect(result.unknown).toBe(2);
    expect(result.applied.returned).toEqual(['Neubau']);
    expect(result.applied.ended).toEqual(['Mietpreisbremse']);
    expect(result.tagList.tags.map((t) => [t.tag, t.status])).toEqual([
      [TOPIC, 'active'],
      ['Mietpreisbremse', 'ended'],
      ['Neubau', 'active'],
    ]);
  });

  it('counts a returned tag that is already active as known, not as unknown, and changes no status', () => {
    const result = applyTopicOutput(SEEDED_AND_TWO, output({ returned: [TOPIC] }));
    expect(result.unknown).toBe(0);
    expect(result.tagList.tags).toEqual(SEEDED_AND_TWO.tags);
  });

  it('counts a tag that the same result adds in new as known, and applies new, then returned, then ended', () => {
    const result = applyTopicOutput(
      seedTagList(TOPIC),
      output({ new: [{ tag: 'Euro', parent: null }], ended: ['Euro'] }),
    );
    expect(result.unknown).toBe(0);
    expect(result.tagList.tags).toContainEqual({ tag: 'Euro', status: 'ended', parent: null });
  });
});

describe('a Topic event is due only when the result changes something (AC9)', () => {
  it('is due when only the current Topics change', () => {
    const result = applyTopicOutput(SEEDED_AND_TWO, output({ current: [TOPIC] }));
    expect(result.tagList.tags).toEqual(SEEDED_AND_TWO.tags);
    expect(result.tagList.current).toEqual([TOPIC]);
    expect(result.changed).toBe(true);
  });

  it('takes the current Topics of the result as the new current Topics', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ current: ['Mietpreisbremse', 'Neubau'], returned: ['Neubau'] }),
    );
    expect(result.tagList.current).toEqual(['Mietpreisbremse', 'Neubau']);
  });

  it('is not due for a result that repeats the list as it is', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({
        current: [TOPIC, 'Mietpreisbremse'],
        new: [{ tag: 'Mietpreisbremse', parent: TOPIC }],
        returned: ['Mietpreisbremse'],
        ended: ['Neubau'],
      }),
    );
    expect(result.tagList.tags).toEqual(SEEDED_AND_TWO.tags);
    expect(result.changed).toBe(false);
  });

  it('is not due for a result that only names unknown tags in returned and ended', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ current: [TOPIC, 'Mietpreisbremse'], returned: ['Euro'], ended: ['Schengen'] }),
    );
    expect(result.changed).toBe(false);
    expect(result.unknown).toBe(2);
  });

  it('is not due when the same result is applied a second time', () => {
    const result = output({
      current: [TOPIC, 'Rente'],
      new: [{ tag: 'Rente', parent: null }],
      ended: ['Mietpreisbremse'],
    });
    const first = applyTopicOutput(SEEDED_AND_TWO, result);
    const second = applyTopicOutput(first.tagList, result);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.tagList).toEqual(first.tagList);
    expect(second.applied.new).toEqual([]);
  });

  it('is not due when the current Topics only change their order', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ current: ['Mietpreisbremse', TOPIC] }),
    );
    expect(result.changed).toBe(false);
  });

  it('lists a returned tag that was already active and an ended tag that was already ended in no applied list', () => {
    const result = applyTopicOutput(
      SEEDED_AND_TWO,
      output({ current: [TOPIC], returned: ['Mietpreisbremse'], ended: ['Neubau'] }),
    );
    expect(result.changed).toBe(true);
    expect(result.applied).toEqual({ new: [], returned: [], ended: [] });
  });
});

describe('the merge is pure', () => {
  it('leaves the list it was given unchanged (frozen input)', () => {
    const before = JSON.stringify(SEEDED_AND_TWO);
    applyTopicOutput(
      SEEDED_AND_TWO,
      output({
        current: ['Euro'],
        new: [{ tag: 'Euro', parent: null }],
        returned: ['Neubau'],
        ended: [TOPIC],
      }),
    );
    expect(JSON.stringify(SEEDED_AND_TWO)).toBe(before);
  });
});
