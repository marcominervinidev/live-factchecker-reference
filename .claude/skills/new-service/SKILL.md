---
name: new-service
description: "Scaffold a new sub-project (service or package) by copying the structure and quality level of the reference sub-project: config validation, health, hardened Dockerfile, Compose entry, tests, path-scoped rules. Use whenever a new service or package is added."
---

# New sub-project

Copy the reference sub-project; do not invent a layout. The reference is named in `.claude/rules/pipeline.md` (file map). If no reference exists yet, stop and say so: the first service is designed by the owner, not scaffolded.

Every new sub-project ends with a `README.md` (sections Purpose, Boundaries, Pitfalls, Commands) and an entry in the covering `.claude/rules/*.md` (`paths:` or file map); `python3 -I tools/check_docs_coverage.py` must pass before the task is reported done.

## Inputs

Name (kebab-case), responsibility in one sentence, which seam it sits behind (ADR 0005), its configuration (non-secret and secret), what it reads and writes.

## Steps

1. **Package**: copy `package.json` (scripts `typecheck`, `build`, `test:unit`, `test:integration`, `test:mutation`), `tsconfig.json`, `vitest.config.ts`, `cucumber.json`, `stryker.config.mjs` from the reference; set the name; keep scripts and exact dependency versions. The root `tsconfig.json` gets no project reference: the root `typecheck` runs every workspace's own `typecheck` (`pnpm -r`), and pnpm picks the workspace up through `pnpm-workspace.yaml`.
2. **Config**: environment only, validated at startup; required values have no defaults; every secret listed so it works as `<NAME>_FILE`.
3. **Entry**: start and stop through the service kit; `/health` (process up) and `/ready` (dependencies reachable, one check per dependency) on every service, because the edge and the stack tests read them; log which providers are configured, never their keys.
4. **Logging**: the JSON logging module from `packages/` (the reference names it), one event per line to stdout with time, service, session id, event, duration and cost; never transcript text, never names of private persons (`.claude/rules/platform.md`, Logging and health). No `console.log` in a service.
5. **Model calls**: every call through the model adapter emits one log event and one metric with tokens and cost (format in `docs/process/tickets.md`, T1 mandatory list); a service that calls no model skips this step and says so in the PR.
6. **Tests**: the startup test (fails fast without required config) and the red tests the test designer wrote for the ticket; nothing else is green before the code exists.
7. **Dockerfile**: copy `services/detection/Dockerfile` (ADR 0011 addendum 2026-10-28); change only the workspace name and paths. The pattern:
   - build stage on the pinned `node` image of `.nvmrc` (by digest), pnpm as the checksummed standalone release (`ADD --checksum`, one stage per architecture), `pnpm install --frozen-lockfile --filter @lfc/<name>...` after copying only the manifests (a `manifests` stage copies all of `packages/` and keeps only the `package.json` files, so no package is named and the install layer stays cached across source changes), then all of `packages/` and the service's `src/` and `pnpm --filter @lfc/<name> run build`: esbuild bundles `src/main.ts` with `@lfc/service-kit` into `dist/main.mjs` (ESM, `createRequire` banner for bundled CommonJS);
   - stage `runtime` (the target `scripts/ci/images.ts` builds): distroless Node of the same major version by digest (its tag names only the major, so a digest refresh can raise the runtime's patch or minor level; `.nvmrc` governs the build stage and the toolbox), `USER 65532:65532`, only `main.mjs`, `CMD ["main.mjs"]`; no `.ts`, no source maps, no shell, no build argument with a secret. A dependency esbuild cannot bundle (native code) is the only reason to copy `node_modules`, and it is named in the PR.
   - Dependabot: the `docker` entry in `.github/dependabot.yml` covers `directories: ['/services/*']`, so the new Dockerfile's digests are refreshed without a new entry; the `node` build image moves only by digest, its version by hand (`.nvmrc`, toolbox and every service Dockerfile together); the distroless runtime's Node version moves with its digest.
8. **Compose**: copy the reference block: image `${LFC_REGISTRY:-lfc}/<name>:${LFC_TAG:-local}` with `build` target `runtime` (the ci-* and acceptance targets set `LFC_TAG=${LFC_TAG:-$COMPOSE_PROJECT_NAME}` for a local build, so no two projects share an image), no host ports (only the edge has one), networks by need (`edge` when the edge routes to it, `data` for Redis), `read_only`, `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, `init`, limits from the environment with small defaults (a 2-vCPU CI runner), a healthcheck on `/health` by `node -e` (distroless has no shell or curl), only its secrets. A route on the edge (`deploy/edge/Caddyfile`) is an outward-visible contract: only with the ticket that names it.
9. **Rules**: add the sub-project to the file map of the matching `.claude/rules/*.md`; a new rules file only when the area is new.
10. **Verify** in your own stack `lfc-<issue>-<task>`: unit tests, lint, hadolint on the Dockerfile, `docker compose config --quiet`, `make ci-secrets ci-stack-up test-api ci-stack-down` (the built image behind the edge), one log line parsed as JSON, Trivy on the image. Capture evidence (skill `evidence`).
