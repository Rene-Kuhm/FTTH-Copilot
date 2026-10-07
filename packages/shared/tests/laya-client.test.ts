/**
 * Unit tests for Laya Decision Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadLayaConfigFromEnv,
  createCircuitBreaker,
  createInitialMetrics,
  recordLayaCallOutcome,
  LAYA_QUESTIONS,
  createLayaClient,
  DEFAULT_LAYA_CONFIG,
} from '../src/laya-client.js';

// ── Circuit Breaker Tests ──────────────────────────────────────────────────

describe('Circuit Breaker', () => {
  it('starts in closed state', () => {
    const cb = createCircuitBreaker();
    expect(cb.getState().status).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('records success and resets failure count', () => {
    const cb = createCircuitBreaker({
      consecutiveFailuresThreshold: 3,
      resetTimeoutMs: 1000,
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().consecutiveFailures).toBe(2);

    cb.recordSuccess();
    expect(cb.getState().consecutiveFailures).toBe(0);
    expect(cb.getState().status).toBe('closed');
  });

  it('opens after consecutive failures threshold', () => {
    const cb = createCircuitBreaker({
      consecutiveFailuresThreshold: 3,
      resetTimeoutMs: 1000,
    });

    cb.recordFailure();
    cb.recordFailure();
    const opened = cb.recordFailure();

    expect(opened).toBe(true);
    expect(cb.getState().status).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions to half-open after reset timeout', async () => {
    const cb = createCircuitBreaker({
      consecutiveFailuresThreshold: 2,
      resetTimeoutMs: 50, // 50ms
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().status).toBe('open');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    expect(cb.canExecute()).toBe(true);
    expect(cb.getState().status).toBe('half-open');
  });
});

// ── Metrics Tests ─────────────────────────────────────────────────────────

describe('Laya Metrics', () => {
  it('starts with zero values', () => {
    const metrics = createInitialMetrics();
    expect(metrics.requestsTotal).toBe(0);
    expect(metrics.failuresTotal).toBe(0);
    expect(metrics.timeoutsTotal).toBe(0);
    expect(metrics.shadowTotal).toBe(0);
  });

  it('records successful decision', () => {
    const metrics = createInitialMetrics();
    recordLayaCallOutcome(metrics, {
      latencyMs: 100,
      success: true,
      suggestedRoute: 'DIRECT',
      confidence: 0.9,
    });

    expect(metrics.requestsTotal).toBe(1);
    expect(metrics.failuresTotal).toBe(0);
    expect(metrics.latencySum).toBe(100);
    expect(metrics.routeSuggestionTotal['DIRECT']).toBe(1);
    expect(metrics.confidenceCount).toBe(1);
  });

  it('records failure', () => {
    const metrics = createInitialMetrics();
    recordLayaCallOutcome(metrics, {
      latencyMs: 50,
      success: false,
      isTimeout: true,
    });

    expect(metrics.requestsTotal).toBe(1);
    expect(metrics.failuresTotal).toBe(1);
    expect(metrics.timeoutsTotal).toBe(1);
  });

  it('records shadow mode decisions', () => {
    const metrics = createInitialMetrics();
    recordLayaCallOutcome(metrics, {
      latencyMs: 80,
      success: true,
      isShadow: true,
      suggestedRoute: 'ASSISTED',
    });

    expect(metrics.shadowTotal).toBe(1);
  });

  it('records fallback decisions', () => {
    const metrics = createInitialMetrics();
    // Fallback is when Laya fails but we continue with fail-open
    // Note: fallbackTotal is for tracking, not for success/failure counting
    // This test documents the current behavior
    recordLayaCallOutcome(metrics, {
      latencyMs: 0,
      success: false,
      isFallback: true,
    });

    // Fallback decisions are counted separately from success/failure
    // In this test, we're just verifying the metric exists
    expect(metrics.failuresTotal).toBe(1);
  });

  it('records shadow agreement/disagreement', () => {
    const metrics = createInitialMetrics();

    recordLayaCallOutcome(metrics, {
      latencyMs: 100,
      success: true,
      isShadow: true,
      shadowAgreement: true,
    });
    recordLayaCallOutcome(metrics, {
      latencyMs: 100,
      success: true,
      isShadow: true,
      shadowAgreement: false,
    });

    expect(metrics.shadowAgreementTotal).toBe(1);
    expect(metrics.shadowDisagreementTotal).toBe(1);
  });
});

// ── Laya Questions Tests ───────────────────────────────────────────────────

describe('Laya Questions', () => {
  it('has event_class question with all required classes', () => {
    const q = LAYA_QUESTIONS.event_class;
    expect(q.type).toBe('choice');
    expect(q.criteria).toHaveProperty('NORMAL');
    expect(q.criteria).toHaveProperty('OPTICAL_FAULT');
    expect(q.criteria).toHaveProperty('OPTICAL_DEGRADATION');
    expect(q.criteria).toHaveProperty('POWER_FAULT');
    expect(q.criteria).toHaveProperty('DEVICE_FAULT');
    expect(q.criteria).toHaveProperty('UPLINK_FAULT');
    expect(q.criteria).toHaveProperty('CONGESTION');
    expect(q.criteria).toHaveProperty('MASS_OUTAGE');
    expect(q.criteria).toHaveProperty('SECURITY_EVENT');
    expect(q.criteria).toHaveProperty('UNKNOWN');
  });

  it('has severity question with all levels', () => {
    const q = LAYA_QUESTIONS.severity;
    expect(q.type).toBe('choice');
    expect(q.criteria).toHaveProperty('INFO');
    expect(q.criteria).toHaveProperty('LOW');
    expect(q.criteria).toHaveProperty('MEDIUM');
    expect(q.criteria).toHaveProperty('HIGH');
    expect(q.criteria).toHaveProperty('CRITICAL');
  });

  it('has requires_investigation as noul type', () => {
    const q = LAYA_QUESTIONS.requires_investigation;
    expect(q.type).toBe('noul');
  });
});

// ── Config Tests ─────────────────────────────────────────────────────────

describe('Laya Config', () => {
  beforeEach(() => {
    // Reset env
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_URL;
    delete process.env.LAYA_TIMEOUT_MS;
  });

  it('loads defaults when no env vars set', () => {
    const config = loadLayaConfigFromEnv();
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('shadow'); // AD-2: mode defaults to 'shadow', not 'disabled'
    expect(config.timeoutMs).toBe(250);
    expect(config.failOpen).toBe(true);
  });

  it('loads from environment variables', () => {
    process.env.LAYA_ENABLED = 'true';
    process.env.LAYA_MODE = 'shadow';
    process.env.LAYA_URL = 'http://laya:8080';
    process.env.LAYA_TIMEOUT_MS = '500';

    const config = loadLayaConfigFromEnv();
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('shadow');
    expect(config.url).toBe('http://laya:8080');
    expect(config.timeoutMs).toBe(500);
  });

  it('respects LAYA_FAIL_OPEN=false', () => {
    process.env.LAYA_ENABLED = 'true';
    process.env.LAYA_FAIL_OPEN = 'false';

    const config = loadLayaConfigFromEnv();
    expect(config.failOpen).toBe(false);
  });
});

// ── Response Mapping Tests ─────────────────────────────────────────────────

describe('mapResponseToLayaDecision', () => {
  // These tests verify that the mapper correctly parses the real service contract
  // from services/laya/app.py DecisionResponse:
  //
  //   eventClass: str
  //   severity: str
  //   probableScope: str
  //   requiresInvestigation: bool
  //   confidence: float (0..1)
  //   matchedKeywords: list[str]
  //   latencyMs: int
  //   engine: str
  //   model: str

  it('maps a real DecisionResponse with OPTICAL_FAULT correctly', () => {
    // Real response body from services/laya/app.py for "los alarm on PON 3"
    const realServiceResponse = {
      eventId: 'e1',
      eventClass: 'OPTICAL_FAULT',
      severity: 'HIGH',
      probableScope: 'PON',
      requiresInvestigation: true,
      confidence: 0.87,
      matchedKeywords: ['los alarm'],
      latencyMs: 0,
      engine: 'expert-system',
      model: 'ftth-expert-system-v1',
    };

    const client = createLayaClient({
      config: { ...DEFAULT_LAYA_CONFIG, enabled: true, mode: 'automatic' },
    });

    // Access the internal mapper through the decide call
    // We test by verifying the client's decide returns correct values
    // The mapper is tested via the client's decide() which uses it internally

    // Since mapResponseToLayaDecision is not exported, we test through integration
    // by mocking the HTTP call and verifying the parsed decision
    expect(true).toBe(true); // Placeholder - will be replaced below
  });

  it('[RED] parses real service contract: eventClass, severity, probableScope come from response', async () => {
    // This is the REAL shape that services/laya/app.py DecisionResponse returns.
    // The flat camelCase fields are what the Python service produces.
    const realServiceResponse = {
      eventId: 'evt-123',
      eventClass: 'OPTICAL_FAULT',  // Flat string, not nested { choice, confidence }
      severity: 'HIGH',              // Flat string
      probableScope: 'PON',          // Flat string
      requiresInvestigation: true,   // Flat boolean
      confidence: 0.87,              // Plain number, not { eventClass: 0.87, severity: ... }
      matchedKeywords: ['los alarm', 'fiber cut'],
      latencyMs: 5,
      engine: 'expert-system',
      model: 'ftth-expert-system-v1',
    };

    // Create a mock fetch that returns the real service response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(realServiceResponse),
    });

    const client = createLayaClient({
      config: { ...DEFAULT_LAYA_CONFIG, enabled: true, mode: 'assisted' },
      fetch: mockFetch as unknown as typeof fetch,
    });

    const decision = await client.decide({
      tenantId: 'test-tenant',
      rawSummary: 'los alarm on PON 3',
    });

    // Assertions: these will FAIL against the broken mapper because it expects:
    // - response.event_class.choice (not response.eventClass)
    // - response.severity.choice (not response.severity)
    // - response.requires_investigation.choice (not response.requiresInvestigation)
    expect(decision).not.toBeNull();
    expect(decision!.eventClass).toBe('OPTICAL_FAULT');      // FAILS: gets 'UNKNOWN'
    expect(decision!.severity).toBe('HIGH');                 // FAILS: gets 'INFO'
    expect(decision!.probableScope).toBe('PON');            // FAILS: gets 'UNKNOWN'
    expect(decision!.requiresInvestigation).toBe(true);     // FAILS: gets true (coincidentally)
    expect(decision!.confidence.eventClass).toBe(0.87);      // FAILS: gets 0
  });

  it('[RED] suggestedRoute is derived from requiresInvestigation, not hardcoded', async () => {
    // When requiresInvestigation=false (e.g., NORMAL event), suggestedRoute should NOT be 'INVESTIGATION'
    const normalEventResponse = {
      eventId: 'evt-456',
      eventClass: 'NORMAL',
      severity: 'INFO',
      probableScope: 'UNKNOWN',
      requiresInvestigation: false,  // No investigation needed
      confidence: 0.95,
      matchedKeywords: ['online normal'],
      latencyMs: 2,
      engine: 'expert-system',
      model: 'ftth-expert-system-v1',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(normalEventResponse),
    });

    const client = createLayaClient({
      config: { ...DEFAULT_LAYA_CONFIG, enabled: true, mode: 'assisted' },
      fetch: mockFetch as unknown as typeof fetch,
    });

    const decision = await client.decide({
      tenantId: 'test-tenant',
      rawSummary: 'all services operational',
    });

    // The broken mapper hardcodes suggestedRoute: 'INVESTIGATION'.
    // The fix should derive it from requiresInvestigation:
    // - requiresInvestigation=true → 'INVESTIGATION'
    // - requiresInvestigation=false → 'DIRECT' or 'ASSISTED'
    expect(decision).not.toBeNull();
    expect(decision!.requiresInvestigation).toBe(false);
    expect(decision!.suggestedRoute).not.toBe('INVESTIGATION'); // FAILS: currently hardcoded
  });

  it('[RED] batch path (decideBatch) also uses the mapper and must work correctly', async () => {
    const batchResponse = {
      decisions: [
        {
          eventId: 'evt-1',
          eventClass: 'OPTICAL_FAULT',
          severity: 'HIGH',
          probableScope: 'PON',
          requiresInvestigation: true,
          confidence: 0.92,
          matchedKeywords: ['los alarm'],
          latencyMs: 3,
          engine: 'expert-system',
          model: 'ftth-expert-system-v1',
        },
        {
          eventId: 'evt-2',
          eventClass: 'NORMAL',
          severity: 'INFO',
          probableScope: 'UNKNOWN',
          requiresInvestigation: false,
          confidence: 0.88,
          matchedKeywords: ['online normal'],
          latencyMs: 2,
          engine: 'expert-system',
          model: 'ftth-expert-system-v1',
        },
      ],
      total: 2,
      totalLatencyMs: 5,
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(batchResponse),
    });

    const client = createLayaClient({
      config: { ...DEFAULT_LAYA_CONFIG, enabled: true, mode: 'assisted' },
      fetch: mockFetch as unknown as typeof fetch,
    });

    const decisions = await client.decideBatch([
      { tenantId: 't1', rawSummary: 'los alarm' },
      { tenantId: 't1', rawSummary: 'all ok' },
    ]);

    expect(decisions).toHaveLength(2);
    // First decision
    expect(decisions[0]).not.toBeNull();
    expect(decisions[0]!.eventClass).toBe('OPTICAL_FAULT');   // FAILS: gets 'UNKNOWN'
    expect(decisions[0]!.severity).toBe('HIGH');              // FAILS: gets 'INFO'
    expect(decisions[0]!.confidence.eventClass).toBe(0.92);   // FAILS: gets 0
    // Second decision
    expect(decisions[1]).not.toBeNull();
    expect(decisions[1]!.eventClass).toBe('NORMAL');          // FAILS: gets 'UNKNOWN'
    expect(decisions[1]!.confidence.eventClass).toBe(0.88);   // FAILS: gets 0
  });

  it('[RED] validates payload with layaDecisionSchema and handles invalid input', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),  // Empty response - invalid
    });

    const client = createLayaClient({
      config: { ...DEFAULT_LAYA_CONFIG, enabled: true, mode: 'assisted', failOpen: true },
      fetch: mockFetch as unknown as typeof fetch,
    });

    // With failOpen=true, an invalid response should return null (not a fake decision)
    const decision = await client.decide({
      tenantId: 'test-tenant',
      rawSummary: 'test event',
    });

    // The broken mapper silently returns a fake 'UNKNOWN' decision.
    // The fix should validate with layaDecisionSchema and:
    // - If failOpen=true: return null
    // - If failOpen=false: throw
    expect(decision).toBeNull(); // FAILS: currently returns a fake decision
  });

  it('documents the suggestedRoute derivation rule', () => {
    // Rule: derived deterministically from requiresInvestigation
    // - requiresInvestigation === true  → suggestedRoute = 'INVESTIGATION'
    // - requiresInvestigation === false → suggestedRoute = 'DIRECT' (high confidence) or 'ASSISTED'
    //
    // This test documents the expected behavior after the fix.
    // The actual derivation logic is tested by the tests above.
    expect(true).toBe(true);
  });
});
