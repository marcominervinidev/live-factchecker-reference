# Acceptance cases of issue #25 (T1, walking skeleton), owner's view. Not a test stage; never runs in CI.
# `make acceptance ISSUE=25` runs them on lfc-25-acc with the API driver (the stage-3 step library
# tests/api/steps plus tests/acceptance/steps); the expectation is the owner's, verbatim, written before the code.
@issue-25
Feature: Walking skeleton: the detection service answers through the edge

  @ac-8
  Scenario: The detection service reports "running" through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang des Testaufbaus per HTTPS /detection/health abfrage, antwortet der Erkennungsdienst mit 200.
      Die Verbindung ist verschlüsselt und wird gegen die eigene Zertifizierungsstelle des Testaufbaus geprüft, nicht ungeprüft durchgewinkt.
      """
    When the client asks the edge for "/detection/health"
    Then the edge answers with status 200

  @ac-8 @ac-6
  Scenario: The detection service reports "ready" through the edge and names Redis ok
    Given the owner expects:
      """
      Wenn ich über den Eingang per HTTPS /detection/ready abfrage, antwortet der Erkennungsdienst mit 200,
      und die Antwort nennt seine Abhängigkeit redis mit „ok“.
      """
    When the client asks the edge for "/detection/ready"
    Then the edge answers with status 200
    And the edge body names the dependency "redis" as "ok"

  @ac-9
  Scenario: A path the edge does not know answers 404
    Given the owner expects:
      """
      Wenn ich über den Eingang einen Pfad abfrage, für den es keine Route gibt (/admin), antwortet der Eingang mit 404.
      """
    When the client asks the edge for "/admin"
    Then the edge answers with status 404
