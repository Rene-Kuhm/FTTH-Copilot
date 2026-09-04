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