# Image of the detection service; the pattern every Node service copies (skill new-service, ADR 0011 addendum
# 2026-10-28). Context: the repository root (scripts/ci/images.ts, compose.yml). The build stage installs from the
# lockfile and bundles src/main.ts with esbuild, @lfc/service-kit included; the runtime stage holds that one bundle
# on distroless Node: no shell, no package manager, no .ts sources, no source maps, non-root. No build argument
# carries a secret.
ARG TARGETARCH

# Node equals .nvmrc (the toolbox pins the same image; Dependabot moves only its digest, never its version).
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS node

# pnpm equals "packageManager" in package.json: the standalone release build, verified like in the toolbox.
FROM node AS pnpm-amd64
ADD --checksum=sha256:3f4c66f668d0e84219679982d095b30da68325e1fac9284e7f5dc1584bd3d13e \
    https://github.com/pnpm/pnpm/releases/download/v12.6.0/pnpm-linux-x64.tar.gz /tmp/pnpm.tgz

FROM node AS pnpm-arm64
ADD --checksum=sha256:973af2b3eb9509416cf889a7336705062c936407d5fda07298814e7532f5dea1 \
    https://github.com/pnpm/pnpm/releases/download/v12.6.0/pnpm-linux-arm64.tar.gz /tmp/pnpm.tgz

# Every package manifest without naming one: all of packages/ (.dockerignore drops node_modules and dist), then
# everything but the package.json files deleted. A source change reruns this stage, but its output stays the same,
# so the install layer below is reused until the lockfile or a manifest changes.
FROM node AS manifests
WORKDIR /repo
COPY packages/ packages/
RUN find packages -type f ! -name package.json -delete

# DL3006: pnpm-amd64 and pnpm-arm64 are the stages above, not registry images.
# hadolint ignore=DL3006
FROM pnpm-${TARGETARCH} AS build
RUN mkdir -p /usr/local/lib/pnpm \
 && tar -xzf /tmp/pnpm.tgz -C /usr/local/lib/pnpm --no-same-owner \
 && ln -s /usr/local/lib/pnpm/pnpm /usr/local/bin/pnpm \
 && rm /tmp/pnpm.tgz
WORKDIR /repo
# Manifests first, so the install layer is reused until the lockfile or a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=manifests /repo/packages/ packages/
COPY services/detection/package.json services/detection/
RUN pnpm install --frozen-lockfile --filter @lfc/detection...
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY services/detection/src services/detection/src
RUN pnpm --filter @lfc/detection run build

# Stage dev, only for `make dev` (compose.dev.yml mounts the sources read-only over the copied ones): node runs
# src/main.ts by type stripping with the install above and restarts on a change. Not distroless, never built in CI
# (scripts/ci/images.ts builds `runtime`); non-root as the node image's user `node` (1000). It stays before `runtime`,
# so a build without --target still gets the runtime image (the last stage is the default target).
FROM build AS dev
WORKDIR /repo/services/detection
USER 1000:1000
EXPOSE 8080
CMD ["node", "--watch", "src/main.ts"]

# Distroless Node 24 (24.22.1 when pinned), user nonroot (65532); the entrypoint is node itself. The tag names only the
# major version: a digest refresh (Dependabot) can raise the Node patch or minor level of the runtime; .nvmrc is the
# source for the build stage and the toolbox, not for this image.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:b8cec4b2f2126ff7bd034ec9ac207ffb3272667dfdc48376e3b035d3270549ba AS runtime
WORKDIR /app
COPY --from=build /repo/services/detection/dist/main.mjs ./main.mjs
# The Claim Extractor's prompt, exactly this one file and never compiled into the bundle (#29 AC17; spec 1: prompts are
# taken over unchanged); CLAIM_EXTRACTOR_PROMPT_FILE names it (compose.yml).
COPY evals/configs/prompts/claim_extractor.v2.de.txt ./prompts/claim_extractor.v2.de.txt
# The Topic Extractor's prompt, the same way (#32; TOPIC_EXTRACTOR_PROMPT_FILE, compose.yml).
COPY evals/configs/prompts/topic_extractor.de.txt ./prompts/topic_extractor.de.txt
USER 65532:65532
ENV NODE_ENV=production
EXPOSE 8080
CMD ["main.mjs"]
