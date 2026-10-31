import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Las specs que necesitan Postgres viven en su propio config, igual que en
    // `packages/db`: así el run unitario no carga el cliente de Prisma.
    exclude: ['tests/**/*.integration.test.ts'],
  },
});
