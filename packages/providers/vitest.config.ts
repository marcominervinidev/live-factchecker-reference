// Stage 1 of @lfc/providers: unit tests next to their module; the LLM boundary is a scripted adapter.
// Retries: none locally, at most one in CI (docs/process/test-strategy.md, "Flaky").
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    retry: process.env['CI'] === 'true' ? 1 : 0,
  },
});
