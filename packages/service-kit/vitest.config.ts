// Stage 1 of @lfc/service-kit: unit tests next to their module.
// Retries: none locally, at most one in CI (docs/process/test-strategy.md, "Flaky").
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    retry: process.env['CI'] === 'true' ? 1 : 0,
  },
});
