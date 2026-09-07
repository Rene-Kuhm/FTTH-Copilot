/**
 * Shared ESLint v9 flat config for non-Next packages.
 *
 * Each non-web package under `packages/*` extends this file with
 * `import sharedConfig from '../../eslint.config.shared.mjs'`. The
 * `apps/web` package keeps its own `eslint.config.mjs` because it
 * needs `eslint-config-next/core-web-vitals`.
 *
 * Rules pinned here are deliberately lenient to avoid breaking the
 * existing surface on first install:
 *
 *   - `@typescript-eslint/no-explicit-any` as a WARNING. The current
 *     codebase has a handful of `: any` and `as any` annotations that
 *     would otherwise block lint. Future PRs can tighten this to error.
 *   - `@typescript-eslint/no-unused-vars` as a WARNING. Several test
 *     files declare variables that are referenced through vi.mock /
 *     vi.hoisted / shared helpers, which the default parser flags as
 *     unused. Migrating to error is a follow-up cleanup.
 *   - `@typescript-eslint/no-unused-expressions` as ERROR. This is a
 *     real bug class (left-over `someFlag && doSomething()` debug
 *     calls) and the codebase is already clean against it.
 *   - No stylistic rules. Prettier config (separate effort) handles
 *     formatting.
 *
 * The config does NOT depend on `eslint-config-next` and does NOT
 * extend any framework-specific ruleset. It is the lowest common
 * denominator for the TypeScript packages.
 */

import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'src/generated/**', // Prisma client output
      '**/*.test.ts',     // tests use vi.fn() return values in helpers
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'error',
    },
  },
];
