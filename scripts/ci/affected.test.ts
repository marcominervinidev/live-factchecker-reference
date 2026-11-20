// Stage 1, issue #25 (T1), AC10: the affected-workspace list that `.github/workflows/ci.yml` turns into the
// backend and frontend test matrices (`node scripts/ci/affected.ts [<base>]`, outputs `backend` and `frontend` as
// JSON arrays of {name, dir, stage, script}).
//
// Public interface these tests define (built in Task 1; the CLI wraps it, importing the module runs nothing):
//   affectedWorkspaces({ workspaces, changedFiles? }) -> { backend: Entry[]; frontend: Entry[] }
//   workspaces:   { name, dir, dependencies: workspace names it depends on, scripts: script names it defines }[]
//   changedFiles: repo-relative paths changed against the base; undefined = no base given
//   Entry:        { name, dir, stage, script }, one per test stage a workspace defines:
//                 `test:unit` -> stage "1"; `test:integration` -> "2a" in the backend, "2b" in the frontend.
// Sources: ticket #25 AC10 and "Contracts" (CI interface); ci.yml (stage values '1', '2a', '2b'; job split);
// docs/process/test-strategy.md (2a backend, 2b frontend under apps/; Stryker nightly only, so `test:mutation` is
// never a push matrix entry); CLAUDE.md "Stack" (apps/*, services/*, packages/*).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { affectedWorkspaces } from './affected.ts';

interface Workspace {
  readonly name: string;
  readonly dir: string;
  readonly dependencies: readonly string[];
  readonly scripts: readonly string[];
}

interface Entry {
  readonly name: string;
  readonly dir: string;
  readonly stage: string;
  readonly script: string;
}

const contracts: Workspace = { name: '@lfc/contracts', dir: 'packages/contracts', dependencies: [], scripts: ['test:unit', 'test:mutation'] };
const kit: Workspace = { name: '@lfc/service-kit', dir: 'packages/service-kit', dependencies: [], scripts: ['test:unit', 'test:mutation'] };
const kitTesting: Workspace = { name: '@lfc/service-kit-testing', dir: 'packages/service-kit-testing', dependencies: [], scripts: ['test:unit'] };
const detection: Workspace = {
  name: '@lfc/detection',
  dir: 'services/detection',
  dependencies: ['@lfc/service-kit', '@lfc/contracts'],
  scripts: ['build', 'test:unit', 'test:integration', 'test:mutation'],
};
const web: Workspace = { name: '@lfc/web', dir: 'apps/web', dependencies: ['@lfc/contracts'], scripts: ['dev', 'test:unit', 'test:integration'] };
const REPO: readonly Workspace[] = [contracts, kit, kitTesting, detection, web];

const entry = (w: Workspace, stage: string, script: string): Entry => ({ name: w.name, dir: w.dir, stage, script });
const byKey = (a: Entry, b: Entry): number => `${a.name} ${a.stage}`.localeCompare(`${b.name} ${b.stage}`);
const sorted = (entries: readonly Entry[]): Entry[] => [...entries].sort(byKey);

function run(changedFiles?: readonly string[], workspaces: readonly Workspace[] = REPO): { backend: Entry[]; frontend: Entry[] } {
  const result = changedFiles === undefined ? affectedWorkspaces({ workspaces }) : affectedWorkspaces({ workspaces, changedFiles });
  return { backend: sorted(result.backend), frontend: sorted(result.frontend) };
}

describe('affectedWorkspaces: examples (AC10)', () => {
  it('lists a changed package with every workspace that depends on it, one entry per test stage', () => {
    expect(run(['packages/service-kit/src/logger.ts'])).toEqual({
      backend: sorted([entry(kit, '1', 'test:unit'), entry(detection, '1', 'test:unit'), entry(detection, '2a', 'test:integration')]),
      frontend: [],
    });
  });

  it('does not list the dependencies of a changed workspace, only its dependents', () => {
    expect(run(['services/detection/src/main.ts'])).toEqual({
      backend: sorted([entry(detection, '1', 'test:unit'), entry(detection, '2a', 'test:integration')]),
      frontend: [],
    });
  });

  it('splits dependents into backend and frontend, with stage 2b for a frontend integration script', () => {
    expect(run(['packages/contracts/src/segment.ts'])).toEqual({
      backend: sorted([entry(contracts, '1', 'test:unit'), entry(detection, '1', 'test:unit'), entry(detection, '2a', 'test:integration')]),
      frontend: sorted([entry(web, '1', 'test:unit'), entry(web, '2b', 'test:integration')]),
    });
  });

  it('matches a changed file to a workspace by whole directory, not by name prefix', () => {
    expect(run(['packages/service-kit-testing/src/fake-clock.ts'])).toEqual({
      backend: [entry(kitTesting, '1', 'test:unit')],
      frontend: [],
    });
  });

  it('lists every workspace and never a mutation run when no base is given', () => {
    expect(run(undefined)).toEqual({
      backend: sorted([
        entry(contracts, '1', 'test:unit'),
        entry(kit, '1', 'test:unit'),
        entry(kitTesting, '1', 'test:unit'),
        entry(detection, '1', 'test:unit'),
        entry(detection, '2a', 'test:integration'),
      ]),
      frontend: sorted([entry(web, '1', 'test:unit'), entry(web, '2b', 'test:integration')]),
    });
  });

  it('yields two empty lists for a change set of docs only', () => {
    expect(run(['docs/process/tickets.md', 'docs/adr/0012-segment-contract.md'])).toEqual({ backend: [], frontend: [] });
  });

  it('yields two empty lists for an empty change set', () => {
    expect(run([])).toEqual({ backend: [], frontend: [] });
  });
});

// Generated monorepos: workspace i may depend only on workspaces before it (pnpm forbids cycles); every workspace
// defines test:unit, some also test:integration and test:mutation.
const KINDS = ['packages', 'services', 'apps'] as const;
const repoAndChange = fc
  .array(
    fc.record({
      kind: fc.constantFrom(...KINDS),
      dependsOn: fc.array(fc.nat(), { maxLength: 4 }),
      integration: fc.boolean(),
      mutation: fc.boolean(),
    }),
    { minLength: 1, maxLength: 8 },
  )
  .chain((specs) => {
    const workspaces: Workspace[] = specs.map((s, i) => ({
      name: `@lfc/w${i}`,
      dir: `${s.kind}/w${i}`,
      dependencies: i === 0 ? [] : [...new Set(s.dependsOn.map((d) => `@lfc/w${d % i}`))],
      scripts: ['test:unit', ...(s.integration ? ['test:integration'] : []), ...(s.mutation ? ['test:mutation'] : [])],
    }));
    const files = workspaces.map((w) => `${w.dir}/src/index.ts`);
    return fc.record({
      workspaces: fc.constant(workspaces),
      changed: fc.subarray(files),
      docs: fc.subarray(['docs/architecture.md', 'docs/adr/0012-x.md', 'CONTEXT.md']),
    });
  });

const names = (r: { backend: Entry[]; frontend: Entry[] }): Set<string> => new Set([...r.backend, ...r.frontend].map((e) => e.name));
const changedNames = (workspaces: readonly Workspace[], files: readonly string[]): Set<string> =>
  new Set(workspaces.filter((w) => files.some((f) => f.startsWith(`${w.dir}/`))).map((w) => w.name));

describe('affectedWorkspaces: properties (AC10)', () => {
  it('contains every changed workspace', () => {
    fc.assert(
      fc.property(repoAndChange, ({ workspaces, changed }) => {
        const listed = names(run(changed, workspaces));
        for (const name of changedNames(workspaces, changed)) expect(listed).toContain(name);
      }),
    );
  });

  it('is closed under dependents: whatever depends on a listed workspace is listed too', () => {
    fc.assert(
      fc.property(repoAndChange, ({ workspaces, changed }) => {
        const listed = names(run(changed, workspaces));
        for (const w of workspaces) {
          if (w.dependencies.some((d) => listed.has(d))) expect(listed).toContain(w.name);
        }
      }),
    );
  });

  it('lists nothing else: each listed workspace is changed or depends on a listed one', () => {
    fc.assert(
      fc.property(repoAndChange, ({ workspaces, changed }) => {
        const listed = names(run(changed, workspaces));
        const direct = changedNames(workspaces, changed);
        for (const w of workspaces.filter((x) => listed.has(x.name))) {
          expect(direct.has(w.name) || w.dependencies.some((d) => listed.has(d))).toBe(true);
        }
      }),
    );
  });

  it('puts apps/* into frontend and packages/*, services/* into backend, one entry per defined test stage', () => {
    fc.assert(
      fc.property(repoAndChange, ({ workspaces }) => {
        const result = run(undefined, workspaces);
        const expected = (frontend: boolean): Entry[] =>
          sorted(
            workspaces
              .filter((w) => w.dir.startsWith('apps/') === frontend)
              .flatMap((w) => [
                entry(w, '1', 'test:unit'),
                ...(w.scripts.includes('test:integration') ? [entry(w, frontend ? '2b' : '2a', 'test:integration')] : []),
              ]),
          );
        expect(result).toEqual({ backend: expected(false), frontend: expected(true) });
      }),
    );
  });

  it('ignores files outside every workspace and the order of the change set', () => {
    fc.assert(
      fc.property(repoAndChange, ({ workspaces, changed, docs }) => {
        const plain = run(changed, workspaces);
        expect(run([...docs, ...changed].reverse(), workspaces)).toEqual(plain);
      }),
    );
  });
});
