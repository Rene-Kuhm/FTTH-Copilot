import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/load/*.load.ts'],
    pool: 'forks',
    execArgv: ['--expose-gc'],
    hookTimeout: 30_000,
    testTimeout: 90_000,
  },
});
