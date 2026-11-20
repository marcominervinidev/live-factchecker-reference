// Own unit tests of the implementer (ticket #68, review round 2, B1): changedSince lists both sides of a rename,
// so code moved under docs/ is still code and the docs-only flag stays false. Runs git in a throwaway repository.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { changedSince, docsOnly } from './affected.ts';

let repo = '';
let home = '';
// A git hook or an outer git command exports these; they would point every git call at the outer repository.
const OUTER_GIT = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'] as const;
const saved: Partial<Record<(typeof OUTER_GIT)[number], string>> = {};
const gitEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !(OUTER_GIT as readonly string[]).includes(key)),
  );

const git = (...args: string[]): void => {
  execFileSync(
    'git',
    [
      '-c',
      'user.name=ci',
      '-c',
      'user.email=ci@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: repo, stdio: 'ignore', env: gitEnv() },
  );
};
const write = (path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
// changedSince runs git in the working directory, as the CLIs do in CI.
const changedIn = (ref: string): string[] => {
  const before = process.cwd();
  process.chdir(repo);
  try {
    return changedSince(ref).sort();
  } finally {
    process.chdir(before);
  }
};

beforeEach(() => {
  // changedSince inherits process.env, so the outer variables leave it for the test and come back afterwards.
  for (const key of OUTER_GIT) {
    const value = process.env[key];
    if (value !== undefined) saved[key] = value;
    Reflect.deleteProperty(process.env, key);
  }
  home = process.cwd();
  repo = mkdtempSync(join(tmpdir(), 'lfc-changed-since-'));
  git('init', '-q', '-b', 'main');
  write(
    'services/detection/src/main.ts',
    'export const detection = 1;\nexport const name = "detection";\n',
  );
  write('docs/process/tickets.md', '# Tickets\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('branch', 'base');
});

afterEach(() => {
  process.chdir(home);
  rmSync(repo, { recursive: true, force: true });
  for (const key of OUTER_GIT) {
    const value = saved[key];
    if (value !== undefined) process.env[key] = value;
    Reflect.deleteProperty(saved, key);
  }
});

describe('changedSince (ticket #68, B1)', () => {
  it('lists the source and the target of a rename from services/ to docs/', () => {
    git('mv', 'services/detection/src/main.ts', 'docs/main.md');
    git('commit', '-qm', 'move code under docs');
    expect(changedIn('base')).toEqual(['docs/main.md', 'services/detection/src/main.ts']);
  });

  it('keeps the docs-only flag false for code renamed under docs/', () => {
    git('mv', 'services/detection/src/main.ts', 'docs/main.md');
    git('commit', '-qm', 'move code under docs');
    expect(docsOnly(changedIn('base'))).toBe(false);
  });

  it('keeps a rename inside docs/ documentation only', () => {
    git('mv', 'docs/process/tickets.md', 'docs/process/tickets-v2.md');
    git('commit', '-qm', 'rename a doc');
    expect(docsOnly(changedIn('base'))).toBe(true);
  });

  it('lists a deleted file', () => {
    git('rm', '-q', 'services/detection/src/main.ts');
    git('commit', '-qm', 'delete code');
    expect(changedIn('base')).toEqual(['services/detection/src/main.ts']);
  });

  it('ignores GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE of an outer git command', () => {
    git('mv', 'services/detection/src/main.ts', 'docs/main.md');
    git('commit', '-qm', 'move code under docs');
    process.env['GIT_DIR'] = join(home, 'no-such-git-dir');
    process.env['GIT_INDEX_FILE'] = join(home, 'no-such-index');
    process.env['GIT_WORK_TREE'] = home;
    try {
      git('status', '--porcelain');
    } finally {
      for (const key of OUTER_GIT) Reflect.deleteProperty(process.env, key);
    }
    expect(changedIn('base')).toEqual(['docs/main.md', 'services/detection/src/main.ts']);
  });

  it('refuses a ref that would be a git option', () => {
    expect(() => changedIn('--output=x')).toThrow('not a git ref');
  });
});
