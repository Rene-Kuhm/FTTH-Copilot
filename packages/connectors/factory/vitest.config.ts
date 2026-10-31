import { defineConfig } from 'vitest/config';

/**
 * Unit tests of the connector factory.
 *
 * Hermetic on purpose: the factory decrypts credentials and builds live
 * clients, so every boundary (the KMS helper and the three NMS clients) is
 * mocked. Nothing here needs a database or a network.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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
