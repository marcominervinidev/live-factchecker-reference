# Stage 2a, issue #32 (T6), Task 1: the Topic Extractor in a Session of the detection service, in-process through the
# Session routes of #27 and #29 against the Redis of the test project, with the mock adapters of @lfc/providers
# (providers are mocked on stages 2a and 3, docs/process/test-strategy.md). AC1, AC2, AC3, AC5, AC7, AC9, AC10, AC11.
# Stage 2a, not 3, for the reason #29 gives (gate 1 of #29, question 4: "Stufe 2a statt 3, wie bei #27"): the edge does
# not route the Session routes and the detection stream is internal (ADR 0005, addendum 2026-10-25).
#
# Fixture: golden: synt-2026-10-06-a 01:10-01:55, the recording window of #27 to #29. Its 14 Turns and 18 Ticks are
# pinned in features/turn-building.feature (#28): the first Tick is the final analysis of Turn 1 at 73.705 s, and an
# extractor of 6 s skips exactly one Tick, of Turn 10. In the first scenario the Claim Extractor's mock gets the Golden
# Set labels of the window, so the stream holds the two Claim events of #29 (claim-extractor.feature) and Topic events
# side by side, both in the envelope of schemaVersion 2 (critic of 2026-11-17, A5); in the others it gets none.
# The Topic Extractor's mock follows the harness mock (packages/providers/src/mock/mock-topic-extractor.test.ts): at
# rate 1 every call opens "Unterthema <number of tags>" under the first current Topic. The tag list starts with the
# Setting's Topic (AC1), so the first call opens "Unterthema 1" under it, and the Setting's Topic is never reported as
# new (AC7). Calls of different Turns at the same Tick time run side by side, so only the first Topic event is pinned
# exactly; for the others the scenarios check what holds in any order (each tag new at most once, every entry valid).
# Steps: features/steps/topic-extractor.steps.ts (new) plus claim-extractor.steps.ts (#29), session.steps.ts (#27)
# and turn-building.steps.ts (#28).
@issue-32
Feature: The Topic Extractor keeps the tag list of a Session and reports its changes as Topic events
  The detection service asks the model for the Topics on every Tick of a Turn, in a call of its own next to the Claim
  Extractor, starting from the Topic of the Setting. Every result that changes the tag list or the current Topics
  becomes one Topic event on the Session's internal detection stream.

  Background:
    Given the recording fixture "golden: synt-2026-10-06-a 01:10-01:55"
    And the mock Claim Extractor answers after 0.5 seconds

  @ac-1 @ac-2 @ac-7 @ac-9
  Scenario: A replay yields a Topic event per change, starting from the Topic of the Setting, next to the Claim events
    Given the expectations of the mock are the Golden Set labels of "golden: synt-2026-10-06-a 01:10-01:55"
    And the mock Topic Extractor answers after 0.5 seconds and opens a sub-topic with the rate 1
    And the detection service runs with the Redis of the test project, the mock Claim Extractor and the mock Topic Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Programmatik der AfD" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    Then the Input ended normally
    And the Topic Extractor was called 18 times for the Session, each call "valid"
    And the Claim Extractor was called 18 times for the Session, each call "valid"
    And the first Topic event of the Session reports "Unterthema 1" as new under "Programmatik der AfD", at the Tick time 73.705
    And no Topic event of the Session reports "Programmatik der AfD" as new
    And no tag is reported as new in more than one Topic event of the Session
    And the detection stream of the Session holds 2 Claim events and at least one Topic event
    And every entry of the detection stream is a valid detection event of the Session

  @ac-3 @ac-5
  Scenario: A Topic Extractor slower than 5 s skips a Tick of Turn 10 and never holds up the Claim Extractor
    Given the expectations of the mock contain no Claim
    And the mock Topic Extractor answers after 6 seconds and opens a sub-topic with the rate 0
    And the detection service runs with the Redis of the test project, the mock Claim Extractor and the mock Topic Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Programmatik der AfD" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    Then the Input ended normally
    And exactly 1 "tick.skipped" event of the Session names the Topic Extractor, for Turn "t-010"
    And exactly 0 "tick.skipped" events of the Session name the Claim Extractor
    And the Topic Extractor was called 17 times for the Session, each call "valid"
    And the Claim Extractor was called 18 times for the Session, each call "valid"

  @ac-10
  Scenario: A call that fails twice is lost: no Topic event for it, and the next call carries on
    # One Turn of Speaker B in two Segments of 13 words (the Segment builder of session.steps.ts, as in #29's
    # claim-extractor.feature): Ticks at 6.7 (calls 1 and 2 of the Topic Extractor's mock, both no JSON: lost) and at
    # 12.9 (call 3), then the final analysis at the end of the Input (call 4). Calls 3 and 4 open Unterthema 1 and 2.
    Given the expectations of the mock contain no Claim
    And the mock Topic Extractor answers after 0.5 seconds and opens a sub-topic with the rate 1
    And the mock Topic Extractor answers no JSON on its calls "1,2"
    And the detection service runs with the Redis of the test project, the mock Claim Extractor and the mock Topic Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Mieten" and these Speakers:
      | label | name          | role  | public |
      | B     | Hukgl Suubayy | guest | yes    |
    When the client sends Segment "s-0001" by Speaker "B" containing "Die Mieten in Berlin sind seit 2015 um vierzig Prozent gestiegen sagt er" to the Session
    And the client sends Segment "s-0002" by Speaker "B" containing "Das hat die Statistik des Senats im letzten Herbst so sehr deutlich gezeigt" to the Session
    And the client ends the Input of the Session
    Then the Input ended normally
    And exactly one "topic_extractor.call" event of the Session for Turn "t-001" has the outcome "schema_failure" after 2 attempts
    And the detection stream of the Session holds 2 Topic events
    And the first Topic event of the Session reports "Unterthema 1" as new under "Mieten", at the Tick time 12.9

  @ac-11
  Scenario: No log line carries transcript text, a tag or the Setting, and every call is logged with its figures
    Given the expectations of the mock contain no Claim
    And the mock Topic Extractor answers after 0.5 seconds and opens a sub-topic with the rate 1
    And the detection service runs with the Redis of the test project, the mock Claim Extractor and the mock Topic Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Programmatik der AfD" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    Then the Input ended normally
    And no log line contains a word of the replayed Segments
    And no log line contains a Speaker name or the Topic of the Setting
    And no log line contains a tag of a Topic event of the Session
    And every "topic_extractor.call" event of the Session carries the Session id, the role, the Turn id, final, the outcome, the duration, the tokens and the cost
    And no Redis key outside the Session holds "Programmatik der AfD"
    And no Redis key outside the Session holds "Unterthema 1"
