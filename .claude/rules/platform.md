---
paths:
  - "Dockerfile*"
  - "**/Dockerfile*"
  - "compose*.y*ml"
  - "docker-compose*.y*ml"
  - ".github/workflows/**"
  - "deploy/**"
  - "scripts/**"
  - "Makefile"
  - "packages/service-kit/**"
---

# Platform

Rules for this area only; repo-wide rules are in `CLAUDE.md`. Keep the sections, fill them as the code arrives; an empty section is a reminder, not a licence to invent.

## Responsibility
Dockerfiles, Compose, CI, Make targets, scripts; after the PoC the whole app runs dockerised and production-ready by the twelve factors. The platform engineer builds here and explains each decision; some tasks the owner takes by hand (ticket "Lernpfad").

## File map
Reference: hardened multi-stage Dockerfile (build stage with esbuild bundle, distroless runtime, non-root), Compose with networks by need, `scripts/tb` for the toolbox; throwaway test stacks through the Make targets `ci-secrets`, `ci-stack-up`, `test-api`, `ci-stack-down`, `test-integration`, `acceptance`; the owner's stack through `up`, `dev`, `stop`, `restart`, `down`, `secrets-init` (secrets in `LFC_SECRETS_DIR`, the one name); they refuse inside a Claude Code session (`CLAUDECODE` set; owner decision at gate 2 of #26), and the stack targets refuse a foreign `COMPOSE_PROJECT_NAME`, `COMPOSE_FILE` or `COMPOSE_PROFILES`; `stop` and `down` include the toolbox profile, `restart` starts without it (the toolbox stays stopped).
- `services/detection/Dockerfile`: the service image pattern (ADR 0011 addendum 2026-10-28): build stage on the pinned `node` image (pnpm release by checksum, install from the lockfile, `pnpm run build`), stage `runtime` on distroless Node with only `main.mjs`, uid 65532; stage `dev` (node on the build stage, `--watch`) only for `make dev`.
- `compose.dev.yml`: the override of `make dev`, detection from stage `dev` with its sources and those of `@lfc/service-kit` and `@lfc/contracts` mounted read-only; never loaded by CI or test stacks.
- `deploy/edge/Caddyfile`: the edge, HTTPS from Caddy's internal CA (names `localhost` and `edge`), routes only GET on `/detection/health` and `/detection/ready`; a body over 1 KB gets 413 (buffered before forwarding); every other request, HEAD, another method or a foreign Host included, gets its own 404 with `X-Lfc-Edge: unrouted`. Its egress is open in Compose; closing it at the host firewall in production is a residual risk open until gate 2 (owner decision, ADR 0011 addendum 2026-10-28).
- `compose.yml`: `detection` runs the Claim Extractor with `MODEL_ADAPTER=mock` (#29, gate 1 question 12), the prompt file of its image and the Golden Set labels of `synt-2026-10-06-a` mounted read-only as the mock's expectations; services `redis`, `detection`, `edge` (the only host port, `LFC_EDGE_PORT`), `stack-client` (profile `client`: stage 3 and the acceptance runner, repository read-only), `toolbox`, `toolbox-it`; networks `data` (services and Redis), `edge` (edge and the services it routes to), `public` (the edge's host port), `clients` (edge and `stack-client`), `tools` (toolbox registry access); all but `public` and `tools` internal.
- `scripts/docker-clean.sh` behind the owner target `docker-clean` (#182; it refuses with `CLAUDECODE` set by itself too): reports the images of throwaway projects (rule of `ci-guard`; never `lfc-eval`, `lfc-test`, `lfc-toolbox*`, `lfc-agent*`, `lfc-probe*`, owner decision C-Q9) and the build cache; `CONFIRM=1` removes the project's references of projects without a container (never `-f`) and the build cache older than 168 h.
- `packages/service-kit/` (`@lfc/service-kit`): the JSON logging module (`src/logger.ts`, closed field set), the model call record and Session counter (`src/model-call.ts`), configuration from the environment with `<NAME>_FILE` secrets (`src/config.ts`), `/health` and `/ready` (`src/health.ts`), start and SIGTERM drain (`src/lifecycle.ts`); every service starts through it.

## Pitfalls
- Twelve factors: configuration from the environment only, stateless processes, logs to stdout, build/release/run separated, port binding, disposability (SIGTERM), dev/prod parity.
- Hardening by default: non-root, read-only root fs with `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, limits, pinned images; only the edge publishes ports; egress only where needed.
- CI: frozen lockfile, denied install scripts, actions pinned by SHA, minimal `permissions`, no PR data in `run:` steps; every CI scanner also runs locally via a Make target.
- Never the owner's stack: agent stacks are `lfc-<issue>-<task>` (hook `owner-stack`).
- `make dev` runs the `.ts` sources by type stripping, not the esbuild bundle; the bundle runs in `make up`, stage 3 and acceptance, so a bundling problem shows only there.
- Secret file modes differ by host: `make secrets-init` writes 0600, which Docker Desktop (macOS) lets the containers read; on a Linux host redis (uid 999) and the services (uid 65532) cannot, so `ci-secrets` writes 644.

## Configuration
Secrets as `<NAME>_FILE`; `.env.example` holds only non-secret settings.

## Tests
`hadolint`, `docker compose config`, `actionlint`; a real start of the changed service in the agent's own project with a health check.

## Logging and health (operations minimum from T1, #120)
- Two kinds of line share stdout, one JSON object each. Log lines are written through the logging module in `packages/` with a closed field set: `time`, `service`, `sessionId`, `event`, `durationMs`, `costUsd` (the last two where they apply), `segmentId` (the id of a Segment only, #27), `turnId` (the id of a Turn only, #28), and for a model call also `modelRole`, `modelId`, `adapter`, `outcome` and the token fields `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`, `thinkingTokens` (#26); for the Claim Extractor (#29) `claimId`, `candidateId`, `attempts` and `reason`; for the Topic Extractor (#32) `final` (a boolean) and `unknownTags` (a count); `durationMs`, `attempts` and the tokens are whole numbers of at least 0, `segmentId`, `turnId`, `claimId`, `candidateId` and the four labels of a model call match `^[a-z0-9][a-z0-9._:@/-]{0,63}$` (no prose, no names), `reason` is a code `^[A-Za-z][A-Za-z0-9_]{0,63}$` (`kern_unklar`, `refersTo_fehlt`). Metric lines (`event: "metric"`) are not log lines: they have the fixed shape of the contract in `packages/service-kit/README.md` (`name`, `labels`, `values`) and only the model call recorder writes them. Never transcript text, never a segment, never names of private persons, never a secret; retention follows `docs/spec/datenschutz.md` section 2.
- Every service answers `/health` (process up) and `/ready` (dependencies reachable); the edge and the stack tests use them; Compose health checks call `/health`.
- Every model call emits one log event and one metric with tokens and cost, counted per session (ADR 0005; exception until T7: the mock adapter's calls of the Claim Extractor, #29, report no tokens and write only `claim_extractor.call`, ticket #29: „Token and cost fields per call stay T7's“): `createModelCallRecorder` writes the log line `model.called` and the metric line `event: "metric"`, `name: "model.call"` (labels service, model role, model id) and adds the same tokens and cost to the Session counter, the running sum per Session; the quota per account (ADR 0005, #13) keeps its own counter in the account database and takes this record per call as its source; the sink, metrics stack and alerting are the operating model's decision (#56) and stay replaceable.

## Hand tasks (learning path, `docs/process/lernpfad.md`)
- A task the owner builds himself carries the line `Hand: owner` in its ticket section; decided per task in the `cut-tickets` quiz. Everything else stays: manifest and red tests from the test designer before he starts, branch `task/<issue>-<task>`, skill `open-pr`, the review chain with the platform-engineer in the reviewer seat; at gate 2 the owner explains the diff, the reviewer confirms or asks back.
- Coach: the `platform-coach` agent (skill `begleiten`, read-only) explains, asks, hands over the verification commands above and reads the pasted output; it never proposes the finished diff. Every session ends with one learning note as a comment under the task (learned, open).
- Prefer hand tasks off the critical path. On the path the deadline is 7 days after gate 1; then the platform-engineer takes over with a learning note per decision and the owner rebuilds the task later off the path with the same manifest.
- Learning goals, in order: Docker hardening (multi-stage, distroless, non-root, read-only fs); Compose networks by need and the no-cache toolbox build; the CI stack (`nightly.yml`, pinned actions, scanners); later Kubernetes manifests and Terraform. Increment 1: not T1 (explain-back at gate 2 only); the first hand tasks are the nightly no-cache toolbox build and its wiring into the existing `nightly.yml`.
