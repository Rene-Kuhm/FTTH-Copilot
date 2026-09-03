import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The Next.js route imports server-only modules (next/headers, @ftth-copilot/db)
    // that should never execute during unit tests. They are replaced by `vi.mock`
    // inside each test file, but we still need to make sure the runner does not
    // try to load the Prisma client or scan a Postgres connection.
    setupFiles: [],
  },
  resolve: {
    alias: {
      // Tests live under apps/web/tests/**; the source tree is apps/web/{app,components,lib}.
      '@': resolve(__dirname),
    },
  },
});
