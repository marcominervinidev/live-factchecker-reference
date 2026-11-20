// Stage 5 (nightly only, `test:mutation`): do the contract tests check every rule or only parse the fixture?
// Command runner for the same reason as in packages/service-kit (the Vitest runner reports zero tests under
// Vitest 5 after its first run); it runs the unit suite per mutant. Without src/json-schema.test.ts: its byte
// comparison against the committed artefact fails for every mutant that changes the JSON Schema and would count it
// as killed, although no contract test caught it.
export default {
  testRunner: 'command',
  commandRunner: { command: 'node_modules/.bin/vitest run --exclude src/json-schema.test.ts' },
  coverageAnalysis: 'off',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/testing/**', '!src/index.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
