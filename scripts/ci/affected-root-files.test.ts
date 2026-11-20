// Own unit tests of the implementer (review round 2 of #25 task 1, W4): a change to a root file that every
// workspace builds on (lockfile, tsconfig, ...) selects every workspace, like a run without a base; a file of the
// same name inside a directory is not a root file.
import { describe, expect, it } from 'vitest';

import { affectedWorkspaces, type Workspace } from './affected.ts';

const kit: Workspace = {
  name: '@lfc/service-kit',
  dir: 'packages/service-kit',
  dependencies: [],
  scripts: ['test:unit'],
};
const web: Workspace = {
  name: '@lfc/web',
  dir: 'apps/web',
  dependencies: [],
  scripts: ['test:unit'],
};
const names = (files: readonly string[]): string[] => {
  const { backend, frontend } = affectedWorkspaces({ workspaces: [kit, web], changedFiles: files });
  return [...backend, ...frontend].map((e) => e.name).sort();
};

describe('affectedWorkspaces: root files', () => {
  it.each([
    'pnpm-lock.yaml',
    'package.json',
    'pnpm-workspace.yaml',
    '.nvmrc',
    'tsconfig.json',
    'tsconfig.base.json',
    'vitest.config.ts',
  ])('selects every workspace when %s changes', (file) => {
    expect(names(['docs/notes.md', file])).toEqual(['@lfc/service-kit', '@lfc/web']);
  });

  it.each([
    'x/package.json',
    'docs/tsconfig.json',
    'scripts/vitest.config.ts',
    'tools/pnpm-lock.yaml',
  ])('treats %s as no root file', (file) => {
    expect(names([file])).toEqual([]);
  });
});
