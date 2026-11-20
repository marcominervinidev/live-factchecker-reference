// Vitest template for one workspace package (copy to <package>/vitest.config.ts; script `test:unit`:
// `vitest run --coverage`). Stage 1 of docs/process/test-strategy.md; rule .claude/rules/tests.md.
// ci.yml uploads <package>/coverage/lcov.info for SonarQube Cloud, hence the lcov reporter.
// Retries: none locally, at most one in CI (test strategy, "Flaky").
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    retry: process.env.CI ? 1 : 0,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
