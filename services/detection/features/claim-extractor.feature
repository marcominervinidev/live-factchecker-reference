# Stage 2a, issue #29 (T4), Task 3: the Claim Extractor in a Session of the detection service, in-process through the
# Session routes against the Redis of the test project, with the mock adapter of @lfc/providers (providers are mocked
# on stages 2a and 3, docs/process/test-strategy.md). AC9, AC10, AC11, AC14, AC15, AC16, AC19, AC20, AC21.
# AC20 and AC21 sit here and not on stage 3 as the ticket's Task 3 says (gate 1, owner 2026-11-03, question 4: "Stufe 2a statt 3, wie bei #27"): the stage-3 client
# sits on the network `clients` and reaches the edge only, the edge does not route the Session routes (#27 AC13), and
# Redis is on the network `data`; the same reason moved #27's AC5, AC8 and AC10 to 2a (.claude/frozen/27.json).
#
# Fixture: golden: synt-2026-10-06-a 01:10-01:55, the recording window of #27 and #28 (Turns and Ticks pinned in
# features/turn-building.feature). Speakers A and B are Kallac Haqy and Hukgl Suubayy (setting.json of the excerpt);
# the label -> name mapping goes in with the Session (gate 1, owner 2026-11-03, question 5: "Die Tests geben A → Kallac Haqy und
# B → Hukgl Suubayy bei der Session-Erzeugung mit"). The mock's expectations are the Golden Set labels of the window (labels.jsonl, start in
# [70, 115)): synt-2026-10-06-a-09 to -12. With the recording's words, exactly two of them are complete in the Turn
# blocks of their Speaker (computed with evals/src/harness/util.py norm_tokens on the harness's cut of the window):
#   -09 "Rob qutc baoj rob qutc baoj 2017 os Fiydulvuv." in Turn 2 (s-0002 s-0003), first sent by the Tick at 80.828
#   -12 "Vee padzob okiy kuqyz zedflöblf. Bikag xemn suoj." in Turn 10 (s-0017 s-0018), complete with s-0018 at 107.121
#       (its repeatOf -08 lies before the window, so it maps to no Claim id and the mock answers repeatOf null)
#   -10 and -11 differ from the recording's words ("Ibye Yucpepwi mocpo ... niej iir hew O-Heit", "funktioniert doch
#       nicht. Okay"), so the mock never answers them.
# Times: a call returns at its start plus the mock's latency (replay clock, ticket Assumptions); lastWordEnd is the end
# of "Bundestag." (74.060005) and of "rein," (103.31) in the recording; compared to 0.001 s like #28.
# The end of the Input: POST /sessions/{id}/end (gate 1, owner 2026-11-03, question 2: "Eigene interne Route `POST /sessions/{id}/end`, antwortet, sobald alle Aufrufe zurück sind").
# Steps: features/steps/claim-extractor.steps.ts (new) plus session.steps.ts (#27) and turn-building.steps.ts (#28).
@issue-29
Feature: The Claim Extractor turns the Segments of a Session into Claim events on its detection stream
  The detection service asks the model on every Tick of a Turn with the append-only prompt, checks the answer and
  writes every new Claim as one Claim event to the Session's internal detection stream in Redis, where it expires
  with the Session.

  Background:
    Given the recording fixture "golden: synt-2026-10-06-a 01:10-01:55"

  @ac-20 @ac-11 @ac-19
  Scenario: A replay of the recording yields exactly the expected Claim events, in order of acceptance
    Given the expectations of the mock are the Golden Set labels of "golden: synt-2026-10-06-a 01:10-01:55"
    And the mock Claim Extractor answers after 0.5 seconds
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Lmikyampadez hew AsQ: Eevqciyd iir Ueju, IU evr Xrternuc; Haqy hetxegk Hukgl Suubayy" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    Then the Input ended normally
    And the detection stream of the Session holds exactly these Claim events, in this order:
      | id   | speaker       | speakerLabel | turnId | segmentIds    | lastWordEnd | emittedAt |
      | c-01 | Hukgl Suubayy | B            | t-002  | s-0002 s-0003 | 74.060      | 81.328    |
      | c-02 | Hukgl Suubayy | B            | t-010  | s-0017 s-0018 | 103.310     | 107.621   |
    And every entry of the detection stream is a valid detection event of the Session, not earlier than the end of its last word

  @ac-21
  Scenario: The same replay with expectations that contain no Claim yields no Claim event, and the Session ends normally
    Given the expectations of the mock contain no Claim
    And the mock Claim Extractor answers after 0.5 seconds
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Programmatik der AfD" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    Then the Input ended normally
    And the detection stream of the Session holds 0 Claim events
    And the Claim Extractor was called 18 times for the Session, each call "valid"

  @ac-9 @ac-10
  Scenario: A call that fails twice is lost, and the next call of the Turn still finds the Claim in all Turn blocks
    # One Turn of Speaker B in two Segments of 13 words, 0.4 s each (the Segment builder of session.steps.ts): s-0001
    # spans 1.0 to 6.2 s, finalized at 6.7, and reaches 5 s of speech (a Tick at 6.7, call 1, its repeat call 2);
    # s-0002 spans 7.2 to 12.4 s, finalized at 12.9, and reaches 10 s (a Tick at 12.9, call 3). The verbatim lies in
    # s-0001 and ends with "gestiegen" at 1.0 + 11 x 0.4 = 5.4 s. Call 3 carries the lost Turn block 1 again, so the
    # mock finds the verbatim there and the Claim returns at 12.9 + 0.5.
    Given the expectations of the mock are these labels:
      | id   | speaker       | sentence                                                                     | verbatim                                                        | kind     | refersTo |
      | x-11 | Hukgl Suubayy | Hukgl Suubayy facuajkiz, noxl vee Mieten in Berlin seit 2015 um 40 Prozent gestiegen sind. | die Mieten in Berlin sind seit 2015 um vierzig Prozent gestiegen | tatsache |          |
    And the mock Claim Extractor answers after 0.5 seconds
    And the mock Claim Extractor answers no JSON on its calls "1,2"
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Mieten" and these Speakers:
      | label | name          | role  | public |
      | B     | Hukgl Suubayy | guest | yes    |
    When the client sends Segment "s-0001" by Speaker "B" containing "Die Mieten in Berlin sind seit 2015 um vierzig Prozent gestiegen sagt er" to the Session
    And the client sends Segment "s-0002" by Speaker "B" containing "Das hat die Statistik des Senats im letzten Herbst so sehr deutlich gezeigt" to the Session
    And the client ends the Input of the Session
    Then exactly one "claim_extractor.call" event of the Session for Turn "t-001" has the outcome "schema_failure" after 2 attempts
    And the detection stream of the Session holds exactly these Claim events, in this order:
      | id   | speaker       | speakerLabel | turnId | segmentIds | lastWordEnd | emittedAt |
      | c-01 | Hukgl Suubayy | B            | t-001  | s-0001     | 5.400       | 13.400    |

  @ac-15
  Scenario: No log line carries content, and the Claims live only in Redis keys of the Session
    Given the expectations of the mock are the Golden Set labels of "golden: synt-2026-10-06-a 01:10-01:55"
    And the mock Claim Extractor answers after 0.5 seconds
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Programmatik der AfD" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    Then no log line contains a word of the replayed Segments
    And no log line contains a Speaker name or the Topic of the Setting
    And no log line carries the Speaker label "B"
    And no Redis key outside the Session holds the sentence of a Claim event of the Session

  @ac-14 @ac-15
  Scenario: A Candidate is kept as a Candidate record in the Session state, and nowhere else
    Given the expectations of the mock are these labels:
      | id   | speaker       | sentence                                         | verbatim            | kind        | refersTo |
      | x-01 | Hukgl Suubayy | Hukgl Suubayy werlvuoyoh, noxl vee Zahl stimmt. | das stimmt so nicht | widerspruch | x-00     |
    And the mock Claim Extractor answers after 0.5 seconds
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Mieten" and these Speakers:
      | label | name          | role      | public |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the client sends Segment "s-0001" by Speaker "B" containing "Das stimmt so nicht, die Zahl war viel niedriger." to the Session
    And the client ends the Input of the Session
    Then the detection stream of the Session holds 0 Claim events
    And exactly one "candidate.created" event names the Session with Candidate "k-01" and reason "bezug_unklar"
    And a Redis key of the Session holds "das stimmt so nicht"
    And no Redis key outside the Session holds "das stimmt so nicht"
    And no log line contains a word of the Segment

  # 3 s, not 6: the reused step 'the lifetime of the Session has run out' (session.steps.ts, #27) sleeps the whole
  # lifetime and then waits up to 3 s, under cucumber's default step timeout of 5 s; session.feature uses it with 2
  # and 3 s (finding of the task 3 implementer, 2026-11-06).
  @ac-16
  Scenario: The detection stream expires with the Session, 15 minutes after its last Segment (here a lifetime of 3 s)
    Given the expectations of the mock are the Golden Set labels of "golden: synt-2026-10-06-a 01:10-01:55"
    And the mock Claim Extractor answers after 0.5 seconds
    And the Session lifetime is 3 seconds
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session in mode "broadcast" with the Topic "Programmatik der AfD" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    # No exact remaining TTL here (critic W10: the replay and the end take wall time); the expiry itself proves AC16.
    Then the detection stream of the Session holds 2 Claim events
    And the remaining lifetime of the Session is at most 3 seconds
    When the lifetime of the Session has run out
    Then no Redis key of the Session remains

  @ac-16
  Scenario: A Session's Claim events never appear in another Session's stream
    Given the expectations of the mock are the Golden Set labels of "golden: synt-2026-10-06-a 01:10-01:55"
    And the mock Claim Extractor answers after 0.5 seconds
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And an earlier Session exists
    And the client creates a Session in mode "broadcast" with the Topic "Programmatik der AfD" and these Speakers:
      | label | name          | role      | public |
      | A     | Kallac Haqy   | moderator | yes    |
      | B     | Hukgl Suubayy | guest     | yes    |
    When the recording fixture is replayed into the Session through its routes
    And the client ends the Input of the Session
    Then the detection stream of the Session holds 2 Claim events
    And the detection stream of the earlier Session holds 0 Claim events

  @ac-21
  Scenario: Ending the Input of a Session id nobody created is refused and starts no call
    Given the expectations of the mock contain no Claim
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    When the client ends the Input of a Session id nobody created
    Then the service rejects the Session as "Session unknown"
    And no log line is a "claim_extractor.call" event

  @ac-21
  Scenario: Ending the Input twice answers again and starts no second final analysis
    Given the expectations of the mock contain no Claim
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session in mode "conversation" with the Topic "Mieten" and these Speakers:
      | label | name          | role  | public |
      | B     | Hukgl Suubayy | guest | no     |
    And the client sends Segment "s-0001" by Speaker "B" containing "Das stimmt so nicht." to the Session
    And the client ends the Input of the Session
    When the client ends the Input of the Session
    Then the Input ended normally
    And the Claim Extractor was called 1 times for the Session, each call "valid"

  @ac-21
  Scenario: A Session created without a Setting (the body-less creation of #27) still runs the Claim Extractor
    # gate 1, owner 2026-11-03, question 6: "Modus „Gespräch“ ohne Sprecher und ohne Topic; ein 2a-Szenario pinnt, dass sie läuft". Its prompt is not observable
    # here; this pins only that the Session runs, and that no name can come up without a Setting.
    Given the expectations of the mock are these labels:
      | id   | speaker       | sentence                                        | verbatim             | kind     | refersTo |
      | x-21 | Hukgl Suubayy | Hukgl Suubayy facuajkiz, noxl ay pi kuqyz gar. | das stimmt so nicht  | tatsache |          |
    And the mock Claim Extractor answers after 0.5 seconds
    And the detection service runs with the Redis of the test project and the mock Claim Extractor
    And the client creates a Session
    And the client sends Segment "s-0001" by Speaker "B" containing "Das stimmt so nicht." to the Session
    When the client ends the Input of the Session
    Then the Input ended normally
    And the Claim Extractor was called 1 times for the Session, each call "valid"
    And the detection stream of the Session holds 0 Claim events
