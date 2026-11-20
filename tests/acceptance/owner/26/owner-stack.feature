# Owner-run acceptance cases of issue #26 (T1b), AC10 (secrets-init dry run) and AC11 to AC15: the owner runs them on
# his own stack and on a temporary secrets directory at gate 2 (ticket #26, Assumptions). Agents never run them (hooks
# owner-stack, guard-secrets). Not loaded by `make acceptance` (it runs features/<issue>/ only) and without step
# definitions: each step is an instruction for the owner, the docstring his expectation, written before the code.
# The edge steps keep the exact wording of the stage-3 step library (tests/api/steps/edge.steps.ts); "the client" is
# then the owner's own HTTPS client against his edge. The secrets directory is named by LFC_SECRETS_DIR only (owner
# decision Q6, gate 1 of #26); $TMP is the temporary directory a scenario creates. The judge marks AC11 to AC15 as
# owner cases and takes the terminal output the owner pastes as their evidence (owner decision Q3).
@issue-26
Feature: The owner starts, stops and supplies his own stack with one command each

  @ac-10
  Scenario: The dry run of secrets-init exits 0 and creates nothing
    Given the owner expects:
      """
      `make -n secrets-init` zeigt, was angelegt würde, legt nichts an und endet mit 0.
      """
    When the owner runs "make -n secrets-init"
    Then the command exits with 0
    And no file in the secrets directory has changed

  @ac-11
  Scenario: up starts the owner's stack and returns once every service is healthy
    Given the owner expects:
      """
      `make up` startet meinen Aufbau unter meinem Compose-Projekt und kehrt erst zurück, wenn alle Dienste gesund sind.
      Danach antwortet der Eingang per HTTPS auf /detection/health mit 200.
      """
    And the owner's project has no container
    When the owner runs "make up"
    Then the command exits with 0
    And every service of the owner's project is healthy
    When the client asks the edge for "/detection/health"
    Then the edge answers with status 200
    And the answer was forwarded to a service, not written by the edge itself

  @ac-12
  Scenario: dev starts the same stack with the detection service from the dev stage
    Given the owner expects:
      """
      `make dev` startet denselben Aufbau, der Erkennungsdienst ist aus der Dev-Stufe des Dockerfiles gebaut.
      """
    When the owner runs "make dev"
    Then the command exits with 0
    And every service of the owner's project is healthy
    And "docker compose -f compose.yml -f compose.dev.yml config" shows "target: dev" for the detection service
    And "docker inspect" shows the source mount of compose.dev.yml in the detection container

  @ac-12
  Scenario: stop keeps containers and volumes, restart brings the stack back, down removes it
    Given the owner expects:
      """
      `make stop` hält den Aufbau an, Container und Volumes bleiben. `make restart` bringt ihn gesund zurück.
      `make down` entfernt ihn.
      """
    And the stack of the previous case is still running
    When the owner runs "make stop"
    Then every container of the owner's project is stopped and still there
    And the volumes of the owner's project are still there
    When the owner runs "make restart"
    Then every service of the owner's project is healthy
    When the owner runs "make down"
    Then the owner's project has no container

  @ac-13
  Scenario Outline: <target> refuses when a secret is missing, names it and starts nothing
    Given the owner expects:
      """
      Fehlt ein Geheimnis, das der Aufbau braucht, verweigert `make <target>` den Start, nennt das fehlende Geheimnis beim Namen
      (nie einen Wert) und verweist auf `make secrets-init`. Es wird kein Container gestartet.
      """
    And the owner's project has no container
    And a temporary secrets directory $TMP without the secret "redis_password"
    When the owner runs "LFC_SECRETS_DIR=$TMP make <target>"
    Then the command exits with a code other than 0
    And the message names "redis_password" and "make secrets-init" and shows no secret value
    And the owner's project has no container

    Examples: start targets
      | target |
      | up     |
      | dev    |

  @ac-14
  Scenario: secrets-init creates each missing internal secret as its own file
    Given the owner expects:
      """
      `make secrets-init` legt jedes fehlende interne Geheimnis als eigene Datei mit Zufallswert im Geheimnis-Verzeichnis
      außerhalb des Repositorys an; das Verzeichnis hat 0700, jede Datei 0600.
      """
    And an empty temporary secrets directory $TMP outside the repository
    When the owner runs "LFC_SECRETS_DIR=$TMP make secrets-init"
    Then the command exits with 0
    And the directory holds one non-empty file per internal secret, e.g. "redis_password"
    And the directory has mode 0700 and each file mode 0600
    And a second empty directory initialised the same way holds different values

  @ac-15
  Scenario: secrets-init leaves an existing secret unchanged and says so
    Given the owner expects:
      """
      Gibt es ein Geheimnis schon, lässt `make secrets-init` die Datei unverändert und sagt das.
      """
    And a temporary secrets directory $TMP with an existing file "redis_password"
    When the owner runs "LFC_SECRETS_DIR=$TMP make secrets-init"
    Then the content and modification time of "redis_password" are unchanged
    And the output says that "redis_password" exists and was left unchanged
