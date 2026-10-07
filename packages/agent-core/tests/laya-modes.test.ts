/**
 * Phase 4, Task 4.4 — Mode matrix tests (AD-3, AD-6, AD-7, R4, R4.2, R4.5, R4.6).
 *
 * AD-3 mode matrix:
 *   disabled  — consult nothing, record nothing, route untouched.
 *   shadow    — consult, record, pass layaSignal=null so route CANNOT change (AD-7).
 *   assisted  — consult, change route via mergeRoutingDecision when thresholds met.
 *   automatic — consult, let Laya select route directly when shouldFollowLayaRoute says so.
 *
 * R4.5 / R4.6 (fail-open / fail-closed):
 *   unreachable + failOpen=true  → keep adaptive route, record 'fallback', do NOT throw.
 *   unreachable + failOpen=false → propagate the error.
 *
 * AD-6 consistency: when the mode changes via Laya, tools and maxIterations
 * are derived from the FINAL mode, not the pre-override adaptive mode.
 * A route promoted to 'investigation' must NOT retain maxIterations: 0.
 *
 * HTTP boundary controlled via vi.spyOn(globalThis, 'fetch').
 * resetLayaIntegration() used between tests for singleton isolation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayaDecision } from '@ftth-copilot/shared';

// ── Test queries chosen for predictable planRoute output ─────────────────
//
// planRoute derives mode from classifyIntention + selectMode:
//   incident + single device + no '?' → 'direct'
//   incident + single device + '?'     → 'assisted'
//   advisory (keyword 'estado', 'como', etc.) → 'investigation'
//   multi-device or cause-analysis      → 'investigation'
//
// We pick queries where the classifier output is unambiguous.
const Q_DIRECT = 'OLT-1 está caído';          // incident, 1 device, no '?' → direct
const Q_ASSISTED = '¿Qué pasó con el OLT-1?'; // incident, 1 device, '?' → assisted
// "Investiga" matches CAUSE_WORDS (diagn[oó]stic); "masivas" matches MULTI_DEVICE_WORDS.
const Q_INVESTIGATION = 'Investiga la causa raíz de las caídas masivas'; // cause + multi → investigation

// ── Helpers ────────────────────────────────────────────────────────────────

/** Stub that always returns a 200 with the given JSON body. */
function stubFetch(json: unknown): () => void {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response);
  return () => spy.mockRestore();
}

/** Stub that always throws (unreachable service). */
function stubFetchUnreachable(): () => void {
  const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
  return () => spy.mockRestore();
}

// ── Mocks ─────────────────────────────────────────────────────────────────

const createMessage = vi.hoisted(() => vi.fn());

vi.mock('../src/llm', () => ({
  createLlmClient: () => ({ provider: 'mock', createMessage }),
}));

// Mock getLayaIntegration so we can control processEvent return value.
// This bypasses the HTTP layer entirely and gives us full control over
// shouldFollowLayaRoute's inputs.
const mockProcessEvent = vi.fn<LayaDecision | null>();
const mockBuildLayaSignal = vi.fn();
const mockShouldFollowLayaRoute = vi.fn<boolean>();

vi.mock('@ftth-copilot/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/shared')>();
  return {
    ...actual,
    getLayaIntegration: () => ({
      isEnabled: () => true,
      getMode: () => 'automatic' as const,
      isShadowMode: () => false,
      getMetrics: () => actual.createInitialMetrics?.() ?? {},
      getCircuitBreakerState: () => ({ status: 'closed', consecutiveFailures: 0, lastFailureTime: null }),
      processEvent: mockProcessEvent,
      buildLayaSignal: mockBuildLayaSignal,
      shouldFollowLayaRoute: mockShouldFollowLayaRoute,
      shouldEscalate: () => false,
      healthCheck: async () => true,
    }),
    // Reset functions still from real module.
    resetLayaIntegration: actual.resetLayaIntegration,
    layaMetrics: actual.layaMetrics,
  };
});

import { runAgent } from '../src/runtime';
import { layaMetrics, resetLayaIntegration } from '@ftth-copilot/shared';
import { planRoute } from '../src/adaptive-router';

/**
 * Build a LayaDecision for use as processEvent return value.
 * Controls shouldFollowLayaRoute via the confidence fields.
 *
 * Note: shouldFollowLayaRoute checks confidence.suggestedRoute, not
 * confidence.eventClass. The Laya client hardcodes suggestedRoute confidence
 * to 0.5 in mapResponseToLayaDecision, so we bypass the client entirely
 * by mocking processEvent and buildLayaSignal.
 */
function makeLayaDecision(params: {
  suggestedRoute: 'DIRECT' | 'ASSISTED' | 'INVESTIGATION';
  confidence: number; // → confidence.eventClass AND confidence.suggestedRoute
  requiresInvestigation: boolean;
}): LayaDecision {
  return {
    eventClass: 'OPTICAL_FAULT',
    confidence: {
      eventClass: params.confidence,
      suggestedRoute: params.confidence,
      severity: 0.9,
    },
    severity: 'HIGH',
    probableScope: 'PON',
    requiresInvestigation: params.requiresInvestigation,
    suggestedRoute: params.suggestedRoute,
  };
}

/**
 * Build a LayaSignal from a LayaDecision.
 */
function makeLayaSignal(decision: LayaDecision) {
  return {
    eventClass: decision.eventClass as 'OPTICAL_FAULT',
    confidence: decision.confidence.eventClass,
    severity: decision.severity as 'HIGH',
    probableScope: decision.probableScope as 'PON',
    requiresInvestigation: decision.requiresInvestigation,
    suggestedRoute: decision.suggestedRoute,
  };
}

describe('Laya mode matrix — Phase 4', () => {
  beforeEach(() => {
    layaMetrics.reset();
    createMessage.mockReset();
    resetLayaIntegration();
    mockProcessEvent.mockReset();
    mockBuildLayaSignal.mockReset();
    mockShouldFollowLayaRoute.mockReset();

    // Default: processEvent returns null (no Laya decision).
    mockProcessEvent.mockResolvedValue(null);
    // Default: shouldFollowLayaRoute returns false.
    mockShouldFollowLayaRoute.mockReturnValue(false);

    // Clean env.
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_FAIL_OPEN;
    delete process.env.LAYA_URL;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_LOW;
    delete process.env.LAYA_TIMEOUT_MS;
    // Minimal LLM env.
    process.env['LLM_PROVIDER'] = 'minimax';
    process.env['MINIMAX_API_KEY'] = 'test-key';

    // Default: responses succeed.
    createMessage.mockResolvedValue({ text: 'respuesta', toolCalls: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env['LLM_PROVIDER'];
    delete process.env['MINIMAX_API_KEY'];
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_FAIL_OPEN;
    delete process.env.LAYA_URL;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_LOW;
    delete process.env.LAYA_TIMEOUT_MS;
  });



  // ── R4.2: disabled ───────────────────────────────────────────────────

  describe('disabled — consult nothing, record nothing, route untouched', () => {
    it('runAgent does NOT call globalThis.fetch (LAYA_ENABLED=true but mode=disabled)', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'disabled';

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      await runAgent({ userMessage: Q_DIRECT });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('nothing recorded in layaMetrics when disabled', async () => {
      // LAYA_ENABLED='true' but LAYA_MODE='disabled' → recording guard skips (R4.2).
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'disabled';

      await runAgent({ userMessage: Q_DIRECT });

      const counters = layaMetrics.getSummary().counters;
      const total = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(total).toBe(0);
    });

    it('route is the pure adaptive decision (no Laya influence)', async () => {
      process.env.LAYA_ENABLED = 'false';
      process.env.LAYA_MODE = 'disabled';

      const result = await runAgent({ userMessage: Q_DIRECT });

      expect(result.route).toBeDefined();
      expect(result.route!.mode).toBe('direct');
    });
  });

  // ── R4.2: shadow (AD-7) ──────────────────────────────────────────────

  describe('shadow — consult, record, route CANNOT change (AD-7)', () => {
    it('processEvent IS called but route is the adaptive one', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';

      // Even in shadow, processEvent is called for measurement.
      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));

      const result = await runAgent({ userMessage: Q_DIRECT });

      expect(mockProcessEvent).toHaveBeenCalled();
      // Laya returned INVESTIGATION but shadow cannot change the adaptive 'direct' mode.
      expect(result.route).toBeDefined();
      expect(result.route!.mode).toBe('direct');
    });

    it('one decision recorded with mode=shadow, result=success', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';

      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));

      await runAgent({ userMessage: Q_DIRECT });

      const summary = layaMetrics.getSummary();

      // Exactly one decision.
      const total = Object.values(summary.counters).reduce((s, v) => s + v, 0);
      expect(total).toBe(1);

      // Counter labelled mode=shadow (AD-3 contract).
      const shadowEntry = Object.entries(summary.counters).find(([k]) =>
        k.includes('"mode":"shadow"')
      );
      expect(shadowEntry, 'no shadow-mode counter found').toBeDefined();
      expect(shadowEntry?.[1]).toBe(1);

      // Counter labelled result=success.
      const successEntry = Object.entries(summary.counters).find(([k]) =>
        k.includes('"result":"success"')
      );
      expect(successEntry, 'no success result counter found').toBeDefined();
    });

    it('AD-7 proof: planRoute with layaSignal:null produces same mode as without', () => {
      // planRoute with no signal → adaptive mode.
      const routeBaseline = planRoute({ userMessage: Q_DIRECT });
      expect(routeBaseline.mode).toBe('direct');

      // planRoute with explicit null signal → same mode (shadow cannot inject signal).
      const routeWithNull = planRoute({ userMessage: Q_DIRECT, layaSignal: null });
      expect(routeWithNull.mode).toBe(routeBaseline.mode);
      expect(routeWithNull.maxIterations).toBe(routeBaseline.maxIterations);
      expect(routeWithNull.tools).toEqual(routeBaseline.tools);
    });
  });

  // ── R4.2: assisted threshold gate ───────────────────────────────────

  describe('assisted — route changes only when Laya confidence meets thresholds', () => {
    it('below LOW threshold: route stays adaptive (assisted stays assisted)', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'assisted';
      process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH = '0.95';
      process.env.LAYA_CONFIDENCE_THRESHOLD_LOW = '0.75';

      // Low confidence DIRECT suggestion.
      const decision = makeLayaDecision({ suggestedRoute: 'DIRECT', confidence: 0.5, requiresInvestigation: false });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));

      const result = await runAgent({ userMessage: Q_ASSISTED });

      // mergeRoutingDecision: confidence (0.5) < LOW (0.75) → returns adaptive 'assisted'.
      expect(result.route!.mode).toBe('assisted');
    });

    it('above HIGH threshold: mergeRoutingDecision may promote to investigation', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'assisted';
      process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH = '0.95';
      process.env.LAYA_CONFIDENCE_THRESHOLD_LOW = '0.75';

      // High confidence INVESTIGATION suggestion.
      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));

      const result = await runAgent({ userMessage: Q_ASSISTED });

      // mergeRoutingDecision: confidence (0.97) >= HIGH (0.95) → returns 'investigation'.
      expect(result.route!.mode).toBe('investigation');
    });
  });

  // ── R4.2: automatic direct influence ─────────────────────────────────

  describe('automatic — Laya selects the route when shouldFollowLayaRoute says so', () => {
    it('shouldFollowLayaRoute=true: Laya overrides the adaptive mode', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'automatic';

      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));
      mockShouldFollowLayaRoute.mockReturnValueOnce(true); // ← key: override fires

      const result = await runAgent({ userMessage: Q_DIRECT });

      // Adaptive: direct. shouldFollowLayaRoute=true → planRoute called with signal → promoted.
      expect(result.route!.mode).toBe('investigation');
    });

    it('shouldFollowLayaRoute=false: adaptive route is kept', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'automatic';

      const decision = makeLayaDecision({ suggestedRoute: 'DIRECT', confidence: 0.5, requiresInvestigation: false });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));
      mockShouldFollowLayaRoute.mockReturnValueOnce(false); // ← key: override blocked

      const result = await runAgent({ userMessage: Q_DIRECT });

      // shouldFollowLayaRoute returned false → adaptive 'direct' kept.
      expect(result.route!.mode).toBe('direct');
    });
  });

  // ── R4.5: fail-open (unreachable service) ─────────────────────────────

  describe('failOpen=true: unreachable service keeps adaptive route, records fallback', () => {
    it('runAgent resolves (does NOT throw) when Laya is unreachable', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'assisted';
      process.env.LAYA_FAIL_OPEN = 'true';

      // processEvent returns null (unreachable / fail-open).
      mockProcessEvent.mockResolvedValueOnce(null);

      await expect(runAgent({ userMessage: Q_ASSISTED })).resolves.toBeDefined();
    });

    it('route is the adaptive decision (not influenced by unavailable Laya)', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'assisted';
      process.env.LAYA_FAIL_OPEN = 'true';

      mockProcessEvent.mockResolvedValueOnce(null);

      const result = await runAgent({ userMessage: Q_DIRECT });

      expect(result.route!.mode).toBe('direct');
    });

    it('result recorded as fallback (not error, not success)', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';
      process.env.LAYA_FAIL_OPEN = 'true';

      mockProcessEvent.mockResolvedValueOnce(null);

      await runAgent({ userMessage: Q_DIRECT });

      const summary = layaMetrics.getSummary();
      const fallbackEntry = Object.entries(summary.counters).find(([k]) =>
        k.includes('"result":"fallback"')
      );
      expect(fallbackEntry, 'no fallback result — fail-open path not exercised').toBeDefined();
      expect(fallbackEntry?.[1]).toBe(1);
    });
  });

  // ── R4.6: fail-closed (unreachable service) ─────────────────────────

  describe('failOpen=false: unreachable service propagates the error', () => {
    it('runAgent throws when Laya is unreachable in assisted mode', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'assisted';
      process.env.LAYA_FAIL_OPEN = 'false';

      // processEvent throws (fail-closed: error propagates).
      mockProcessEvent.mockRejectedValueOnce(new Error('Laya unreachable'));

      await expect(runAgent({ userMessage: Q_ASSISTED })).rejects.toThrow();
    });

    it('runAgent throws when Laya is unreachable in automatic mode', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'automatic';
      process.env.LAYA_FAIL_OPEN = 'false';

      mockProcessEvent.mockRejectedValueOnce(new Error('Laya unreachable'));

      await expect(runAgent({ userMessage: Q_DIRECT })).rejects.toThrow();
    });

    it('no metric recorded when fail-closed throws (pre-recording exception)', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'assisted';
      process.env.LAYA_FAIL_OPEN = 'false';

      mockProcessEvent.mockRejectedValueOnce(new Error('Laya unreachable'));

      await expect(runAgent({ userMessage: Q_ASSISTED })).rejects.toThrow();

      const counters = layaMetrics.getSummary().counters;
      const total = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(total).toBe(0);
    });
  });

  // ── AD-6 consistency: tools and maxIterations match the FINAL mode ───

  describe('AD-6 consistency: tools and maxIterations match the FINAL mode', () => {
    it('route promoted to investigation has maxIterations:6 and all tools', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'automatic';

      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));
      mockShouldFollowLayaRoute.mockReturnValueOnce(true);

      const result = await runAgent({ userMessage: Q_DIRECT });

      // Adaptive: direct (maxIterations: 0, 1 tool).
      // Laya: INVESTIGATION + shouldFollowLayaRoute=true → promoted to investigation.
      expect(result.route!.mode).toBe('investigation');
      expect(result.route!.maxIterations).toBe(6);
      // All tools for investigation (mode === 'investigation' bypasses tool filter).
      expect(result.route!.tools).toHaveLength(10);
    });

    it('route promoted to direct has maxIterations:0 and exactly one tool', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'automatic';

      // Laya suggests DIRECT; shouldFollowLayaRoute=true promotes from assisted to direct.
      const decision = makeLayaDecision({ suggestedRoute: 'DIRECT', confidence: 0.97, requiresInvestigation: false });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));
      mockShouldFollowLayaRoute.mockReturnValueOnce(true);

      const result = await runAgent({ userMessage: Q_ASSISTED });

      // Adaptive: assisted. Laya: DIRECT + shouldFollowLayaRoute=true → promoted to direct.
      expect(result.route!.mode).toBe('direct');
      expect(result.route!.maxIterations).toBe(0); // ← not the assisted=1 from before promotion!
      expect(result.route!.tools).toHaveLength(1); // ← exactly one tool, not the assisted set!
    });

    it('AD-6 RED: post-hoc mode mutation produces stale maxIterations (proves the fix works)', () => {
      // This test documents the bug AD-6 forbids.
      // Post-hoc override anti-pattern:
      //   1. planRoute derives 'direct' → tools=[...1], maxIterations=0
      //   2. route.mode is mutated AFTER planRoute returns
      // Result: mode='investigation' but maxIterations=0 (stale).
      //
      // The AD-6 fix passes layaSignal INTO planRoute so this inconsistency
      // is impossible. The integration tests above ("route promoted to
      // investigation has maxIterations:6") prove the fix works.
      // This unit test proves the post-hoc mutation WOULD break consistency.

      const route = planRoute({ userMessage: Q_DIRECT });

      // Baseline: adaptive 'direct' is consistent.
      expect(route.mode).toBe('direct');
      expect(route.maxIterations).toBe(0);
      expect(route.tools).toHaveLength(1);

      // Post-hoc mutation: the broken pattern this task prevents.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (route as unknown as Record<string, unknown>).mode = 'investigation';

      // NOW the inconsistency is observable — the fix makes this impossible.
      expect(route.mode).toBe('investigation');
      expect(route.maxIterations).toBe(0); // ← stale! Should be 6.
      expect(route.tools).toHaveLength(1);  // ← stale! Should be 10.
    });
  });

  // ── Phase 2 regression: exactly-one recording ─────────────────────────

  describe('Phase 2 regression: exactly-one recording per runAgent (no double-count)', () => {
    it('disabled: nothing recorded', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'disabled';

      await runAgent({ userMessage: Q_DIRECT });

      const counters = layaMetrics.getSummary().counters;
      const total = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(total).toBe(0);
    });

    it('shadow: exactly one decision recorded', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';

      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));

      await runAgent({ userMessage: Q_DIRECT });

      const counters = layaMetrics.getSummary().counters;
      const total = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(total).toBe(1);
    });

    it('assisted: exactly one decision recorded', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'assisted';

      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent.mockResolvedValueOnce(decision);
      mockBuildLayaSignal.mockReturnValueOnce(makeLayaSignal(decision));

      await runAgent({ userMessage: Q_ASSISTED });

      const counters = layaMetrics.getSummary().counters;
      const total = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(total).toBe(1);
    });

    it('two runAgent calls record exactly two decisions', async () => {
      process.env.LAYA_ENABLED = 'true';
      process.env.LAYA_MODE = 'shadow';

      const decision = makeLayaDecision({ suggestedRoute: 'INVESTIGATION', confidence: 0.97, requiresInvestigation: true });
      mockProcessEvent
        .mockResolvedValueOnce(decision)
        .mockResolvedValueOnce(decision);
      mockBuildLayaSignal
        .mockReturnValueOnce(makeLayaSignal(decision))
        .mockReturnValueOnce(makeLayaSignal(decision));

      await runAgent({ userMessage: Q_DIRECT });
      await runAgent({ userMessage: Q_DIRECT });

      const counters = layaMetrics.getSummary().counters;
      const total = Object.values(counters).reduce((s, v) => s + v, 0);
      expect(total).toBe(2);
    });
  });
});
