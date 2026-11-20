# Acceptance cases of issue #26 (T1b), owner's view, run as code: `make acceptance ISSUE=26` on lfc-26-acc with the
# API driver (stage-3 step library tests/api/steps plus tests/acceptance/steps). Only the part of AC11 the API driver
# can show lives here: the edge answers once the stack (with the compose changes of T1b) is healthy. The stack is
# started by `ci-stack-up`, not by `make up`; the owner's own start, dev, stop, restart, down and secrets-init are
# owner-run cases in tests/acceptance/owner/26/owner-stack.feature (ticket #26, Assumptions: the hooks owner-stack and
# guard-secrets deny them to agents). AC1 to AC10 are shown at stage 1 (model-call.test.ts, logger.edge.test.ts,
# scripts/ci/flaky.test.ts, tools/tests/test_make_targets.py); the owner sees them in the test report.
@issue-26
Feature: The stack answers through the edge once it is healthy

  @ac-11
  Scenario: Once every service is healthy, the edge answers the health route of the detection service
    Given the owner expects:
      """
      Wenn der Aufbau gestartet ist und alle Dienste gesund sind, antwortet der Eingang per HTTPS auf /detection/health mit 200.
      """
    When the client asks the edge for "/detection/health"
    Then the edge answers with status 200
    And the answer was forwarded to a service, not written by the edge itself
