# Toolbox: the only place where Node, pnpm and the dev CLIs run (scripts/tb, the agent hooks).
# Node: the version comes from .nvmrc as NODE_VERSION (scripts/tb, Makefile) and must match this pinned image.
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205

ARG NODE_VERSION
# pnpm equals "packageManager" in package.json; standalone release build, checksums as in live-factcheck.
ARG PNPM_VERSION=12.6.0
ARG PNPM_SHA256_ARM64=973af2b3eb9509416cf889a7336705062c936407d5fda07298814e7532f5dea1
ARG PNPM_SHA256_AMD64=3f4c66f668d0e84219679982d095b30da68325e1fac9284e7f5dc1584bd3d13e
ARG TARGETARCH

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN if [ "v${NODE_VERSION}" != "$(node --version)" ]; then \
      echo "toolbox: .nvmrc says '${NODE_VERSION}', the base image has $(node --version)" >&2; exit 1; \
    fi

# git for pnpm filters, python3 and jq for the repository checks (tools/, .claude/hooks), procps for `ps`, which
# Stryker needs to end its test runner processes, make for the tool tests that run the Makefile in a throwaway
# copy (tools/tests/test_make_targets.py, test_docker_clean.py).
# DL3008: Debian's security updates replace pinned versions within days; the base image is pinned by
# digest instead, and the nightly no-cache build (T10) refreshes these packages.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git jq make procps python3 \
 && rm -rf /var/lib/apt/lists/*

# pnpm verified against the pinned checksum; the chmod drops setuid/setgid and group/other write bits.
RUN case "${TARGETARCH}" in \
      arm64) asset=linux-arm64; sum="${PNPM_SHA256_ARM64}" ;; \
      amd64) asset=linux-x64; sum="${PNPM_SHA256_AMD64}" ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --proto '=https' --tlsv1.2 -o /tmp/pnpm.tgz \
      "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-${asset}.tar.gz" \
 && echo "${sum}  /tmp/pnpm.tgz" | sha256sum -c - \
 && mkdir -p /usr/local/lib/pnpm /workspace \
 && tar -xzf /tmp/pnpm.tgz -C /usr/local/lib/pnpm --no-same-owner \
 && chmod -R u-s,g-ws,o-wt /usr/local/lib/pnpm \
 && ln -s /usr/local/lib/pnpm/pnpm /usr/local/bin/pnpm \
 && rm /tmp/pnpm.tgz \
 && chown node:node /workspace

ENV FALLOW_TELEMETRY_DISABLED=1

# Numeric uid of the image's "node" user, non-root.
USER 1000:1000
WORKDIR /workspace
# The repository is bind-mounted and owned by the host user; git accepts it there only (compose.yml adds the
# common dir of a worktree).
RUN git config --global --add safe.directory /workspace

CMD ["sleep", "infinity"]
