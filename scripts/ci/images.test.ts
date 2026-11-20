// Stage 1, issue #25 (T1), AC11: the image list that `.github/workflows/pr.yml` builds and scans
// (`node scripts/ci/images.ts`, output `images` as a JSON array of {name, dockerfile, target}).
//
// Public interface these tests define (built in Task 1; the CLI feeds it `git ls-files`, importing runs nothing):
//   imageList(trackedFiles) -> { name, dockerfile, target }[]
// Sources: ticket #25 AC11 and "Contracts" (CI interface); Task 3 shape (multi-stage service Dockerfile with a
// `runtime` stage); the toolbox (`docker/toolbox/Dockerfile`, Task 1) is not a service.
import { describe, expect, it } from 'vitest';

import { imageList } from './images.ts';

const byName = <T extends { name: string }>(items: readonly T[]): T[] => [...items].sort((a, b) => a.name.localeCompare(b.name));

describe('imageList (AC11)', () => {
  it('lists one entry with name, Dockerfile path and runtime target for a service Dockerfile', () => {
    expect(imageList(['services/detection/Dockerfile', 'services/detection/src/main.ts', 'compose.yml'])).toEqual([
      { name: 'detection', dockerfile: 'services/detection/Dockerfile', target: 'runtime' },
    ]);
  });

  it('lists one entry per service Dockerfile', () => {
    expect(byName(imageList(['services/detection/Dockerfile', 'services/checking/Dockerfile', 'services/checking/package.json']))).toEqual([
      { name: 'checking', dockerfile: 'services/checking/Dockerfile', target: 'runtime' },
      { name: 'detection', dockerfile: 'services/detection/Dockerfile', target: 'runtime' },
    ]);
  });

  it('is empty when no service has a Dockerfile', () => {
    expect(imageList(['services/detection/src/main.ts', 'packages/service-kit/src/logger.ts', 'README.md'])).toEqual([]);
  });

  it('leaves out Dockerfiles that do not belong to a service', () => {
    expect(imageList(['docker/toolbox/Dockerfile', 'packages/service-kit/Dockerfile'])).toEqual([]);
  });
});
