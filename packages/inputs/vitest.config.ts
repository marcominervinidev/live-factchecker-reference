// Stage 1 of @lfc/inputs: unit tests next to their module; the Golden Set windows are cut at run time
// (src/testing/golden.ts). Retries: none locally, at most one in CI (docs/process/test-strategy.md, "Flaky").
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    retry: process.env['CI'] === 'true' ? 1 : 0,
  },
});
