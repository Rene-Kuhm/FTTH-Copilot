import { describe, expect, it } from 'vitest';

/**
 * Phase F-2 — eval package skeleton wiring test.
 *
 * The eval package is bootstrapped into the pnpm workspace via this test:
 * if the barrel resolves, the workspace join + tsconfig + package.json
 * "exports" are all wired correctly. Phase F-4 adds the real runner /
 * assertions / metrics modules; this test only proves the skeleton can
 * be imported from a vitest run inside the monorepo.
 *
 * RED proof: this test fails when `packages/eval/src/index.ts` does not
 * exist or when the package is not registered in `pnpm-workspace.yaml`.
 */
describe('@ftth-copilot/eval — skeleton wiring', () => {
  it('resolves the barrel import without throwing', async () => {
    const mod = await import('../src/index');
    expect(mod).toBeDefined();
    // Phase F-2 ships an empty barrel; the F-4 runner / assertions /
    // metrics modules will land later. The barrel itself MUST resolve
    // so the vitest harness and downstream consumers can `import { ... }
    // from '@ftth-copilot/eval'` without an `ERR_MODULE_NOT_FOUND`.
    expect(typeof mod).toBe('object');
  });
});
