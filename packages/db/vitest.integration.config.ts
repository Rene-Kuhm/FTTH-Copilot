import { defineConfig } from 'vitest/config';

/**
 * Integration specs for the database layer.
 *
 * The default `vitest.config.ts` excludes these files so unit and coverage
 * runs stay hermetic. That exclusion also kept them from running in the CI
 * integration job, which invokes the default `test` script, so the Prisma
 * models and the store were only ever exercised through mocks.
 *
 * Requires a live PostgreSQL: these specs call `prisma` against a real schema.
 * Each one still guards itself on `DATABASE_URL`, so a misconfigured run skips
 * rather than fails.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/**/*.integration.test.ts',
      'tests/investigation-model.test.ts',
      'tests/investigation-store.integration.test.ts',
      'tests/seed.test.ts',
    ],
  },
});