// Stage 1 of @lfc/acceptance-tests: the runner's own tests (runner/*.test.ts), no stack. Each test file runs in its
// own worker, so each can start its own Cucumber run (support code registers once per process).
// Retries: none locally, at most one in CI (docs/process/test-strategy.md, "Flaky").
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['runner/**/*.test.ts'],
    environment: 'node',
    retry: process.env['CI'] === 'true' ? 1 : 0,
  },
});
