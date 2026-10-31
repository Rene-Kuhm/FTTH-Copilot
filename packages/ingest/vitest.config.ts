import { defineConfig } from 'vitest/config';

/**
 * Unit tests of the ingest package.
 *
 * Hermetic on purpose: the spool, the drainer and the syslog receiver are
 * exercised against the filesystem and a loopback UDP socket, never against
 * Postgres. The store is reached through the injected writer, and the
 * integration specs (which need a real database) live in their own config.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration specs need a live database. They run in their own config so
    // unit and coverage runs stay hermetic.
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
