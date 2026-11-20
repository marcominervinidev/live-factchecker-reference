# Stage 2a, issue #27 (T2), Task 3: Sessions of the detection service in the no-disk Redis (ADR 0009,
# docs/spec/datenschutz.md 2), in-process against the Redis of the test project (`make test-integration`).
# Steps: features/steps/session.steps.ts (new) plus the start step of features/steps/detection.steps.ts (#25).
# AC5, AC8 and AC10 sit here and not on stage 3: the stage-3 client reaches the edge only (compose.yml network
# `clients`), and the Session routes are not routed by the edge (AC13); 2a is also the lowest stage that shows them.
# Status codes are not pinned (the ticket names none): accepted means 2xx, rejected means 4xx; the one exception is
# the Session limits, whose status 409 and texts "no room for another Session" and "Session full" come from the routes
# table of the service README (services/detection/README.md).
# Session limits (AC19; owner decision 2026-10-29, issue #27 comment, docs/spec/datenschutz.md "Nachtrag 2026-10-29"):
# SESSION_BYTE_BUDGET (JSON bytes, UTF-8, of the Segments of one Session) and MAX_SESSIONS (live Sessions, counted by
# the index `sessions:live`, which holds Session ids only). All scenarios share
# one Redis, and Sessions of 15 minutes from earlier scenarios count against MAX_SESSIONS; so the limit scenarios run
# their own service against an empty database of that Redis (one no key lives in yet), with their own limits.
@issue-27
Feature: Sessions hold their Segments in Redis for 15 minutes after the last Segment
  The detection service accepts final Segments that satisfy the segment contract into a Session, keeps them in
  the Redis without disk and lets every key of the Session expire 15 minutes after its last Segment.

  @ac-5
  Scenario: Creating a Session returns a new id with zero Segments and 15 minutes to live
    Given the detection service runs with the Redis of the test project
    And an earlier Session exists
    When the client creates a Session
    Then the Session gets an id no earlier Session had
    And the state of the Session shows 0 Segments
    And the remaining lifetime of the Session is 900 seconds

  @ac-6
  Scenario: An accepted Segment renews the lifetime of every key of the Session
    Given the detection service runs with the Redis of the test project and a Session lifetime of 6 seconds
    And the client creates a Session
    And 2 seconds have passed
    When the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    Then the service accepts the Segment
    And the state of the Session shows 1 Segments
    And the state of the Session shows last Segment "s-0001"
    And the remaining lifetime of the Session is 6 seconds
    And every Redis key of the Session expires in 6 seconds

  @ac-9
  Scenario: An accepted Segment is stored in a Redis key of the Session
    Given the detection service runs with the Redis of the test project
    And the client creates a Session
    When the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    Then the service accepts the Segment
    And a Redis key of the Session holds "Mieten"

  @ac-7
  Scenario: When the lifetime after the last Segment has run out, the Session and all its keys are gone
    Given the detection service runs with the Redis of the test project and a Session lifetime of 3 seconds
    And the client creates a Session
    And the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    When the lifetime of the Session has run out
    Then the state of the Session is "Session unknown"
    And no Redis key of the Session remains

  @ac-8 @ac-12
  Scenario Outline: A Segment with <defect> is rejected naming "<field>"; nothing is stored, the lifetime is not renewed
    Given the detection service runs with the Redis of the test project and a Session lifetime of 6 seconds
    And the client creates a Session
    And 2 seconds have passed
    When the client sends Segment "s-0001" by Speaker "A" containing "Mietpreisbremse wirkt kaum." with <defect> to the Session
    Then the service rejects the Segment naming "<field>"
    And the state of the Session shows 0 Segments
    And the remaining lifetime of the Session is at most 4 seconds
    And no Redis key of the Session holds "Mietpreisbremse"
    And no log line contains a word of the Segment

    Examples: an unknown field (overlap is derived, never sent)
      | defect          | field   |
      | an overlap field | overlap |

    Examples: a field of the wrong type
      | defect                | field   |
      | speaker as a number 1 | speaker |

    Examples: a cross-field rule
      | defect                         | field       |
      | finalizedAt 0.001 s before end | finalizedAt |

    Examples: a name as speaker
      | defect                  | field   |
      | speaker "Kallac Haqy"   | speaker |

  @ac-9
  Scenario Outline: After Segment <last>, the service accepts Segment <next>
    Given the detection service runs with the Redis of the test project
    And the client creates a Session
    And the client sends Segment "<last>" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    When the client sends Segment "<next>" by Speaker "B" containing "Das stimmt so nicht." to the Session
    Then the service accepts the Segment
    And the state of the Session shows <count> Segments
    And the state of the Session shows last Segment "<next>"

    Examples: ids after the last one
      | last   | next   | count |
      | s-0010 | s-0011 | 2     |
      | s-0010 | s-0012 | 2     |

    Examples: boundary, a fifth digit (ids compare as numbers, the harness form s-0001 grows past s-9999)
      | last   | next    | count |
      | s-9999 | s-10000 | 2     |

  @ac-9
  Scenario Outline: After Segment <last>, the service rejects Segment <next>, stores nothing and does not renew the lifetime
    Given the detection service runs with the Redis of the test project and a Session lifetime of 6 seconds
    And the client creates a Session
    And the client sends Segment "<last>" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    And 2 seconds have passed
    When the client sends Segment "<next>" by Speaker "B" containing "Das stimmt so nicht." to the Session
    Then the service rejects the Segment
    And the state of the Session shows <count> Segments
    And the state of the Session shows last Segment "<last>"
    And no Redis key of the Session holds "stimmt"
    And the remaining lifetime of the Session is at most 4 seconds

    Examples: a duplicate
      | last   | next   | count |
      | s-0010 | s-0010 | 1     |

    Examples: out of order
      | last   | next   | count |
      | s-0010 | s-0009 | 1     |

  @ac-9
  Scenario: A Segment of another Session is rejected and nothing is stored
    Given the detection service runs with the Redis of the test project
    And the client creates a Session
    When the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." with the sessionId of another Session to the Session
    Then the service rejects the Segment naming "sessionId"
    And the state of the Session shows 0 Segments
    And no Redis key of the Session holds "Mieten"

  @ac-10
  Scenario: A Segment for a Session that never existed is rejected as "Session unknown" and creates none
    Given the detection service runs with the Redis of the test project
    When the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to a Session id nobody created
    Then the service rejects the Segment as "Session unknown"
    And the state of the Session is "Session unknown"
    And no Redis key of the Session remains

  @ac-10
  Scenario: A Segment for an expired Session is rejected as "Session unknown" and does not revive it
    Given the detection service runs with the Redis of the test project and a Session lifetime of 2 seconds
    And the client creates a Session
    And the lifetime of the Session has run out
    When the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    Then the service rejects the Segment as "Session unknown"
    And the state of the Session is "Session unknown"
    And no Redis key of the Session remains

  @ac-11
  Scenario: The Redis that holds Sessions keeps nothing on disk
    # The Redis ACL denies CONFIG and INFO by design (compose.yml), so the service's view cannot show it; the
    # check reads the Compose definition the test project runs from (open question 2 of the test designer).
    Given the Compose definition of the stack
    Then the Redis service runs with "--appendonly no" and "--save ''"
    And its data directory "/data" is on tmpfs and it mounts no volume

  @ac-12
  Scenario: Accepting a Segment logs one event with the Session id and the Segment id and no word or Speaker label
    Given the detection service runs with the Redis of the test project
    And the client creates a Session
    When the client sends Segment "s-0001" by Speaker "B" containing "Mietpreisbremse wirkt kaum." to the Session
    Then the service accepts the Segment
    And exactly one "segment.accepted" event names the Session and Segment "s-0001"
    And no log line contains a word of the Segment
    And no log line carries the Speaker label "B"

  @ac-12
  Scenario: A rejected Segment logs no "segment.accepted" event and no word or Speaker label
    Given the detection service runs with the Redis of the test project
    And the client creates a Session
    And the client sends Segment "s-0010" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    When the client sends Segment "s-0009" by Speaker "B" containing "Das stimmt so nicht." to the Session
    Then the service rejects the Segment
    And exactly one "segment.accepted" event names the Session and Segment "s-0010"
    And no log line contains a word of the Segment
    And no log line carries the Speaker label "B"

  @ac-19
  Scenario: While 3 Sessions live and at most 3 may, another Session is refused with "no room for another Session"
    Given the detection service runs with an empty database of the Redis of the test project, a Session lifetime of 900 seconds, a byte budget of 3000 bytes and at most 3 Sessions
    And the client creates a Session
    And the client creates a Session
    And the client creates a Session
    When the client asks for another Session
    Then the service answers with status 409
    And the service rejects the Session as "no room for another Session"
    And no Redis key of the Session remains
    And the index of live Sessions is a sorted set of the ids of the 3 Sessions the client created and nothing else

  @ac-19
  Scenario: Sessions that have expired no longer count; while 1 of 3 still lives, there is room for a new Session
    Given the detection service runs with an empty database of the Redis of the test project, a Session lifetime of 3 seconds, a byte budget of 3000 bytes and at most 3 Sessions
    And the client creates a Session
    And the client creates a Session
    And 2 seconds have passed
    And the client creates a Session
    And 2 seconds have passed
    When the client creates a Session
    Then the state of the Session shows 0 Segments
    And the remaining lifetime of the Session is 3 seconds

  @ac-19
  Scenario: A Segment that takes the Segments of the Session to exactly the byte budget is accepted
    Given the detection service runs with an empty database of the Redis of the test project, a Session lifetime of 900 seconds, a byte budget of 3000 bytes and at most 3 Sessions
    And the client creates a Session
    And the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    When the client sends Segment "s-0002" by Speaker "B" containing "Das stimmt so nicht." padded to take the Segments of the Session to 3000 bytes
    Then the service accepts the Segment
    And the state of the Session shows 2 Segments
    And the state of the Session shows last Segment "s-0002"
    And a Redis key of the Session holds "stimmt"

  @ac-19
  Scenario: A Segment that would take the Session 1 byte past its byte budget is refused as "Session full"; nothing is stored, the lifetime is not renewed
    Given the detection service runs with an empty database of the Redis of the test project, a Session lifetime of 6 seconds, a byte budget of 3000 bytes and at most 3 Sessions
    And the client creates a Session
    And the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    And 2 seconds have passed
    When the client sends Segment "s-0002" by Speaker "B" containing "Das stimmt so nicht." padded to take the Segments of the Session to 3001 bytes
    Then the service answers with status 409
    And the service rejects the Segment as "Session full"
    And the state of the Session shows 1 Segments
    And the state of the Session shows last Segment "s-0001"
    And the remaining lifetime of the Session is at most 4 seconds
    And no Redis key of the Session holds "stimmt"
    And exactly one "segment.accepted" event names the Session and Segment "s-0001"
    And no log line contains a word of the Segment

  @ac-19
  Scenario: The index of live Sessions holds Session ids only and expires with the latest Session
    Given the detection service runs with an empty database of the Redis of the test project, a Session lifetime of 6 seconds, a byte budget of 3000 bytes and at most 3 Sessions
    And the client creates a Session
    And the client creates a Session
    And 2 seconds have passed
    When the client sends Segment "s-0001" by Speaker "A" containing "Die Mieten sind gestiegen." to the Session
    Then the index of live Sessions is a sorted set of the ids of the 2 Sessions the client created and nothing else
    And the index of live Sessions expires in 6 seconds
