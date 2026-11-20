// Stage 1, issue #32 (T6), Task 1: properties of the tag list merge (ticket, Task 1, Verify: "fast-check properties,
// e.g. merge is idempotent for a repeated result and never removes a tag"), AC7 to AC9. Interface: header of
// tag-list.test.ts. Generators draw tags from a small pool so that new, returned and ended often name tags of the list.
// `returned` and `ended` are drawn disjoint from each other and from the tags of `new`, so that each property holds
// whatever order the merge applies them in (that order is not part of the criteria).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { applyTopicOutput, type TagList, type TopicOutput, type TopicTag } from './tag-list.ts';

const POOL = [
  'Mieten Berlin',
  'Mietpreisbremse',
  'Neubau',
  'Euro',
  'Schengen',
  'Rente',
  'Klima',
  'Bürgergeld',
];

const tagName = fc.constantFrom(...POOL);

const tagList: fc.Arbitrary<TagList> = fc
  .uniqueArray(tagName, { maxLength: POOL.length })
  .chain((names) =>
    fc.tuple(
      fc.tuple(
        ...names.map((name) =>
          fc.record({
            tag: fc.constant(name),
            status: fc.constantFrom<TopicTag['status']>('active', 'ended'),
            parent: fc.option(
              tagName.filter((p) => p !== name),
              { nil: null },
            ),
          }),
        ),
      ),
      fc.subarray(names),
    ),
  )
  .map(([tags, current]) => ({ tags: tags as TopicTag[], current }));

const topicOutput: fc.Arbitrary<TopicOutput> = fc
  .tuple(
    fc.array(fc.record({ tag: tagName, parent: fc.option(tagName, { nil: null }) }), {
      maxLength: 4,
    }),
    fc.uniqueArray(tagName, { maxLength: 6 }),
    fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    fc.array(tagName, { maxLength: 3 }),
  )
  .map(([fresh, statusTags, split, current]) => {
    const newTags = new Set(fresh.map((n) => n.tag));
    const rest = statusTags.filter((t) => !newTags.has(t));
    return {
      current,
      new: fresh,
      returned: rest.filter((_, i) => split[i] === true),
      ended: rest.filter((_, i) => split[i] !== true),
    };
  });

const names = (list: TagList) => new Set(list.tags.map((t) => t.tag));

describe('the tag list merge, for any list and any validated result (AC7, AC8, AC9)', () => {
  it('never removes a tag and never changes the parent of a tag already in the list', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const after = applyTopicOutput(list, result).tagList;
        for (const before of list.tags) {
          expect(after.tags.find((t) => t.tag === before.tag)?.parent).toBe(before.parent);
        }
      }),
    );
  });

  it('is idempotent: the same result applied again changes nothing and is no Topic event', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const once = applyTopicOutput(list, result);
        const twice = applyTopicOutput(once.tagList, result);
        expect(twice.tagList).toEqual(once.tagList);
        expect(twice.changed).toBe(false);
        expect(twice.applied.new).toEqual([]);
      }),
    );
  });

  it('adds exactly the tags of new that were not in the list, each once, and nothing else', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const before = names(list);
        const after = applyTopicOutput(list, result).tagList;
        const expected = new Set([...before, ...result.new.map((n) => n.tag)]);
        expect(names(after)).toEqual(expected);
        expect(after.tags).toHaveLength(expected.size);
      }),
    );
  });

  it('reports as new exactly the first entry of each tag of new that was not in the list, active with its parent', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const before = names(list);
        const firsts = result.new.filter(
          (n, i) => !before.has(n.tag) && result.new.findIndex((m) => m.tag === n.tag) === i,
        );
        const merged = applyTopicOutput(list, result);
        expect(merged.applied.new).toEqual(firsts.map((n) => ({ tag: n.tag, parent: n.parent })));
        for (const n of firsts) {
          expect(merged.tagList.tags).toContainEqual({
            tag: n.tag,
            status: 'active',
            parent: n.parent,
          });
        }
      }),
    );
  });

  it('sets returned tags of the list active and ended tags of the list ended, and leaves every other status', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const after = applyTopicOutput(list, result).tagList;
        for (const tag of list.tags) {
          const status = after.tags.find((t) => t.tag === tag.tag)?.status;
          if (result.returned.includes(tag.tag)) expect(status).toBe('active');
          else if (result.ended.includes(tag.tag)) expect(status).toBe('ended');
          else expect(status).toBe(tag.status);
        }
      }),
    );
  });

  it('counts as unknown exactly the entries of returned and ended that name no tag of the list', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const before = names(list);
        const expected = [...result.returned, ...result.ended].filter((t) => !before.has(t)).length;
        expect(applyTopicOutput(list, result).unknown).toBe(expected);
      }),
    );
  });

  it('reports as returned and ended only tags of the list, never an unknown one', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const before = names(list);
        const { applied } = applyTopicOutput(list, result);
        for (const tag of [...applied.returned, ...applied.ended])
          expect(before.has(tag)).toBe(true);
      }),
    );
  });

  it('is a Topic event whenever it adds a tag or changes a status', () => {
    fc.assert(
      fc.property(tagList, topicOutput, (list, result) => {
        const merged = applyTopicOutput(list, result);
        if (JSON.stringify(merged.tagList.tags) !== JSON.stringify(list.tags)) {
          expect(merged.changed).toBe(true);
        }
      }),
    );
  });
});
