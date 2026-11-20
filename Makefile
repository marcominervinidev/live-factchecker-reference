# Node tools run in the toolbox (scripts/tb); the host needs Docker, Git and make only (CLAUDE.md). On the
# CI runner (CI=true, Node from .nvmrc) they run directly. Workflows call ci-*, test-api, test-e2e, lighthouse.
SHELL := /bin/sh
RUN := $(if $(filter true,$(CI)),,scripts/tb)
REGISTRY := $(or $(LFC_REGISTRY),lfc)
# Throwaway secrets per Compose project, git-ignored; only the ci-* recipes point compose.yml at them.
CI_SECRETS := "$(CURDIR)/.secrets/$$COMPOSE_PROJECT_NAME"
# `$(BOUND) <seconds> <command…>`: the command with a time limit, then TERM, 10 s later KILL, exit 124. perl, because
# macOS has no GNU timeout and a Go binary such as docker ignores SIGALRM; perl is on macOS and the Ubuntu runner.
BOUND := perl -e '$$t = shift; $$pid = fork // die "fork: $$!\n"; if (!$$pid) { exec { $$ARGV[0] } @ARGV or die "exec: $$!\n" } \
  $$SIG{ALRM} = sub { warn "timed out after $$t s: @ARGV[0..2]\n"; $$late = 1; kill "TERM", $$pid; \
  $$SIG{ALRM} = sub { kill "KILL", $$pid }; alarm 10 }; alarm $$t; waitpid $$pid, 0; exit($$late ? 124 : $$? >> 8 || ($$? & 127 ? 1 : 0))'
# Seconds for `docker compose up --wait` incl. a local build; CI builds without cache in about 2 minutes.
STACK_UP_TIMEOUT := $(or $(LFC_STACK_UP_TIMEOUT),600)

.PHONY: help test-unit ci-guard ci-secrets ci-stack-up ci-stack-down test-integration edge-ca retries-guard test-api \
  acceptance test-e2e lighthouse owner-session owner-guard secrets-check up dev stop restart down \
  secrets-init docker-clean

help: ## List the targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

test-unit: ## Stage 1: the root scripts and every workspace
	$(RUN) pnpm test:unit
	$(RUN) pnpm -r --if-present test:unit

# Stack targets: only a throwaway project (agents lfc-<issue>-<task>, CI lfc-ci-<run>); ci-stack-down removes volumes.
ci-guard:
	@n="$$COMPOSE_PROJECT_NAME"; \
	if [ "$$n" = lfc-owner ] || ! expr "x$$n" : 'xlfc-[a-z0-9][a-z0-9_-]*$$' >/dev/null; then \
	  echo "COMPOSE_PROJECT_NAME must name a throwaway stack (lfc-<issue>-<task>, lfc-ci-<run>)" >&2; exit 1; \
	fi

# 644, not 0600: Compose bind-mounts the file with its host owner, and on a Linux host (the CI runner) redis (uid 999)
# and the services (uid 65532) cannot read a 0600 file of the runner's user; the throwaway value is no loss.
ci-secrets: ci-guard ## Throwaway secret files for this Compose project
	@dir=$(CI_SECRETS); mkdir -p "$$dir" && chmod 700 "$$dir" \
	  && od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$$dir/redis_password" && chmod 644 "$$dir/redis_password" \
	  && echo "throwaway secrets written to .secrets/$$COMPOSE_PROJECT_NAME/"

# A local build is tagged with the Compose project (LFC_TAG defaults to it), so parallel worktrees, the acceptance
# stack and the owner's stack never run each other's image; CI and pushed images pass LFC_TAG themselves.
ci-stack-up: ci-guard ## Start the stack (local build when the registry is lfc) and wait until it is healthy
	LFC_TAG="$${LFC_TAG:-$$COMPOSE_PROJECT_NAME}" LFC_SECRETS_DIR=$(CI_SECRETS) $(BOUND) $(STACK_UP_TIMEOUT) \
	  docker compose up -d --wait --wait-timeout 120 $(if $(filter lfc,$(REGISTRY)),--build,--no-build)

# --profile client: down also removes a stage-3 or acceptance client that a time limit (BOUND) cut off.
ci-stack-down: ci-guard ## Remove the stack with its volumes, and its throwaway secrets (also when down fails)
	LFC_SECRETS_DIR=$(CI_SECRETS) docker compose --profile client down -v --remove-orphans; status=$$?; rm -rf $(CI_SECRETS); exit $$status

# Stage 2a of one workspace, locally and in CI alike: throwaway secrets and a fresh Redis, then the workspace's
# test:integration in a one-off toolbox (compose service toolbox-it) on the internal data network, because Redis
# publishes no host port, not even in CI. As the caller's uid (never root), so it reads the secret and the CI
# checkout. ci-stack-down always runs (trap, also on INT and TERM); the exit code is the tests'. Pass WS in the
# environment: make expands a command-line WS='$(shell ...)' before any check here. toolbox-it has no network:
# verify-deps-before-run is off for this one `pnpm run`, else pnpm installs first when node_modules/.pnpm-workspace-
# state-v1.json does not match (CI installs filtered, at the runner's path), and that install verifies the lockfile
# against the supply-chain policies with registry metadata. Installs keep the check.
test-integration: ci-guard ## Stage 2a of WS=<workspace> against a throwaway Redis, e.g. WS=@lfc/detection
	@expr "x$$WS" : 'x@lfc/[a-z0-9][a-z0-9-]*$$' >/dev/null \
	  || { echo "test-integration: WS must name a workspace, e.g. WS=@lfc/detection" >&2; exit 2; }
	@[ "$$(id -u)" -ne 0 ] || { echo "test-integration: refuses to run as root" >&2; exit 2; }
	@$(MAKE) --no-print-directory ci-secrets
	@export LFC_SECRETS_DIR=$(CI_SECRETS) LFC_NODE_VERSION="$$(cat .nvmrc)"; \
	trap '$(MAKE) --no-print-directory ci-stack-down' EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; \
	docker compose up -d --force-recreate --wait --wait-timeout 120 redis && \
	docker compose --profile integration run --rm --build --user "$$(id -u):$$(id -g)" -e HOME=/tmp \
	  -e REDIS_URL=redis://redis:6379 -e REDIS_PASSWORD_FILE="/workspace/.secrets/$$COMPOSE_PROJECT_NAME/redis_password" \
	  toolbox-it pnpm --config.verify-deps-before-run=false --filter "$$WS" --fail-if-no-match run test:integration

# Stages 3 and acceptance reach the stack through the edge only: a one-off client (compose service stack-client) on
# the clients network asks https://edge:8443 and trusts the root CA the running edge exports (Caddy's internal CA),
# never skipping verification. Locally and in CI alike, as the caller's uid with HOME=/tmp (like test-integration);
# the client sees the repository read-only and writes only LFC_CLIENT_REPORTS; verify-deps-before-run is off for
# the same reason as in test-integration (no network).
EDGE_CA := .secrets/$$COMPOSE_PROJECT_NAME/edge-root.crt
CLIENT = docker compose --profile client run --rm --build --user "$$(id -u):$$(id -g)" -e HOME=/tmp \
  -e LFC_EDGE_URL=https://edge:8443 -e LFC_EDGE_CA_FILE=/run/lfc/edge-root.crt

edge-ca: ci-guard
	@mkdir -p "$$(dirname $(EDGE_CA))" && $(BOUND) 30 docker compose exec -T edge cat /data/caddy/pki/authorities/local/root.crt \
	  > $(EDGE_CA) && [ -s $(EDGE_CA) ] || { echo "edge-ca: the edge of $$COMPOSE_PROJECT_NAME exported no root CA" >&2; exit 1; }

# RETRIES: how often stages 3 and 4 retry a failed scenario; stack-tests.yml sets 1, unset or empty is the local
# default 0 (.claude/rules/tests.md, "Flaky"). Anything else is refused before a client starts or a report is written.
retries-guard:
	@case "$${RETRIES:-0}" in 0 | 1) ;; *) printf '%s\n' "RETRIES must be 0 or 1 (unset or empty: 0), not '$$RETRIES'" >&2; exit 2 ;; esac

# After the run, scripts/ci/flaky.ts reads the Cucumber messages report and always writes reports/flaky.txt: one
# line per scenario that failed and passed on its retry, empty when none (pr.yml opens an issue per line). The exit
# code is Cucumber's, unless the flaky list could not be written. Without a messages report (the client never got to
# Cucumber) no flaky.txt is written and the run is red; stack-tests.yml then fails loudly on the missing file.
test-api: retries-guard ci-guard edge-ca ## Stage 3: Cucumber of @lfc/api-tests through the edge (RETRIES=0|1); JUnit and flaky.txt in tests/api/reports/
	@[ "$$(id -u)" -ne 0 ] || { echo "test-api: refuses to run as root" >&2; exit 2; }
	@mkdir -p tests/api/reports && rm -f tests/api/reports/messages.ndjson tests/api/reports/flaky.txt
	@export LFC_SECRETS_DIR=$(CI_SECRETS) LFC_NODE_VERSION="$$(cat .nvmrc)" LFC_CLIENT_REPORTS=tests/api/reports; \
	$(CLIENT) stack-client pnpm --config.verify-deps-before-run=false --filter @lfc/api-tests test \
	  --retry "$${RETRIES:-0}" --format message:reports/messages.ndjson; status=$$?; \
	$(RUN) node scripts/ci/flaky.ts tests/api/reports/messages.ndjson tests/api/reports/flaky.txt && exit $$status

# The acceptance cases of one ticket (tests/acceptance/README.md): code, no model. Its own throwaway stack
# lfc-<issue>-acc, removed with its secrets afterwards (trap, also on INT and TERM); pass ISSUE on the command line
# or in the environment. Every phase has a time limit (BOUND) and prints how long it took, so a slow run fails
# fast and says where it stalled: images 300 s, stack 180 s (images already built), cases 300 s. Exit 0 when the
# report was written and the run did not break; failed cases are the judge's to read.
acceptance: ## Acceptance cases of ISSUE=<n> on lfc-<n>-acc (LFC_STACK_TEST=1); tests/acceptance/reports/<n>/report.json
	@[ "$$LFC_STACK_TEST" = 1 ] || { echo "acceptance: refuses to start without LFC_STACK_TEST=1" >&2; exit 2; }
	@expr "x$$ISSUE" : 'x[1-9][0-9]*$$' >/dev/null || { echo "acceptance: ISSUE must be an issue number" >&2; exit 2; }
	@[ "$$(id -u)" -ne 0 ] || { echo "acceptance: refuses to run as root" >&2; exit 2; }
	@export COMPOSE_PROJECT_NAME="lfc-$$ISSUE-acc" LFC_CLIENT_REPORTS="tests/acceptance/reports/$$ISSUE"; \
	export LFC_SECRETS_DIR=$(CI_SECRETS) LFC_NODE_VERSION="$$(cat .nvmrc)" LFC_STACK_UP_TIMEOUT=180 \
	  LFC_TAG="$${LFC_TAG:-$$COMPOSE_PROJECT_NAME}"; \
	commit="$$(git rev-parse --short HEAD)"; t0=$$(date +%s); \
	took() { echo "acceptance: $$1 after $$(( $$(date +%s) - t0 )) s"; }; \
	trap 'took "run ended"; $(MAKE) --no-print-directory ci-stack-down' EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; \
	rm -rf "$$LFC_CLIENT_REPORTS" && mkdir -p "$$LFC_CLIENT_REPORTS" && \
	$(BOUND) 300 docker compose --profile client build --quiet && took "images built" && \
	$(MAKE) --no-print-directory ci-secrets ci-stack-up edge-ca && took "stack healthy, root CA exported" && \
	$(BOUND) 300 $(CLIENT) -e LFC_ISSUE="$$ISSUE" -e LFC_COMMIT="$$commit" -e LFC_STACK="$$COMPOSE_PROJECT_NAME" \
	  stack-client pnpm --config.verify-deps-before-run=false --filter @lfc/acceptance-tests run acceptance

test-e2e: retries-guard ## Stage 4: none before increment 2 (no client); validates RETRIES like test-api
	@if [ -d tests/e2e ]; then echo "test-e2e: tests/e2e exists but is not wired yet" >&2; exit 1; fi
	@echo "test-e2e: no stage-4 suite / no client before increment 2"

lighthouse: ## Stage 5 Lighthouse CI: none before increment 2 (no client)
	@if [ -d apps/web ]; then echo "lighthouse: apps/web exists but is not wired yet" >&2; exit 1; fi
	@echo "lighthouse: no stage-4 suite / no client before increment 2"

# ci-local (ticket #68 AC6): the required checks of ci.yml and pr.yml before a push, in scripts/ci/local.sh. It
# starts throwaway stacks, hence ci-guard; LFC_RUN is the toolbox wrapper (empty on the CI runner).
.PHONY: ci-local
ci-local: ci-guard ## The required CI checks locally before a push (BASE=origin/main); summary with exit codes
	@LFC_RUN='$(RUN)' MAKE='$(MAKE)' sh scripts/ci/local.sh

# The owner's stack: the project compose.yml names (no COMPOSE_PROJECT_NAME), secrets in LFC_SECRETS_DIR, by
# default the directory compose.yml defaults to, outside the repository. Agents never run these targets (hooks
# owner-stack, guard-secrets); their stacks use the ci-* targets. Every secret the stack reads (compose.yml,
# top-level secrets) is internal today, so secrets-init can create each one. The default directory is written in
# two more places: compose.yml (secrets, file) and .claude/hooks/lib.sh (SECRETS_DIR_DEFAULT); change all three.
# Exported once and read as "$$LFC_SECRETS_DIR" in the recipes, never pasted into them by make: a quote, $ or
# backtick in the path cannot run a command (security S4).
LFC_SECRETS_DIR ?= $(HOME)/.config/live-factchecker/secrets
export LFC_SECRETS_DIR
STACK_SECRETS := redis_password

# Not from a Claude Code session (CLAUDECODE is set there): the hooks owner-stack and guard-secrets are the belt,
# this is the braces (security S2; owner decision at gate 2 of #26).
owner-session:
	@[ -z "$$CLAUDECODE" ] || { echo "owner targets refuse inside a Claude Code session (CLAUDECODE is set); run them in your own terminal" >&2; exit 1; }

# Mirror of ci-guard: only compose.yml's own project, and nothing in the environment that changes which files or
# services Compose loads (security S3). A recipe, so `make -n <target>` stays a dry run.
owner-guard: owner-session
	@[ -z "$$COMPOSE_PROJECT_NAME" ] || [ "$$COMPOSE_PROJECT_NAME" = live-factchecker-v2 ] \
	  || { echo "owner targets: COMPOSE_PROJECT_NAME must be unset or live-factchecker-v2 (throwaway stacks: ci-*)" >&2; exit 1; }
	@[ -z "$$COMPOSE_FILE$$COMPOSE_PROFILES" ] \
	  || { echo "owner targets: unset COMPOSE_FILE and COMPOSE_PROFILES; the targets choose files and profiles" >&2; exit 1; }

# Names each missing and each empty secret file, never a value; up and dev start nothing then.
secrets-check:
	@case "$$LFC_SECRETS_DIR" in '' | *'"'* | *'$$'* | *'`'*) \
	  echo "secrets-check: LFC_SECRETS_DIR must be a plain path (no quote, dollar sign or backtick)" >&2; exit 1 ;; esac; \
	missing=; empty=; for s in $(STACK_SECRETS); do f="$$LFC_SECRETS_DIR/$$s"; \
	  if [ ! -e "$$f" ]; then missing="$$missing $$s"; elif [ ! -s "$$f" ]; then empty="$$empty $$s"; fi; done; \
	[ -z "$$empty" ] || echo "empty secret(s) in $$LFC_SECRETS_DIR:$$empty; remove them, then run make secrets-init" >&2; \
	[ -z "$$missing" ] || echo "missing secret(s) in $$LFC_SECRETS_DIR:$$missing; run make secrets-init" >&2; \
	[ -z "$$missing$$empty" ]

up: owner-guard secrets-check ## Start the owner's stack and wait until every service is healthy
	$(BOUND) $(STACK_UP_TIMEOUT) \
	  docker compose up -d --wait --wait-timeout 120 $(if $(filter lfc,$(REGISTRY)),--build,--no-build)

# compose.dev.yml: detection from the Dockerfile's dev stage on the mounted sources (node --watch), built locally.
dev: owner-guard secrets-check ## Start the owner's stack with detection from the dev stage (compose.dev.yml)
	$(BOUND) $(STACK_UP_TIMEOUT) \
	  docker compose -f compose.yml -f compose.dev.yml up -d --wait --wait-timeout 120 --build

# --profile toolbox: stop and down take the owner's toolbox container (scripts/tb) and its network along.
stop: owner-guard ## Stop the owner's stack; containers and volumes stay
	docker compose --profile toolbox stop

# stop and start, not up: the containers stay as they are, a dev stack stays a dev stack. start without the toolbox
# profile: with it, start fails ("missing dependency toolbox") when no toolbox container exists, the normal case after
# down and up; the toolbox stays stopped and scripts/tb starts it again when needed.
restart: owner-guard ## Restart the owner's stack and wait until every service is healthy
	docker compose --profile toolbox stop \
	  && docker compose start --wait --wait-timeout 120

down: owner-guard ## Remove the owner's stack (containers and networks)
	docker compose --profile toolbox down --remove-orphans

secrets-init: owner-session ## Create each missing secret of the stack in LFC_SECRETS_DIR (0700, files 0600); never overwrites one
	@sh scripts/secrets-init.sh $(STACK_SECRETS)

# The images of throwaway projects and the build cache (ticket #182); the script reads CONFIRM from the environment,
# where make also puts a command-line CONFIRM=1, so make never pastes the value into the recipe.
docker-clean: owner-session ## Report images of throwaway projects and the build cache; CONFIRM=1 removes the unused ones
	@sh scripts/docker-clean.sh
