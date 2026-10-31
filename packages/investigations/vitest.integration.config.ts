import { defineConfig } from 'vitest/config';

/**
 * Specs que necesitan un Postgres vivo.
 *
 * Se saltean solas si `DATABASE_URL` no apunta a una base, así un run mal
 * configurado saltea en vez de fallar.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.integration.test.ts'],
    testTimeout: 30_000,
  },
});
