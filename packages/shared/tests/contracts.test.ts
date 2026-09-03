import { describe, expect, it } from 'vitest';
import {
  actionSchema,
  evidenceProvenanceSchema,
  EVIDENCE_PROVENANCE_SCHEMA,
  findingSchema,
  telemetryEventSchema,
  TELEMETRY_SCHEMA,
  FINDING_SCHEMA,
  ACTION_SCHEMA,
} from '../src/contracts';

describe('telemetry.v1', () => {
  const valid = {
    schema: TELEMETRY_SCHEMA,
    tenantId: 't1',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    source: 'poll',
    ts: '2026-08-30T12:00:00.000Z',
    metrics: { rx_power_dbm: -24.1, fec_corrected: 12, fec_uncorrected: 0 },
    tags: { oltId: 'olt-1' },
  };

  it('accepts a valid normalized event (FEC included)', () => {
    expect(telemetryEventSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts unknown metric keys via passthrough', () => {
    const withExtra = { ...valid, metrics: { ...valid.metrics, future_metric: 1 } };
    const parsed = telemetryEventSchema.safeParse(withExtra);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.metrics.future_metric).toBe(1);
  });

  it('rejects a wrong schema version', () => {
    expect(telemetryEventSchema.safeParse({ ...valid, schema: 'ftth.telemetry.v2' }).success).toBe(false);
  });

  it('rejects negative FEC counters', () => {
    const bad = { ...valid, metrics: { fec_corrected: -1 } };
    expect(telemetryEventSchema.safeParse(bad).success).toBe(false);
  });
});

describe('finding.v1', () => {
  const valid = {
    schema: FINDING_SCHEMA,
    kind: 'fec_degradation',
    severity: 'warning',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    confidence: 0.9,
    etaMs: 259200000,
    evidence: { slopePerDay: 3 },
    context: { tenantId: 't1', oltId: 'olt-1' },
  };

  it('accepts a valid finding', () => {
    expect(findingSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(findingSchema.safeParse({ ...valid, kind: 'nope' }).success).toBe(false);
  });

  it('rejects confidence outside [0,1]', () => {
    expect(findingSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });
});

describe('action.v1', () => {
  const valid = {
    schema: ACTION_SCHEMA,
    type: 'pre_alert',
    incidentId: 'inc-1',
    title: 'FEC en aumento',
    body: 'Revisar conector antes del corte.',
    targets: { webhook: true, telegram: true },
  };

  it('accepts a valid action', () => {
    expect(actionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects an unknown action type', () => {
    expect(actionSchema.safeParse({ ...valid, type: 'sms' }).success).toBe(false);
  });
});

describe('evidence.provenance.v1', () => {
  const valid = {
    schema: EVIDENCE_PROVENANCE_SCHEMA,
    source: 'smartolt.demo',
    tenantId: 't1',
    observedAt: '2026-08-30T12:00:00.000Z',
    ttlMs: 900000,
    completeness: 'complete' as const,
    confidence: 1.0,
    data: [{ id: 'olt-1' }],
  };

  it('accepts a valid provenance envelope', () => {
    expect(evidenceProvenanceSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a wrong schema version', () => {
    expect(
      evidenceProvenanceSchema.safeParse({ ...valid, schema: 'evidence.provenance.v2' }).success,
    ).toBe(false);
  });

  it('rejects an empty source', () => {
    expect(evidenceProvenanceSchema.safeParse({ ...valid, source: '' }).success).toBe(false);
  });

  it('rejects an empty tenantId', () => {
    expect(evidenceProvenanceSchema.safeParse({ ...valid, tenantId: '' }).success).toBe(false);
  });

  it('rejects an invalid observedAt', () => {
    expect(
      evidenceProvenanceSchema.safeParse({ ...valid, observedAt: 'not-a-date' }).success,
    ).toBe(false);
  });

  it('rejects a negative ttlMs', () => {
    expect(evidenceProvenanceSchema.safeParse({ ...valid, ttlMs: -1 }).success).toBe(false);
  });

  it('rejects a completeness value outside the enum', () => {
    expect(
      evidenceProvenanceSchema.safeParse({ ...valid, completeness: 'full' }).success,
    ).toBe(false);
  });

  it('rejects a confidence value outside [0,1]', () => {
    expect(
      evidenceProvenanceSchema.safeParse({ ...valid, confidence: 1.5 }).success,
    ).toBe(false);
  });

  it('accepts a valid envelope without optional confidence', () => {
    const { confidence: _, ...withoutConfidence } = valid;
    expect(evidenceProvenanceSchema.safeParse(withoutConfidence).success).toBe(true);
  });
});
