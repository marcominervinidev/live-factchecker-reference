// Stage 5 (nightly only, `test:mutation`): do the unit tests check the rules of callValidated and the mock or only
// run the code? Command runner for the same reason as in packages/service-kit (the Vitest runner of Stryker reports
// zero tests under Vitest 5 after its first run); it runs the whole unit suite per mutant. In place, not in a
// sandbox: the frozen mock test reads a Golden Set labels.jsonl four directories above its own file
// (src/mock/mock-claim-extractor.test.ts, ROOT), which a sandbox under .stryker-tmp/ moves out of reach. Stryker
// restores the mutated files after the run.
export default {
  testRunner: 'command',
  inPlace: true,
  commandRunner: { command: 'node_modules/.bin/vitest run' },
  coverageAnalysis: 'off',
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/index.ts'],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
