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
      // Exclude index.ts (re-exports only) and auth-ldap.ts (requires live LDAP server
      // for full coverage; tested via mock-based unit tests but network branches
      // cannot be exercised without a real LDAP connection).
      exclude: ['src/**/*.d.ts', 'src/index.ts', 'src/auth-ldap.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        // 60%: SOC package covers core logic; defensive error-handling branches in
        // notify.ts dispatch (network errors) and auth-ldap.ts LDAP branches
        // require integration-level failure injection.
        branches: 60,
        statements: 80,
      },
    },
  },
});
