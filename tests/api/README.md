# @lfc/api-tests

## Purpose
Stage 3 of `docs/process/test-strategy.md`: Cucumber scenarios over HTTPS against the running Compose stack, through
the edge only. `make test-api` runs them; CI runs the same target in `stack-tests.yml` and collects
`reports/junit.xml`.

## Boundaries
Talks to the stack over its routes and contracts; never imports service or app code (`.dependency-cruiser.cjs`,
`tests-no-service-or-app-code`). Features under `features/`, the step library under `steps/` (`.claude/rules/tests.md`).
`make test-api` runs the suite in a one-off client (Compose service `stack-client`, profile `client`) on the
internal `clients` network, which reaches the edge only; it sets `LFC_EDGE_URL=https://edge:8443` and
`LFC_EDGE_CA_FILE=/run/lfc/edge-root.crt`: the root CA it exports from the running edge (Caddy's internal CA) into
`.secrets/<project>/edge-root.crt` and mounts read-only as the client's only secret file (`.secrets/` itself is an
empty tmpfs there). The client sees the repository read-only and writes only `reports/`: `junit.xml`, the Cucumber
messages report `messages.ndjson` and, written after every run by `scripts/ci/flaky.ts`, `flaky.txt` (one line
`<feature>: <scenario>` per scenario that failed and passed on its retry; empty when none; `pr.yml` opens an issue per
line, `stack-tests.yml` fails without the file). "Always" means every run that got as far as Cucumber: without a
messages report (the client never started) no `flaky.txt` is written, the run is red and `stack-tests.yml` fails loudly.

## Pitfalls
- Never skip TLS verification; trust the root CA the stack exports.
- `RETRIES` (0 or 1; unset or empty is 0, the local default) is Cucumber's `--retry`; CI sets 1. Any other value is
  refused before the client starts.
- A stack-test run uses a throwaway project (`lfc-<issue>-<task>`, CI `lfc-ci-<run>`) and throwaway secrets, never the
  owner's stack.
- Step files are TypeScript run by Node's type stripping: erasable syntax only.
- The edge's certificates name `localhost` (its host port, `docker compose port edge 8443`; `LFC_EDGE_PORT` fixes it)
  and `edge` (the clients network); any other host name fails verification, as it should.
- The acceptance runner (`tests/acceptance`) loads `steps/` too: extend the vocabulary here, never copy it.

## Commands
- `COMPOSE_PROJECT_NAME=lfc-<issue>-<task> make ci-secrets ci-stack-up test-api ci-stack-down`
- `COMPOSE_PROJECT_NAME=lfc-<issue>-<task> make test-api` against a stack that is already up.
- `scripts/tb pnpm --filter @lfc/api-tests typecheck`
