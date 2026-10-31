import { defineConfig } from 'vitest/config';

/**
 * Integration specs for the job queue.
 *
 * The default `vitest.config.ts` excludes these files so unit and coverage
 * runs stay hermetic (same split `packages/db` uses for Postgres).
 *
 * Requires a live Redis: point `JOBS_TEST_REDIS_URL` at it. Each suite still
 * guards itself on that variable, so a misconfigured run skips rather than
 * fails.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.integration.test.ts'],
    testTimeout: 30_000,
  },
});
