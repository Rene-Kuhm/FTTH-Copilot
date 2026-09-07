import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RED tests for the lint-real-config contract.
 *
 * Before this PR, the 13 non-web packages had:
 *   "lint": "echo \"no lint configured\""
 * so ESLint effectively ran only in `apps/web`. After this PR, every
 * non-web package must:
 *
 *   1. Have an `eslint.config.mjs` so `pnpm run lint` invokes ESLint.
 *   2. Have a `lint` script that does NOT echo the placeholder
 *      ("no lint configured") and DOES mention "eslint".
 *
 * These tests walk `packages/` and assert both properties. They do not
 * require ESLint to be installed locally — they only inspect file
 * contents.
 */

const REPO_ROOT = join(__dirname, '../../..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

const NON_WEB_PACKAGES: Array<{ name: string; path: string }> = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (full.includes(join('apps', 'web'))) continue;
    try {
      readFileSync(join(full, 'package.json'));
      NON_WEB_PACKAGES.push({ name: entry.name, path: full });
    } catch {
      walk(full);
    }
  }
}
walk(PACKAGES_DIR);

describe('non-web packages run ESLint (not the "no lint configured" echo)', () => {
  it.each(NON_WEB_PACKAGES)('$name — lint script invokes eslint', ({ path }) => {
    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const lintScript: string | undefined = pkg.scripts?.lint;
    expect(lintScript, `${path}: lint script must be defined`).toBeDefined();
    expect(lintScript, `${path}: lint script must not be empty`).not.toBe('');
    expect(
      lintScript,
      `${path}: lint script must NOT be the placeholder echo`,
    ).not.toMatch(/echo\s+"?no lint configured"?/i);
    expect(
      lintScript,
      `${path}: lint script must invoke eslint`,
    ).toMatch(/eslint/i);
  });

  it.each(NON_WEB_PACKAGES)('$name — has an eslint.config.mjs', ({ path }) => {
    const configPath = join(path, 'eslint.config.mjs');
    expect(existsSync(configPath), `${path}: eslint.config.mjs must exist`).toBe(true);
    const content = readFileSync(configPath, 'utf-8');
    // The local config must extend the shared config from the repo
    // root (the single source of truth for the rule set).
    expect(
      content,
      `${path}: eslint.config.mjs must extend the shared config`,
    ).toMatch(/eslint\.config\.shared\.mjs/);
  });
});

describe('shared ESLint config', () => {
  it('lives at the repo root and exports a flat config array', () => {
    const configPath = join(REPO_ROOT, 'eslint.config.shared.mjs');
    expect(existsSync(configPath)).toBe(true);
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toMatch(/export default\s*\[/);
    expect(content).toMatch(/@typescript-eslint\/no-unused-vars/);
    expect(content).toMatch(/@typescript-eslint\/no-explicit-any/);
  });
});
