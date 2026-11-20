# Stage 2a, issue #25 (T1): readiness and shutdown of the detection service, in-process, against the Redis
# container of the test project (Compose project lfc-25-2; `test:integration` provides REDIS_URL and
# REDIS_PASSWORD_FILE of that Redis to the test process). Steps: features/steps/detection.steps.ts.
@issue-25
Feature: Readiness and shutdown of the detection service
  The detection service has one dependency, Redis. /ready tells whether it is reachable without revealing
  where it is or why it failed, and SIGTERM stops the service cleanly.

  @ac-6
  Scenario: /ready answers 200 and names Redis ok when Redis is reachable
    Given the detection service runs with the Redis of the test project
    When the client asks the service for "/ready"
    Then the service answers with status 200
    And the body names the dependency "redis" as "ok"

  @ac-6
  Scenario: /ready answers 503 and names Redis failed, revealing nothing, when Redis is unreachable
    Given the detection service runs with Redis expected at a loopback port where nothing listens
    When the client asks the service for "/ready"
    Then the service answers with status 503
    And the body names the dependency "redis" as "failed"
    And the body reveals no host, no port, no error text and no secret of the Redis connection

  @ac-7
  Scenario: SIGTERM drains the service, closes Redis, logs one stop event and exits 0 within 10 seconds
    Given the detection service runs with the Redis of the test project
    And "/ready" answers with status 200
    And the service holds a connection to Redis
    When the service receives SIGTERM
    # Weaker than "503 while it drains": it also holds when the port closes at once (open question 2, gate 1 round 2).
    Then no "/ready" answer after SIGTERM has status 200
    And the service exits with code 0 within 10 seconds
    And the service holds no connection to Redis anymore
    And exactly one stop event was logged after SIGTERM
    And the port of the service refuses new connections
