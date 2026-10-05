import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        // 68%: SOC package covers core logic; defensive error-handling branches in
        // notify.ts dispatch (network errors) require integration-level failure injection.
        branches: 68,
        statements: 80,
      },
    },
  },
});
