# Acceptance cases of issue #32 (T6), owner's view. Not a test stage; never runs in CI. `make acceptance ISSUE=32`
# runs them on lfc-32-acc with the API driver through the edge (step library tests/api/steps, #25), with the mock
# adapters and the prompt files of the CI stack (compose.yml).
# The tag list and the Topic events live in the Session state and on the internal detection stream in Redis (ADR 0005,
# addendum 2026-10-25; docs/spec/datenschutz.md 2), and the Session routes are not routed by the edge (#27, AC13).
# The ticket has no measurement and no target value (ADR 0003); the owner sees the Topics "in den Testläufen": the
# stage-2a run of services/detection/features/topic-extractor.feature (replay of golden: synt-2026-10-06-a 01:10-01:55)
# shows the tag list starting with the Setting's Topic and one Topic event per change. Through the edge the owner sees
# only that no tag list or Topic event can be read from outside. Both cases are green on the base already (the edge's
# catch-all, #25 AC9): guards against a route added later. No acceptance case shows that the Topic Extractor runs:
# /detection/ready answers 200 with or without it (critic of 2026-11-17, A7), so that case was dropped.
@issue-32
Feature: The Topics of a Session stay inside the stack

  @ac-9
  Scenario: The tag list of a Session cannot be read through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang per HTTPS die Themenliste einer Session abfrage
      (/detection/sessions/32a0c0de-0000-4000-8000-000000000001/topics), antwortet der Eingang selbst mit 404.
      Kein Dienst beantwortet die Anfrage; die Themen einer Session sind von außen nicht abrufbar.
      """
    When the client asks the edge for "/detection/sessions/32a0c0de-0000-4000-8000-000000000001/topics"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service

  @ac-9
  Scenario: The detection stream with the Topic events of a Session cannot be read through the edge
    Given the owner expects:
      """
      Wenn ich über den Eingang per HTTPS den Ereignisstrom einer Session abfrage
      (/detection/sessions/32a0c0de-0000-4000-8000-000000000001/detection), antwortet der Eingang selbst mit 404;
      kein Dienst beantwortet die Anfrage, und kein Themen-Ereignis verlässt den Erkennungsdienst.
      """
    When the client asks the edge for "/detection/sessions/32a0c0de-0000-4000-8000-000000000001/detection"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service
