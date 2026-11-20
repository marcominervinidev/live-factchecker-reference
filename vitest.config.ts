// Stage 1 for the root project: the CI scripts under scripts/ (workspaces have their own config).
// Retries: none locally, at most one in CI (docs/process/test-strategy.md, "Flaky").
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
    retry: process.env['CI'] === 'true' ? 1 : 0,
  },
});
