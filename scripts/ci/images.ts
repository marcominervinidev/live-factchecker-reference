// The image list pr.yml, main.yml and nightly.yml build and scan (ticket #25 AC11): one entry per service
// Dockerfile, built at its `runtime` stage with the repository root as context. Other Dockerfiles (the toolbox,
// packages) are not images of the stack.
// Second list (security review S1): `third_party`, every image the stack runs or a service build starts from that
// is not built here (`docker compose config --images` minus lfc/*, plus each pinned FROM of a service Dockerfile);
// pr.yml and nightly.yml scan it with Trivy like the own images.
// Usage: node scripts/ci/images.ts   -> `images=<json>` and `third_party=<json>` to $GITHUB_OUTPUT and stdout
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { output } from './json.ts';

export interface Image {
  readonly name: string;
  readonly dockerfile: string;
  readonly target: string;
}

const SERVICE_DOCKERFILE = /^services\/([^/]+)\/Dockerfile$/;

export function imageList(trackedFiles: readonly string[]): Image[] {
  return trackedFiles.flatMap((dockerfile) => {
    const name = SERVICE_DOCKERFILE.exec(dockerfile)?.[1];
    return name === undefined ? [] : [{ name, dockerfile, target: 'runtime' }];
  });
}

const FROM = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?\s*$/i;

/** References a Dockerfile pulls from a registry: not an earlier stage, not a build argument, not scratch. */
export function dockerfileBases(dockerfile: string): string[] {
  const stages = new Set<string>();
  return dockerfile.split('\n').flatMap((line) => {
    const [, ref, stage] = FROM.exec(line.trim()) ?? [];
    if (ref === undefined) return [];
    // `scratch` is the empty image: nothing to pull, nothing to scan.
    const external = !stages.has(ref) && !ref.includes('$') && ref.toLowerCase() !== 'scratch';
    if (stage !== undefined) stages.add(stage);
    return external ? [ref] : [];
  });
}

/** Sorted, without duplicates: the stack's images not built here, and the bases of the service Dockerfiles. */
export function thirdPartyImages(
  composeImages: readonly string[],
  dockerfiles: readonly string[],
): string[] {
  const foreign = composeImages
    .map((image) => image.trim())
    .filter((image) => image !== '' && !image.startsWith('lfc/'));
  return [...new Set([...foreign, ...dockerfiles.flatMap(dockerfileBases)])].sort();
}

if (import.meta.main) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  const images = imageList(tracked);
  output('images', images);
  // LFC_REGISTRY=lfc: the own images are named lfc/<name> here, whatever registry the caller pushes to.
  const compose = execFileSync('docker', ['compose', 'config', '--images'], {
    encoding: 'utf8',
    env: { ...process.env, LFC_REGISTRY: 'lfc' },
  });
  const dockerfiles = images.map((image) => readFileSync(image.dockerfile, 'utf8'));
  output('third_party', thirdPartyImages(compose.split('\n'), dockerfiles));
}
