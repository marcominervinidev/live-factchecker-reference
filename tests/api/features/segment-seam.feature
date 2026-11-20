# Stage 3, issue #27 (T2), Task 3, AC13: the Session routes of the detection service are internal; the edge of the
# Compose stack does not route them (ticket #27, Assumptions). Through the edge only, over HTTPS with the stack's
# root CA. Steps: tests/api/steps/edge.steps.ts (#25) plus tests/api/steps/segment-seam.steps.ts (new: methods
# other than GET). The edge marks the 404 it writes itself with X-Lfc-Edge: unrouted (#25, AC9).
# AC5, AC8, AC10 and AC11 are on stage 2a (services/detection/features/session.feature): the stage-3 client
# reaches the edge only, so it cannot reach routes the edge does not route.
@issue-27
Feature: The Session routes are not reachable through the edge

  @ac-13
  Scenario Outline: <method> <path> answers 404 at the edge and reaches no service
    When the client sends a <method> request to the edge for "<path>"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service

    Examples: creating a Session
      | method | path                |
      | POST   | /detection/sessions |
      | POST   | /sessions           |

    Examples: sending a Segment
      | method | path                                                          |
      | POST   | /detection/sessions/27a0c0de-0000-4000-8000-000000000013/segments |

    Examples: reading the state of a Session
      | method | path                                                 |
      | GET    | /detection/sessions/27a0c0de-0000-4000-8000-000000000013 |
