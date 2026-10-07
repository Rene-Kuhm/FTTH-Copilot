/**
 * Phase 2, Task 2.3 — AD-4 contract
 *
 * Replaces the tautological AD-4 block in laya-decision-recording.test.ts.
 *
 * The previous test called `layaMetrics.recordDecision` by hand and asserted
 * the counter incremented — it proved the recorder works, not the runtime wiring.
 * This test proves the end-to-end path:
 *
 *   runAgent → planRoute → getExpertClassifier (throws)
 *                         → fail-open: eventClass stays undefined
 *                         → runtime.ts records result='error'
 *
 * Because vi.mock is hoisted and module-wide, this case lives in its own file
 * so the 6 other tests in laya-decision-recording.test.ts stay unmocked
 * and continue using the real expert classifier.
 *
 * The mock is a partial spread of the real module:
 *   { ...actual, getExpertClassifier: () => { throw ... } }
 * This preserves the real `layaMetrics` singleton, so the shared instance that
 * runtime.ts writes to is the same instance the test reads from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock: replace ONLY getExpertClassifier, keep every other real export.
// adaptive-router.ts calls getExpertClassifier() inside a try/catch and fails
// open when it throws. runtime.ts sees route.eventClass === undefined and
// records result='error'. Every other export (especially layaMetrics) is real.
vi.mock('@ftth-copilot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/shared')>();
  return {
    ...actual,
    getExpertClassifier: () => {
      throw new Error('classifier boom');
    },
  };
});

const createMessage = vi.hoisted(() => vi.fn());

// Mock the LLM factory so the test drives responses deterministically.
vi.mock('../src/llm', () => ({
  createLlmClient: () => ({ provider: 'mock', createMessage }),
}));

import { runAgent } from '../src/runtime';
import { layaMetrics } from '@ftth-copilot/shared';
import { planRoute } from '../src/adaptive-router';

describe('AD-4: classifier failure → runAgent fail-open + result=error', () => {
  beforeEach(() => {
    // Isolate the singleton between tests.
    layaMetrics.reset();
    createMessage.mockReset();

    // Laya enabled in shadow mode.
    process.env.LAYA_ENABLED = 'true';
    process.env.LAYA_MODE = 'shadow';

    // Minimal connector so runAgent can execute.
    process.env['LLM_PROVIDER'] = 'minimax';
    process.env['MINIMAX_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env['LLM_PROVIDER'];
    delete process.env['MINIMAX_API_KEY'];
  });

  // ── AD-4 RED ─────────────────────────────────────────────────────────────

  it('runAgent resolves (fail-open) and records result=error when expert classifier throws', async () => {
    // Arrange: LLM returns a clean tool-free answer so the cognitive loop
    // terminates normally — the classifier failure is the ONLY abnormal event.
    createMessage.mockResolvedValueOnce({ text: 'respuesta', toolCalls: [] });

    // Act: runAgent must NOT reject when the classifier throws.
    // This is the fail-open contract — runtime.ts wraps planRoute, not this test.
    const result = await runAgent({ userMessage: '¿Qué pasó con el OLT-1?' });

    // Assert 1: fail-open — runAgent resolved, not rejected.
    // If this assertion fails, the runtime is not correctly handling the
    // classifier exception and is propagating it instead of swallowing it.
    expect(result).toBeDefined();

    // Assert 2: exactly one decision was recorded (exactly-once guard).
    const counters = layaMetrics.getSummary().counters;
    const totalDecisions = Object.values(counters).reduce((s, v) => s + v, 0);
    expect(totalDecisions).toBe(1);

    // Assert 3: that decision has result='error' (AD-4 contract).
    const summary = layaMetrics.getSummary();
    const errorEntry = Object.entries(summary.counters).find(([k]) =>
      k.includes('"result":"error"')
    );
    expect(errorEntry, 'no decision with result="error" was recorded').toBeDefined();
    expect(errorEntry?.[1]).toBe(1);
  });

  // ── Negative check: prove the mock is actually in effect ─────────────────

  it('planRoute returns eventClass=undefined under the mock (proves mock is active)', () => {
    // Companion check: without this, the test above could pass vacuously if
    // the mock were silently ignored. We call planRoute directly and assert
    // the expected failure mode so the mock is verified end-to-end.
    const route = planRoute({ userMessage: '¿Qué pasó con el OLT-1?' });

    expect(route.eventClass).toBeUndefined();
  });
});
