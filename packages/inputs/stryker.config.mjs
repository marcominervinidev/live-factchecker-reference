// Stage 5 (nightly only, `test:mutation`): do the Input tests check every cutting and reading rule?
// Command runner for the same reason as in packages/service-kit (the Vitest runner reports zero tests under
// Vitest 5 after its first run); it runs the unit suite per mutant.
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
