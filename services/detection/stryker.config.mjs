// Stage 5 (nightly only, `test:mutation`): do the unit tests check the rules or only run the code?
// Command runner: the Vitest runner of Stryker reports zero tests under Vitest 5 after its first run
// (seen in live-factcheck); the command runner runs the whole unit suite per mutant. Without src/testing: it holds
// the test designer's frozen helper, test code and not product code; a quiet run on 2026-10-30 counted 210 of 952
// mutants there. In place, not in a sandbox (as packages/providers, owner decision C13: "Stryker mit `inPlace:
// true`"): src/claim-extractor/prompt.test.ts reads the instruction file four directories above its own file, which a
// sandbox under .stryker-tmp/ moves out of reach. Stryker restores the mutated files after the run.
export default {
  testRunner: 'command',
  inPlace: true,
  commandRunner: { command: 'node_modules/.bin/vitest run' },
  coverageAnalysis: 'off',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/testing/**'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
