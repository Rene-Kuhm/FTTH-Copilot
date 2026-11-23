/**
 * Security-focused ESLint v9 flat config (SAST gate).
 *
 * Scanned targets:
 *   - apps/web/**
 *   - packages/<pkg>/src/**
 *   - packages/connectors/<pkg>/src/**
 *   - services/<svc>/src/**
 *
 * Usage: `pnpm security:sast:eslint` (or via `pnpm security:sast`).
 *
 * Policy:
 *   - Every rule kept at `error` is a hard SAST gate. We do NOT weaken rules to
 *     hide real findings in application code.
 *   - Every disabled rule carries a codebase-specific rationale explaining why
 *     the rule produces non-actionable matches on THIS repository.
 */
import security from 'eslint-plugin-security';
import tsParser from '@typescript-eslint/parser';

/**
 * Minimal no-op definitions for React/Next rules referenced by inline
 * `eslint-disable` comments in `apps/web/components/`. Keeping these stubs
 * avoids pulling `eslint-config-next` into the root security config while
 * still allowing `eslint --config eslint.config.security.mjs` to run standalone.
 */
const noopRule = { meta: {}, create: () => ({}) };

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      'packages/db/src/generated/**',
      'apps/web/public/sw.js',
      'apps/web/public/workbox-*.js',
      'apps/web/android/**',
      'apps/web/src-tauri/**',
      'apps/web/next-env.d.ts',
      '**/__snapshots__/**',
      '**/*.snap',
      '**/*.golden.json',
      '**/fixtures/**',
      '**/tests/fixtures/**',
    ],
  },
  {
    files: [
      'apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      'packages/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      'packages/connectors/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
      'services/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
    ],
    linterOptions: {
      // Non-security packages suppress `no-console` inline; those directives
      // are irrelevant under the security-only ruleset.
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      security,
      'react-hooks': {
        rules: {
          'set-state-in-effect': noopRule,
          'exhaustive-deps': noopRule,
        },
      },
      '@next/next': {
        rules: {
          'no-img-element': noopRule,
        },
      },
    },
    rules: {
      // ── Core code-execution & injection gates ─────────────────────────────
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-child-process': 'error',
      'security/detect-non-literal-require': 'error',

      // ── Crypto, randomness, buffers, CSRF & Trojan Source gates ───────────
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-invisible-characters': 'error',
      'security/detect-bidi-characters': 'error',

      // ── Custom AST gates: weak hashes, __proto__, unverified JWT, TLS off ─
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='createHash'][arguments.0.value=/^(md5|sha1|md4|ripemd160)$/i]",
          message:
            'Weak hash algorithm in crypto.createHash(); use sha256 or stronger (TOTP RFC 6238 uses createHmac).',
        },
        {
          selector: "MemberExpression[property.name='__proto__']",
          message: 'Direct __proto__ access/assignment is a prototype pollution vector.',
        },
        {
          selector: "Property[key.name='__proto__']",
          message: 'Object literal __proto__ key is a prototype pollution vector.',
        },
        {
          selector: "CallExpression[callee.object.name='jwt'][callee.property.name='decode']",
          message: 'jwt.decode() skips signature verification; use jwt.verify() with explicit algorithms.',
        },
        {
          selector: "Property[key.name='rejectUnauthorized'][value.value=false]",
          message: 'Disabling TLS certificate verification (rejectUnauthorized: false) is forbidden.',
        },
      ],

      // These heuristics require contextual review. They match routine typed
      // lookups, configured filesystem paths and bounded regexes in this repo.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-unsafe-regex': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
  {
    // This unit test specifically passes literal U+202E/U+202C bidi overrides
    // on line 37 to verify `sanitizeFreeText()` strips Trojan Source controls.
    files: ['apps/web/tests/lib/kb-sanitize-free-text.test.ts'],
    rules: {
      'security/detect-bidi-characters': 'off',
    },
  },
];
