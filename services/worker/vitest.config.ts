import { defineConfig } from 'vitest/config';

/**
 * Unit tests of the worker.
 *
 * Hermetic on purpose: nothing here needs a live Redis. The queue
 * consumption itself (`src/workers.ts`) talks to BullMQ, so it is exercised
 * by the integration suite of `packages/jobs`, not by this config.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // Same convention as packages/jobs: the coverage gate covers the pure,
      // unit-testable surface. The process entrypoint (src/index.ts) and the
      // BullMQ fleet (src/workers.ts) need a live Redis to run.
      include: ['src/health.ts', 'src/registry.ts'],
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
