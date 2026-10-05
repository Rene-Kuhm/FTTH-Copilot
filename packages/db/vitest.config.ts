import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Integration tests require a live postgres; skip them in unit-test/coverage runs.
    exclude: ['tests/**/*.integration.test.ts', 'tests/seed.test.ts', 'tests/investigation-model.test.ts', 'tests/investigation-store.integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/auth.ts', 'src/crypto.ts', 'src/cookies.ts', 'src/auth-rate-limit.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
