// dependency-cruiser baseline (stage 0, `pnpm depcruise`, lefthook job `boundaries`).
// Same zone rules as `boundaries` in .fallowrc.json; stays until Fallow boundaries have proven to cover them
// (docs/process/review-tools.md). Regular expressions, not globs (dependency-cruiser rules reference).
// Workspace packages imported by name (`@lfc/...`) resolve through the pnpm symlink to `packages/<name>/...`,
// so the path rules below see the real location.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles make modules load-order dependent; Fallow reports the same as circular-dependencies.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'apps-only-packages',
      severity: 'error',
      comment: 'apps/* may import packages/*, never services/* or tests/*.',
      from: { path: '^apps/' },
      to: { path: '^(services|tests)/' },
    },
    {
      name: 'services-no-other-services',
      severity: 'error',
      comment: 'A service may import packages/* and itself, never another service.',
      from: { path: '^services/([^/]+)/' },
      to: { path: '^services/', pathNot: '^services/$1/' },
    },
    {
      name: 'services-no-apps-or-tests',
      severity: 'error',
      from: { path: '^services/' },
      to: { path: '^(apps|tests)/' },
    },
    {
      name: 'packages-only-packages',
      severity: 'error',
      comment: 'packages/* is the base layer: only packages/*.',
      from: { path: '^packages/' },
      to: { path: '^(apps|services|tests)/' },
    },
    {
      name: 'tests-no-service-or-app-code',
      severity: 'error',
      comment: 'Stage 2a to 4 tests talk to the stack over its contracts; they import packages/* and test helpers only.',
      from: { path: '^tests/' },
      to: { path: '^(services|apps)/' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module nothing imports and that imports nothing is usually dead or a missing entry point.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)(vitest|stryker|playwright|cucumber)\\.config\\.(ts|mts|mjs|cjs|js)$',
          '(^|/)\\.[^/]+\\.(ts|mjs|cjs|js)$',
        ],
      },
      to: {},
    },
  ],
  options: {
    includeOnly: '^(apps|services|packages|tests)/',
    exclude: { path: ['node_modules', '(^|/)dist/', '(^|/)coverage/', '(^|/)\\.stryker-tmp/', '^evals/'] },
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
