// Stage 1 for the second list of scripts/ci/images.ts (security review S1 of #25 task 3): the third-party images
// Trivy scans next to the own ones. Not a frozen test; written with the change.
import { describe, expect, it } from 'vitest';

import { dockerfileBases, thirdPartyImages } from './images.ts';

const DOCKERFILE = [
  'ARG TARGETARCH',
  'FROM node:24.22.1-bookworm-slim@sha256:aaa AS node',
  'FROM node AS pnpm-amd64',
  '# hadolint ignore=DL3006',
  'FROM pnpm-${TARGETARCH} AS build',
  'FROM --platform=linux/amd64 gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bbb AS runtime',
].join('\n');

describe('dockerfileBases', () => {
  it('lists the registry images a Dockerfile starts from, not its own stages or build arguments', () => {
    expect(dockerfileBases(DOCKERFILE)).toEqual([
      'node:24.22.1-bookworm-slim@sha256:aaa',
      'gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bbb',
    ]);
  });

  it('skips FROM scratch, the empty image', () => {
    expect(
      dockerfileBases('FROM golang:1@sha256:eee AS build\nFROM scratch AS runtime\nFROM SCRATCH'),
    ).toEqual(['golang:1@sha256:eee']);
  });

  it('is empty for a file without FROM', () => {
    expect(dockerfileBases('# no image here\nRUN true')).toEqual([]);
  });
});

describe('thirdPartyImages', () => {
  it('drops the own lfc/* images and blank lines, merges the Dockerfile bases, sorted and without duplicates', () => {
    const compose = [
      'redis:8@sha256:ccc',
      'lfc/detection:local',
      'caddy:2@sha256:ddd',
      '',
      'redis:8@sha256:ccc',
    ];
    expect(thirdPartyImages(compose, [DOCKERFILE, DOCKERFILE])).toEqual([
      'caddy:2@sha256:ddd',
      'gcr.io/distroless/nodejs24-debian13:nonroot@sha256:bbb',
      'node:24.22.1-bookworm-slim@sha256:aaa',
      'redis:8@sha256:ccc',
    ]);
  });

  it('is empty when the stack runs only own images and no service has a Dockerfile', () => {
    expect(thirdPartyImages(['lfc/detection:local'], [])).toEqual([]);
  });
});
