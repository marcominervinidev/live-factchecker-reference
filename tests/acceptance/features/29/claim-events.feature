# Acceptance cases of issue #29 (T4), owner's view. Not a test stage; never runs in CI. `make acceptance ISSUE=29`
# runs them on lfc-29-acc with the API driver through the edge (step library tests/api/steps, #25), with the mock
# adapter and the prompt file of the CI stack (compose.yml, Task 3).
# The Claim events live on an internal stream in Redis (ADR 0005, addendum 2026-10-25) and the Session routes are not
# routed by the edge (#27, AC13). Through the edge the owner sees that the detection service starts with the prompt
# file and that no Claim, Candidate or stream of a Session can be read from outside; the replay that yields the
# expected Claim events (AC20, AC21) is shown by the stage-2a run of services/detection/features/claim-extractor.feature.
# The two @ac-15 cases are green on the base already (the edge's catch-all, #25 AC9): guards against a route added
# later, no evidence for the Claim Extractor itself.
@issue-29
Feature: The Claim Extractor runs inside the stack, and its Claims stay inside

  @ac-17
  Scenario: The detection service starts with the Claim Extractor's prompt file and reports ready
    Given the owner expects:
      """
      Wenn ich über den Eingang des Testaufbaus per HTTPS /detection/ready abfrage, antwortet der Erkennungsdienst mit 200
      und nennt seine Abhängigkeit redis mit „ok“. Der Dienst ist also mit der Anweisung des Behauptungs-Extraktors aus
      der eingebundenen Datei gestartet; fehlte die Datei, wäre er gar nicht erst gestartet.
      """
    When the client asks the edge for "/detection/ready"
    Then the edge answers with status 200
    And the edge body names the dependency "redis" as "ok"

  @ac-15
  Scenario: The Claims of a Session cannot be read through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang per HTTPS die Behauptungen einer Session abfrage
      (/detection/sessions/29a0c0de-0000-4000-8000-000000000001/claims), antwortet der Eingang selbst mit 404.
      Kein Dienst beantwortet die Anfrage; Behauptungen, Sätze und Sprecher einer Session sind von außen nicht abrufbar.
      """
    When the client asks the edge for "/detection/sessions/29a0c0de-0000-4000-8000-000000000001/claims"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service

  @ac-15
  Scenario: The Candidates of a Session cannot be read through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang per HTTPS die unklaren Stellen (Kandidaten) einer Session abfrage
      (/detection/sessions/29a0c0de-0000-4000-8000-000000000001/candidates), antwortet der Eingang selbst mit 404;
      kein Dienst beantwortet die Anfrage.
      """
    When the client asks the edge for "/detection/sessions/29a0c0de-0000-4000-8000-000000000001/candidates"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service
