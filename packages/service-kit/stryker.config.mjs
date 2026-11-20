// Stage 5 (nightly only, `test:mutation`): do the unit tests check the rules or only run the code?
// Command runner: the Vitest runner of Stryker reports zero tests under Vitest 5 after its first run
// (seen in live-factcheck); the command runner runs the whole unit suite per mutant.
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run' },
  coverageAnalysis: 'off',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/testing/**', '!src/index.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
