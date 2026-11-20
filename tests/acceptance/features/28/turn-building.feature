# Acceptance cases of issue #28 (T3), owner's view. Not a test stage; never runs in CI. `make acceptance ISSUE=28`
# runs them on lfc-28-acc with the API driver through the edge (step library tests/api/steps, #25).
# The ticket has no behaviour visible through the edge (Risk: "no outward-visible behaviour"; Contracts: Turn, Tick
# and the skip counters are internal types of the detection service, not a contract). The owner sees Turns, Ticks
# and skipped Ticks in the stage-2a run of services/detection/features/turn-building.feature (replay of
# golden: synt-2026-10-06-a 01:10-01:55) and at stage 1 (src/turns/*.test.ts). Through the edge the owner can see only
# that none of it leaves the stack: AC18 below is proposed by the test designer at gate 1 (owner question 2).
# AC18 is green on the base already (the edge's catch-all answers every unrouted path with its own 404, #25 AC9): it
# guards against a route added later and is no evidence for the Turn building of T3.
# Unlock 2026-11-05: the expectation names Turns, Ticks and counters, so the case asks for each. The service has no
# route for any of them (src/session/routes.ts: /sessions, /sessions/{id}, /sessions/{id}/segments); /turns, /ticks
# and /skipped-ticks are the names such a route would carry (skippedTicks of createSessionTurns).
@issue-28
Feature: Turns and Ticks of a Session stay inside the detection service

  @ac-18
  Scenario: The Turns of a Session cannot be read through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang des Testaufbaus per HTTPS die Redebeiträge einer Session abfrage
      (/detection/sessions/28a0c0de-0000-4000-8000-000000000001/turns), antwortet der Eingang selbst mit 404.
      Kein Dienst beantwortet die Anfrage; Redebeiträge, Takte und Zähler einer Session sind von außen nicht abrufbar.
      """
    When the client asks the edge for "/detection/sessions/28a0c0de-0000-4000-8000-000000000001/turns"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service
    When the client asks the edge for "/detection/sessions/28a0c0de-0000-4000-8000-000000000001/ticks"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service
    When the client asks the edge for "/detection/sessions/28a0c0de-0000-4000-8000-000000000001/skipped-ticks"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service
