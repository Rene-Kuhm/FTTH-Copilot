import { defineConfig } from 'vitest/config';

/**
 * Unit tests of the scheduler package.
 *
 * Hermetic on purpose: every boundary (Prisma, the connector factory, the
 * monitoring and SOC packages) is mocked, so nothing here needs a database or
 * an NMS. The queue wiring lives in `services/worker` and is exercised by the
 * integration suite there, not by this config.
 */
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
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
