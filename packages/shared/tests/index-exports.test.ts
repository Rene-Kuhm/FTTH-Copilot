import { describe, expect, it } from 'vitest';
import * as Shared from '../src/index';

describe('shared public API surface — Fase C re-exports', () => {
  it('re-exports ABSTENTION_SCHEMA constant', () => {
    expect(Shared.ABSTENTION_SCHEMA).toBe('ftth.abstention.v1');
  });

  it('re-exports abstentionSchema zod schema', () => {
    expect(typeof Shared.abstentionSchema).toBe('object');
    expect(typeof Shared.abstentionSchema.safeParse).toBe('function');
  });

  it('exposes the Abstention type at the package boundary', () => {
    const env: Shared.Abstention = {
      schema: Shared.ABSTENTION_SCHEMA,
      reason: 'incomplete',
      severity: 'critical',
      missing: ['get_onu_detail'],
      available: ['list_onus'],
      nextStep: 'Re-colectá las métricas y volvé a intentar.',
      toolsAffected: ['get_onu_detail'],
    };
    expect(env.schema).toBe('ftth.abstention.v1');
  });
});

// ── Fase F — ftth.verdict-log.v1 re-exports ───────────────────────────────────

describe('shared public API surface — Fase F verdict-log re-exports', () => {
  it('re-exports VERDICT_LOG_SCHEMA constant', () => {
    expect(Shared.VERDICT_LOG_SCHEMA).toBe('ftth.verdict-log.v1');
  });

  it('re-exports verdictLogSchema zod schema with safeParse', () => {
    expect(typeof Shared.verdictLogSchema).toBe('object');
    expect(typeof Shared.verdictLogSchema.safeParse).toBe('function');
    const parsed = Shared.verdictLogSchema.safeParse({
      schema: Shared.VERDICT_LOG_SCHEMA,
      id: 'vl-1',
      tenantId: 't1',
      messageId: 'msg-1',
      conversationId: 'conv-1',
      toolName: 'list_olts',
      code: 'ok',
      severity: 'ok',
      observedAt: '2026-09-03T20:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('re-exports VerdictCodeSchema + VerdictSeveritySchema zod enums', () => {
    expect(Shared.VerdictCodeSchema.safeParse('ok').success).toBe(true);
    expect(Shared.VerdictCodeSchema.safeParse('nope').success).toBe(false);
    expect(Shared.VerdictSeveritySchema.safeParse('critical').success).toBe(true);
    expect(Shared.VerdictSeveritySchema.safeParse('fatal').success).toBe(false);
  });

  it('exposes the VerdictLog, VerdictCode, and VerdictSeverity types at the boundary', () => {
    const row: Shared.VerdictLog = {
      schema: Shared.VERDICT_LOG_SCHEMA,
      id: 'vl-1',
      tenantId: 't1',
      messageId: 'msg-1',
      conversationId: 'conv-1',
      toolName: 'list_olts',
      code: 'ok',
      severity: 'ok',
      observedAt: '2026-09-03T20:00:00.000Z',
      injectionSuspicion: false,
    };
    expect(row.schema).toBe('ftth.verdict-log.v1');

    const codes: ReadonlyArray<Shared.VerdictCode> = ['ok', 'low_confidence', 'stale', 'incomplete'];
    expect(codes).toContain('incomplete');

    const severities: ReadonlyArray<Shared.VerdictSeverity> = ['ok', 'info', 'warning', 'critical'];
    expect(severities).toContain('critical');
  });
});
// ── Block 1 (diagnostic-router) — AgentResult observability fields ──────

describe('shared public API surface — diagnostic-router Block 1 (LLM cost observability)', () => {
  it('AgentResult exposes optional tokens?: { prompt, completion, total }', () => {
    const r: Shared.AgentResult = {
      text: 'hi',
      toolCalls: [],
      tokens: { prompt: 100, completion: 50, total: 150 },
    };
    expect(r.tokens).toEqual({ prompt: 100, completion: 50, total: 150 });
  });

  it('AgentResult exposes optional costUsd?: number', () => {
    const r: Shared.AgentResult = {
      text: 'hi',
      toolCalls: [],
      costUsd: 0.000225,
    };
    expect(r.costUsd).toBeCloseTo(0.000225);
  });

  it('AgentResult exposes optional latencyMs?: number', () => {
    const r: Shared.AgentResult = {
      text: 'hi',
      toolCalls: [],
      latencyMs: 1234,
    };
    expect(r.latencyMs).toBe(1234);
  });

  it('AgentResult without new fields remains a valid result', () => {
    const r: Shared.AgentResult = {
      text: 'hi',
      toolCalls: [],
    };
    expect(r.tokens).toBeUndefined();
    expect(r.costUsd).toBeUndefined();
    expect(r.latencyMs).toBeUndefined();
  });
});

// ── Laya Runtime Integration (Phase 3) — newly public surface ──────────────

describe('shared public API surface — Laya client and integration modules (Phase 3)', () => {
  it('exports createLayaClient factory function', () => {
    expect(typeof Shared.createLayaClient).toBe('function');
  });

  it('exports LayaClient type', () => {
    // Just verify the symbol is reachable — LayaClient is an interface
    const client: Shared.LayaClient = {
      isOperational: () => false,
      getConfig: () => ({ enabled: false, mode: 'disabled', timeoutMs: 250, failOpen: true, confidenceThresholdHigh: 0.95, confidenceThresholdLow: 0.75 }),
      getCircuitBreakerState: () => ({ status: 'closed', consecutiveFailures: 0, lastFailureTime: null }),
      getMetrics: () => ({ requestsTotal: 0, failuresTotal: 0, timeoutsTotal: 0, shadowTotal: 0, fallbackTotal: 0, latencySum: 0, batchSizeSum: 0, routeSuggestionTotal: {}, shadowAgreementTotal: 0, shadowDisagreementTotal: 0, confidenceSum: 0, confidenceCount: 0 }),
      decide: async () => null,
      decideBatch: async () => [],
      healthCheck: async () => false,
    };
    expect(typeof client.isOperational).toBe('function');
  });

  it('exports recordLayaCallOutcome (renamed from recordLayaDecision in laya-client)', () => {
    expect(typeof Shared.recordLayaCallOutcome).toBe('function');
    // Smoke test: it does not throw
    const metrics = { requestsTotal: 0, failuresTotal: 0, timeoutsTotal: 0, shadowTotal: 0, fallbackTotal: 0, latencySum: 0, batchSizeSum: 0, routeSuggestionTotal: {}, shadowAgreementTotal: 0, shadowDisagreementTotal: 0, confidenceSum: 0, confidenceCount: 0 };
    Shared.recordLayaCallOutcome(metrics, { latencyMs: 10, success: true });
    expect(metrics.requestsTotal).toBe(1);
  });

  it('exports LayaIntegration class', () => {
    expect(typeof Shared.LayaIntegration).toBe('function');
    const instance = new Shared.LayaIntegration({ enabled: false, mode: 'disabled', timeoutMs: 250, failOpen: true, confidenceThresholdHigh: 0.95, confidenceThresholdLow: 0.75 });
    expect(typeof instance.isEnabled).toBe('function');
    expect(typeof instance.processEvent).toBe('function');
  });

  it('exports getLayaIntegration singleton factory', () => {
    expect(typeof Shared.getLayaIntegration).toBe('function');
    const inst = Shared.getLayaIntegration();
    expect(inst).toBeInstanceOf(Shared.LayaIntegration);
  });

  it('exports resetLayaIntegration', () => {
    expect(typeof Shared.resetLayaIntegration).toBe('function');
    // Calling resetLayaIntegration clears the singleton so the next getLayaIntegration() creates a new instance
    const before = Shared.getLayaIntegration();
    Shared.resetLayaIntegration();
    const after = Shared.getLayaIntegration();
    expect(before).not.toBe(after); // Fresh instance after reset
  });

  it('exports shouldConsultLaya helper', () => {
    expect(typeof Shared.shouldConsultLaya).toBe('function');
    expect(Shared.shouldConsultLaya({ enabled: false, mode: 'disabled', timeoutMs: 250, failOpen: true, confidenceThresholdHigh: 0.95, confidenceThresholdLow: 0.75 })).toBe(false);
    expect(Shared.shouldConsultLaya({ enabled: true, mode: 'shadow', timeoutMs: 250, failOpen: true, confidenceThresholdHigh: 0.95, confidenceThresholdLow: 0.75 })).toBe(true);
  });

  it('exports mergeRoutingDecision helper', () => {
    expect(typeof Shared.mergeRoutingDecision).toBe('function');
    const result = Shared.mergeRoutingDecision({
      adaptiveRoute: 'direct',
      layaSignal: null,
      confidenceThresholds: { high: 0.9, low: 0.7 },
    });
    expect(result).toBe('direct');
  });

  it('exports LayaDecision type (re-exported from laya-shadow)', () => {
    // LayaDecision must be importable from the package boundary
    const decision: Shared.LayaDecision = {
      eventClass: 'OPTICAL_FAULT',
      confidence: { eventClass: 0.9, suggestedRoute: 0.85 },
      severity: 'HIGH',
      probableScope: 'PON',
      requiresInvestigation: true,
      suggestedRoute: 'INVESTIGATION',
    };
    expect(decision.eventClass).toBe('OPTICAL_FAULT');
  });
});
