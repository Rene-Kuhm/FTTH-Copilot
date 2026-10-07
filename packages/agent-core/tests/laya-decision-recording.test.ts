/**
 * Phase 2 — Close the circuit: laya-decision-recording
 *
 * AD-1: the recording hook lives at the `planRoute` call site in runtime.ts,
 * NOT inside `planRoute` itself (planRoute is pure, no LLM, no I/O).
 *
 * AD-4: when `route.eventClass === undefined` (classifier failed / fail-open)
 * the decision is recorded with `result='error'`.
 *
 * AD-3: mode is recorded as the RESOLVED LAYA MODE (disabled|shadow|assisted|
 * automatic), NOT the diagnostic route mode (direct|assisted|investigation).
 *
 * Known trap: `layaMetrics.recordDecision` increments a Map counter.
 * Recording the same decision twice double-counts. The hook must run
 * exactly once per `runAgent()` invocation.
 *
 * Style mirrors `runtime.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layaMetrics } from '@ftth-copilot/shared';
import { planRoute } from '../src/adaptive-router';

const createMessage = vi.hoisted(() => vi.fn());

// Mock the LLM factory so tests can drive responses deterministically.
vi.mock('../src/llm', () => ({
  createLlmClient: () => ({ provider: 'mock', createMessage }),
}));

import { runAgent } from '../src/runtime';

describe('Laya decision recording — Phase 2', () => {
  beforeEach(() => {
    // Isolate the singleton between tests.
    layaMetrics.reset();
    createMessage.mockReset();
    // Default: Laya disabled so baseline is clean.
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_FAIL_OPEN;
    // Minimal connector so runAgent can execute.
    process.env['LLM_PROVIDER'] = 'minimax';
    process.env['MINIMAX_API_KEY'] = 'test-key';
  });

  afterEach(() => {
    delete process.env['LLM_PROVIDER'];
    delete process.env['MINIMAX_API_KEY'];
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_FAIL_OPEN;
  });

  // ── Task 2.1 RED ────────────────────────────────────────────────────────

  describe('runAgent with Laya enabled', () => {
    it('records exactly ONE decision into layaMetrics', async () => {
      // Arrange: enable Laya in shadow mode.
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';

      // No tool calls → planRoute selects a mode.
      createMessage.mockResolvedValueOnce({ text: 'respuesta', toolCalls: [] });

      // Act
      await runAgent({ userMessage: '¿Qué pasó con el OLT-1?' });

      // Assert: exactly one counter entry.
      const counters = layaMetrics.getSummary().counters;
      const totalDecisions = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(totalDecisions).toBe(1);
    });

    it('records NOTHING when Laya is disabled (empty env)', async () => {
      // No LAYA_ENABLED set → opt-in default = disabled.
      createMessage.mockResolvedValueOnce({ text: 'respuesta', toolCalls: [] });

      await runAgent({ userMessage: '¿Qué pasó con el OLT-1?' });

      const counters = layaMetrics.getSummary().counters;
      const totalDecisions = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(totalDecisions).toBe(0);
    });

    it('planRoute alone records NOTHING (AD-1 — no side effects in pure function)', () => {
      // Clear any prior state.
      layaMetrics.reset();
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';

      // planRoute is pure — call it directly.
      const route = planRoute({ userMessage: '¿Qué pasó con el OLT-1?' });

      // Route was computed.
      expect(route.mode).toBeDefined();

      // But no metric was recorded.
      const counters = layaMetrics.getSummary().counters;
      const totalDecisions = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(totalDecisions).toBe(0);
    });
  });

  // ── Task 2.4 double-count guard ──────────────────────────────────────────

  describe('exactly-once guard', () => {
    it('calling runAgent twice records exactly two decisions (once per invocation)', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';

      createMessage.mockResolvedValue({ text: 'respuesta', toolCalls: [] });

      await runAgent({ userMessage: '¿Qué pasó con el OLT-1?' });
      await runAgent({ userMessage: '¿Qué pasó con el OLT-2?' });

      const counters = layaMetrics.getSummary().counters;
      const totalDecisions = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(totalDecisions).toBe(2);
    });
  });

  // ── Task 2.5 E2E: Prometheus sample emission ─────────────────────────────

  describe('toPrometheusFormat emits ftth_laya_requests_total samples', () => {
    it('emits at least one ftth_laya_requests_total sample line after runAgent with Laya enabled', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';
      createMessage.mockResolvedValueOnce({ text: 'respuesta', toolCalls: [] });

      await runAgent({ userMessage: '¿Qué pasó con el OLT-1?' });

      const promOutput = layaMetrics.toPrometheusFormat();
      const sampleLines = promOutput.split('\n').filter(
        (l) => l.startsWith('ftth_laya_requests_total{')
      );

      // R3.1: at least one actual SAMPLE line (not just HELP / TYPE headers).
      expect(sampleLines.length).toBeGreaterThan(0);

      // Every sample must be a counter with a positive integer value.
      for (const line of sampleLines) {
        const match = /^ftth_laya_requests_total\{([^}]+)\}\s+(\d+)$/.exec(line);
        expect(match).not.toBeNull();
        const value = parseInt(match![2], 10);
        expect(value).toBeGreaterThan(0);
      }
    });

    it('emits NO ftth_laya_requests_total sample lines when Laya is disabled', async () => {
      // No LAYA_ENABLED → opt-in default = disabled.
      createMessage.mockResolvedValueOnce({ text: 'respuesta', toolCalls: [] });

      await runAgent({ userMessage: '¿Qué pasó con el OLT-1?' });

      const promOutput = layaMetrics.toPrometheusFormat();
      const sampleLines = promOutput.split('\n').filter(
        (l) => l.startsWith('ftth_laya_requests_total{')
      );
      expect(sampleLines.length).toBe(0);
    });
  });
});
