// Valid examples of every contract, for contract tests and consumers' tests; production code never imports them.
// Frozen to the last word, so a test that changes a fixture fails at once instead of breaking the next test; build
// a variant with a spread copy. The type stays the contract's type.
import type { ClaimEvent } from '../claim-event.ts';
import type { DetectionEvent } from '../detection-event.ts';
import type { Segment } from '../segment.ts';
import type { TopicEvent } from '../topic-event.ts';

function frozen(segment: Segment): Segment {
  for (const word of segment.words) Object.freeze(word);
  Object.freeze(segment.words);
  return Object.freeze(segment);
}

function frozenClaim(claim: ClaimEvent): ClaimEvent {
  Object.freeze(claim.segmentIds);
  return Object.freeze(claim);
}

/** The example of docs/spec/inputs.md 4.1, with start and end taken from its words. */
export const segmentFixture: Segment = frozen({
  schemaVersion: 1,
  id: 's-0412',
  sessionId: '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10',
  speaker: 'A',
  start: 0.12,
  end: 0.71,
  finalizedAt: 14.01,
  language: 'de',
  words: [
    { w: 'die', start: 0.12, end: 0.25 },
    { w: 'Mieten', start: 0.25, end: 0.71 },
  ],
});

/** The example Claim of docs/spec/erkennung-modellrollen.md 4.1, with the fields AC11 of #29 adds. */
export const claimEventFixture: ClaimEvent = frozenClaim({
  schemaVersion: 1,
  id: 'c-01',
  turnId: 't-002',
  source: 'claim_extractor',
  speaker: 'Anna Müller',
  speakerLabel: 'A',
  sentence:
    'Anna Müller behauptet, dass die Mieten in Berlin seit 2015 um 40 Prozent gestiegen sind.',
  verbatim: 'also die Mieten hier in Berlin, die sind seit 2015 um vierzig Prozent hoch',
  segmentIds: ['s-0412', 's-0413'],
  type: 'zahl',
  checkworthiness: 'hoch',
  kind: 'tatsache',
  refersTo: null,
  start: 12.5,
  end: 17.25,
  lastWordEnd: 17.25,
  emittedAt: 19.75,
});

/** The fixture Claim in its envelope on the detection stream of the Session of segmentFixture. */
export const detectionEventFixture: DetectionEvent = Object.freeze({
  schemaVersion: 2,
  type: 'claim',
  sessionId: '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10',
  claim: claimEventFixture,
});

function frozenTopic(topic: TopicEvent): TopicEvent {
  for (const entry of topic.new) Object.freeze(entry);
  for (const list of [topic.current, topic.new, topic.returned, topic.ended]) Object.freeze(list);
  return Object.freeze(topic);
}

/** A Topic event that opens a sub-topic of the Setting's Topic (docs/spec/erkennung-modellrollen.md 6). */
export const topicEventFixture: TopicEvent = frozenTopic({
  schemaVersion: 1,
  tickAt: 73.705,
  current: ['Mieten Berlin', 'Mietpreisbremse'],
  new: [{ tag: 'Mietpreisbremse', parent: 'Mieten Berlin' }],
  returned: [],
  ended: [],
});

/** The fixture Topic event in its envelope on the detection stream of the Session of segmentFixture. */
export const topicDetectionEventFixture: DetectionEvent = Object.freeze({
  schemaVersion: 2,
  type: 'topic',
  sessionId: '5b0e8c3a-27d1-4c55-9f43-2b1c0e7a9d10',
  topic: topicEventFixture,
});
