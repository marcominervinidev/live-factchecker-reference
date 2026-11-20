# Stage 2a, issue #28 (T3), Task 3: a Session builds Turns and Ticks from a replayed recording, in-process at the
# segment seam (docs/spec/erkennung-modellrollen.md 2 and 8; docs/spec/inputs.md 4.2 rules 4 and 5, section 7).
# The recording fixture is the window of T2's parity test (packages/inputs/src/stt-recording.test.ts, frozen with #27):
# 45 s of a real Deepgram recording with two Speakers and six final blocks split at a Speaker change, among them the
# block finalized at 80.828 s that splits into B, A, B, A. It holds no pause of 3 s, no Turn of 180 s and no
# overlapping speech (every Speaker change starts where the speech before it ends), so pause, maximum length and
# interjection stay on stage 1 (ticket #28, Task 3).
# Expected Turns and Ticks follow the spec rules with the ticket's knowable times (a Turn's end is known at the
# finalizedAt of the Segment that proves it, or at the end of the Input); finalizedAt is compared to 0.001 s, the
# precision T2 pins it to. The Python harness gives the same Turns, end reasons and Ticks except the end of Turn 1
# (71.490 in its audio mode, which takes the pause bound before B is final; here 73.705, AC7).
# Extractors are fakes with a fixed latency on the Session clock. Steps: features/steps/turn-building.steps.ts (new).
@issue-28
Feature: A Session builds Turns and Ticks from the Segments of a replayed recording
  The detection service splits the finalized Segments of a Session into Turns per Speaker and decides when the
  Claim Extractor and the Topic Extractor run: every 5 s of speech and once more at the end of every Turn, skipping a
  Tick while the previous call of the same extractor for the same Turn has not returned.

  Background:
    Given the recording fixture "golden: synt-2026-10-06-a 01:10-01:55"
    And the Turn parameters of the configuration, none of them set

  @ac-3 @ac-6 @ac-7 @ac-8 @ac-9 @ac-10
  Scenario: The replay yields one Turn per stretch of a Speaker's speech, and a Tick per 5 s of speech plus the final analysis
    Given a fake Claim Extractor that returns after 0.5 seconds
    And a fake Topic Extractor that returns after 0.5 seconds
    When the recording fixture is replayed into a Session through the STT-recording Input
    Then the Session has these Turns:
      | Turn | Speaker | Segments                      | end reason     |
      | 1    | A       | s-0001                        | speaker_change |
      | 2    | B       | s-0002 s-0003                 | speaker_change |
      | 3    | A       | s-0004                        | speaker_change |
      | 4    | B       | s-0005                        | speaker_change |
      | 5    | A       | s-0006 s-0007 s-0008 s-0009   | speaker_change |
      | 6    | B       | s-0010                        | speaker_change |
      | 7    | A       | s-0011 s-0012                 | speaker_change |
      | 8    | B       | s-0013                        | speaker_change |
      | 9    | A       | s-0014                        | speaker_change |
      | 10   | B       | s-0015 s-0016 s-0017 s-0018   | speaker_change |
      | 11   | A       | s-0019 s-0020                 | speaker_change |
      | 12   | B       | s-0021                        | speaker_change |
      | 13   | A       | s-0022 s-0023                 | speaker_change |
      | 14   | B       | s-0024                        | stream_end     |
    And no Turn of the Session is marked as interjection
    And the Session has these Ticks:
      | Turn | at      | covers | final |
      | 1    | 73.705  | 1      | yes   |
      | 2    | 80.828  | 2      | no    |
      | 2    | 80.828  | 2      | yes   |
      | 3    | 80.828  | 1      | yes   |
      | 4    | 80.828  | 1      | yes   |
      | 5    | 87.710  | 3      | no    |
      | 5    | 90.734  | 4      | yes   |
      | 6    | 90.734  | 1      | yes   |
      | 7    | 94.458  | 2      | yes   |
      | 8    | 94.458  | 1      | yes   |
      | 9    | 94.458  | 1      | yes   |
      | 10   | 103.013 | 3      | no    |
      | 10   | 107.121 | 4      | no    |
      | 10   | 107.121 | 4      | yes   |
      | 11   | 110.172 | 2      | yes   |
      | 12   | 110.172 | 1      | yes   |
      | 13   | 114.053 | 2      | yes   |
      | 14   | 114.053 | 1      | yes   |
    And the Claim Extractor was called once for every Tick
    And the Topic Extractor was called once for every Tick
    And every Turn got exactly one final analysis from each extractor, and each extractor got every Segment of the Turn once

  @ac-11 @ac-12 @ac-13 @ac-15
  Scenario Outline: A <slow> slower than 5 s skips a Tick of Turn 10, and still every Turn gets its final analysis
    Given a fake <slow> that returns after 6 seconds
    And a fake <fast> that returns after 0.5 seconds
    When the recording fixture is replayed into a Session through the STT-recording Input
    Then the Session reports 1 skipped Tick for the <slow> and 0 for the <fast>
    And exactly one "tick.skipped" event names the Session, the <slow> and Turn 10
    And that event carries the Session id, the extractor and the Turn id and nothing else
    And no log line contains a word of the replayed Segments
    And the <slow>'s final analysis of Turn 10 started at 109.013 seconds with the Segments "s-0018"
    And the <slow>'s final analysis of Turn 2 started at 86.828 seconds with no Segment
    And every Turn got exactly one final analysis from each extractor, and each extractor got every Segment of the Turn once

    Examples: one slow extractor at a time
      | slow            | fast            |
      | Claim Extractor | Topic Extractor |
      | Topic Extractor | Claim Extractor |

  @ac-15
  Scenario: With fast extractors the Session reports no skipped Tick and writes no tick.skipped event
    Given a fake Claim Extractor that returns after 0.5 seconds
    And a fake Topic Extractor that returns after 0.5 seconds
    When the recording fixture is replayed into a Session through the STT-recording Input
    Then the Session reports 0 skipped Ticks for the Claim Extractor and 0 for the Topic Extractor
    And no log line is a "tick.skipped" event
