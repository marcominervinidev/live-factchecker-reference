# Acceptance cases of issue #27 (T2), owner's view. Not a test stage; never runs in CI. `make acceptance ISSUE=27`
# runs them on lfc-27-acc with the API driver through the edge. The Session routes are internal (AC13), so through
# the edge the owner can see only that they stay closed; the replay, the rejection of a wrong Segment and the
# deletion after 15 minutes are shown by the stage-1 and stage-2a runs (packages/inputs, services/detection/features).
@issue-27
Feature: Conversation data stays inside the stack

  @ac-13
  Scenario: The Sessions of the detection service cannot be listed through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang des Testaufbaus per HTTPS /detection/sessions abfrage, antwortet der Eingang selbst mit 404.
      Kein Dienst beantwortet die Anfrage; von außen sieht niemand, welche Gespräche gerade gespeichert sind.
      """
    When the client asks the edge for "/detection/sessions"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service

  @ac-13
  Scenario: The state of a Session cannot be read through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang per HTTPS den Zustand einer Session abfrage (/detection/sessions/27a0c0de-0000-4000-8000-000000000013),
      antwortet der Eingang selbst mit 404, und die Antwort enthält keine Textstücke und keine Sprecher.
      """
    When the client asks the edge for "/detection/sessions/27a0c0de-0000-4000-8000-000000000013"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service
