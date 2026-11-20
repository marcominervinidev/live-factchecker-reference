# Stage 3, issue #25 (T1): the detection service through the Caddy edge of the Compose stack, over HTTPS with the
# stack's own root CA (never skipping verification). Routes: ticket #25, Assumptions (`/detection/health` and
# `/detection/ready`, everything else 404). Steps: tests/api/steps/edge.steps.ts.
# Assumption proposed for the ticket (gate 1, round 2, open question 1): the edge answers an unrouted path itself
# with 404 and the response header `X-Lfc-Edge: unrouted`; it never sets that header on a forwarded answer, and no
# service ever sets it. That header is what tells the edge's own 404 from a service's 404 (AC9 "reaches no service").
@issue-25
Feature: The detection service through the edge

  @ac-8
  Scenario Outline: <path> of the detection service answers 200 through the edge over HTTPS
    When the client asks the edge for "<path>"
    Then the edge answers with status 200
    And the answer was forwarded to a service, not written by the edge itself

    Examples: routed paths of the detection service
      | path              |
      | /detection/health |
      | /detection/ready  |

  @ac-9
  Scenario Outline: <path> is not routed and answers 404 at the edge
    When the client asks the edge for "<path>"
    Then the edge answers with status 404
    And the answer was written by the edge itself and reached no service

    Examples: the root of the edge
      | path |
      | /    |

    Examples: a probe path of the service without its prefix (the service itself would answer 200)
      | path    |
      | /health |

    Examples: the service prefix without a route
      | path       |
      | /detection |

    Examples: an unknown path under the service prefix
      | path               |
      | /detection/metrics |

    Examples: the name of an infrastructure service of the stack
      | path   |
      | /redis |
