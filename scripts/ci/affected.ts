// The test matrices of ci.yml (ticket #25 AC10): every workspace changed against the base plus its dependents,
// one entry per test stage it defines. Backend: packages/*, services/*, tests/*; frontend: apps/*.
// Stryker (`test:mutation`) runs nightly only and is never an entry. The one source of the CI path rules: the
// docs-only flag of pr.yml (docsOnly, CLI scripts/ci/docs-only.ts) lives here too (ticket #68).
// Usage: node scripts/ci/affected.ts [<git-ref>]   (no ref: every workspace) -> `backend=`, `frontend=`
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { output, record, text } from './json.ts';

export interface Workspace {
  readonly name: string;
  readonly dir: string;
  readonly dependencies: readonly string[];
  readonly scripts: readonly string[];
}

export interface Entry {
  readonly name: string;
  readonly dir: string;
  readonly stage: string;
  readonly script: string;
}

interface Input {
  readonly workspaces: readonly Workspace[];
  /** Repo-relative paths changed against the base; undefined when no base is given. */
  readonly changedFiles?: readonly string[];
}

// A change to these root files can break every workspace: then everything runs, as without a base.
const ROOT_FILES =
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.nvmrc|tsconfig(\.base)?\.json|vitest\.config\.ts)$/;

// Documentation (ticket #68 AC2): docs/, .claude/ and Markdown. Not documentation: the code in .claude/ (all of
// hooks/, and what skills/ and workflows/ hold besides Markdown), and Markdown that an image ships or a model reads
// (under apps/, services/, packages/ only a README.md counts; evals/configs/ holds the prompts). Anything else is code.
const DOCS = /^docs\/|^\.claude\/(?!hooks\/|skills\/|workflows\/)/;
const MARKDOWN = /\.md$/;
const CODE_MARKDOWN =
  /^(apps|services|packages)\/(?!(.+\/)?README\.md$)|^evals\/configs\/|^\.claude\/hooks\//;

/** True when every changed file is documentation; an empty change set is not (fail-safe: everything runs). */
export function docsOnly(files: readonly string[]): boolean {
  const docs = (file: string): boolean =>
    DOCS.test(file) || (MARKDOWN.test(file) && !CODE_MARKDOWN.test(file));
  return files.length > 0 && files.every(docs);
}

/** Repo-relative paths changed since the merge base of ref and HEAD; a rename lists its source and its target. */
export function changedSince(ref: string): string[] {
  // The ref becomes a git argument: a plain ref only, never an option.
  if (!/^[\w.][\w./~^-]*$/.test(ref)) throw new Error(`not a git ref: ${ref}`);
  // Without --no-renames git lists only the target of a rename: code moved under docs/ would count as docs.
  const args = ['diff', '--name-only', '--no-renames', '-z', `${ref}...HEAD`];
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '');
}

export function affectedWorkspaces({ workspaces, changedFiles }: Input): {
  backend: Entry[];
  frontend: Entry[];
} {
  const all = changedFiles?.some((file) => ROOT_FILES.test(file)) ?? true;
  const inside = (w: Workspace): boolean =>
    all || changedFiles?.some((file) => file.startsWith(`${w.dir}/`)) === true;
  const listed = new Set(workspaces.filter(inside).map((w) => w.name));
  let grown = true;
  while (grown) {
    grown = false;
    for (const w of workspaces) {
      if (!listed.has(w.name) && w.dependencies.some((d) => listed.has(d))) {
        listed.add(w.name);
        grown = true;
      }
    }
  }
  const entries = (frontend: boolean): Entry[] =>
    workspaces
      .filter((w) => listed.has(w.name) && w.dir.startsWith('apps/') === frontend)
      .flatMap((w) => {
        const entry = (stage: string, script: string): Entry[] =>
          w.scripts.includes(script) ? [{ name: w.name, dir: w.dir, stage, script }] : [];
        return [...entry('1', 'test:unit'), ...entry(frontend ? '2b' : '2a', 'test:integration')];
      });
  return { backend: entries(false), frontend: entries(true) };
}

// pnpm and git come from PATH, set by the runner or the toolbox image, never by input.
function readWorkspaces(): Workspace[] {
  const listing: unknown = JSON.parse(
    execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { encoding: 'utf8' }),
  );
  if (!Array.isArray(listing)) throw new TypeError('pnpm ls: expected an array');
  const found = listing.map((item: unknown) => {
    const dir = relative(
      process.cwd(),
      text(record(item, 'pnpm ls entry')['path'], 'pnpm ls entry path'),
    );
    const pkg = record(
      JSON.parse(readFileSync(`${dir || '.'}/package.json`, 'utf8')),
      `${dir}/package.json`,
    );
    const deps = Object.keys({
      ...record(pkg['dependencies'] ?? {}, 'dependencies'),
      ...record(pkg['devDependencies'] ?? {}, 'devDependencies'),
    });
    // The root project's own tests are the CI scripts, so it stands for scripts/.
    return {
      name: text(pkg['name'], `${dir}/package.json name`),
      dir: dir || 'scripts',
      dependencies: deps,
      scripts: Object.keys(record(pkg['scripts'] ?? {}, 'scripts')),
    };
  });
  return found.map((w) => ({
    ...w,
    dependencies: w.dependencies.filter((d) => found.some((x) => x.name === d)),
  }));
}

if (import.meta.main) {
  const ref = process.argv[2];
  const changed = ref === undefined ? undefined : changedSince(ref);
  const workspaces = readWorkspaces();
  const result = affectedWorkspaces(
    changed === undefined ? { workspaces } : { workspaces, changedFiles: changed },
  );
  output('backend', result.backend);
  output('frontend', result.frontend);
}
