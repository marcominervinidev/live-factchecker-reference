// StrykerJS template for one workspace package (copy to <package>/stryker.config.mjs; script `test:mutation`:
// `stryker run`). Decision: docs/process/test-strategy.md, rule .claude/rules/tests.md.
//
// Why the command runner and not @stryker-mutator/vitest-runner: the Vitest runner plugin is tied to the Vitest
// major it was built for and broke on Vitest 5 in live-factcheck (lesson carried over). The command runner only
// needs an exit code, so a Vitest upgrade never blocks the mutation run. The price is speed: no per-test
// coverage, so `coverageAnalysis` must be `off` and every mutant runs the package's whole unit suite; that is why
// `timeoutMS` is generous and why the nightly, not the PR, runs the full set (the PR runs `--incremental`).
//
// Keys and defaults from the StrykerJS JSON schema
// (https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/packages/api/schema/stryker-core.json,
// @stryker-mutator/core 10.0.0 on npm, 2026-10-19).

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'command',
  commandRunner: { command: 'pnpm exec vitest run --reporter=dot' },
  coverageAnalysis: 'off',
  timeoutMS: 60000,
  // Four weeks report only (break: null); the retro then sets break to the measured score minus five points.
  thresholds: { high: 90, low: 80, break: null },
  // Production code only; tests, fixtures and declarations are never mutated.
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/**/*.d.ts', '!src/**/__fixtures__/**'],
  // The PR workflow passes `--incremental`; the file lives next to the JSON report under reports/.
  incrementalFile: 'reports/stryker-incremental.json',
  // The workflows collect `**/reports/mutation/mutation.json` (pr.yml, nightly.yml).
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
};
