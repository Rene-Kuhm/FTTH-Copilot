import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration specs need a live Redis. They run in their own config (and
    // in the CI integration job) so unit and coverage runs stay hermetic.
    exclude: ['tests/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Same convention as packages/db: the coverage gate covers the pure,
      // unit-testable surface. The Redis-backed modules (src/queue.ts,
      // src/worker.ts) are covered by the integration suite instead.
      include: ['src/definitions.ts', 'src/backend-mode.ts', 'src/connection.ts', 'src/options.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
