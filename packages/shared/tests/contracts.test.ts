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
  ABSTENTION_SCHEMA,
  abstentionSchema,
  CONFIRMED_INCIDENT_SCHEMA,
  PENDING_INCIDENT_CANDIDATE_SCHEMA,
  confirmedIncidentSchema,
  pendingIncidentCandidateSchema,
  type Abstention,
  type ConfirmedIncident,
  type PendingIncidentCandidate,
  type RelevantIncidentResult,
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

import type { AgentResult, ChatResponse } from '../src/index';
import type { Verdict } from '@ftth-copilot/evidence';

describe('AgentResult backward compatibility (Fase B)', () => {
  it('still type-checks with no verdicts field (existing consumers)', () => {
    const legacy: AgentResult = { text: 'respuesta', toolCalls: [] };
    expect(legacy.text).toBe('respuesta');
    expect(legacy.toolCalls).toEqual([]);
  });

  it('accepts an optional verdicts array of the @ftth-copilot/evidence shape', () => {
    const verdicts: Verdict[] = [
      {
        toolName: 'list_olts',
        code: 'ok',
        reason: 'fresh-complete',
        severity: 'ok',
      },
      {
        toolName: 'get_predicted_issues',
        code: 'incomplete',
        reason: 'minimal-completeness',
        severity: 'critical',
      },
    ];
    const withVerdicts: AgentResult = {
      text: 'respuesta',
      toolCalls: [],
      verdicts,
    };
    expect(withVerdicts.verdicts).toHaveLength(2);
    expect(withVerdicts.verdicts?.[0]?.toolName).toBe('list_olts');
  });
});

describe('ftth.abstention.v1', () => {
  const valid: Abstention = {
    schema: ABSTENTION_SCHEMA,
    reason: 'incomplete',
    severity: 'critical',
    claim: 'Diagnóstico de ONU MK-7',
    missing: ['get_onu_detail'],
    available: ['list_onus'],
    nextStep: 'No pude respaldar el diagnóstico: el identificador no figura en el NMS. Verificá el identificador (ID, SN o filtro) y volvé a intentar.',
    toolsAffected: ['get_onu_detail'],
  };

  it('exports the literal version marker ftth.abstention.v1', () => {
    expect(ABSTENTION_SCHEMA).toBe('ftth.abstention.v1');
  });

  it('accepts a valid abstention.v1 envelope', () => {
    const parsed = abstentionSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects a wrong schema version', () => {
    expect(abstentionSchema.safeParse({ ...valid, schema: 'ftth.abstention.v2' }).success).toBe(false);
  });

  it('rejects empty string entries inside missing/available/toolsAffected', () => {
    expect(abstentionSchema.safeParse({ ...valid, missing: [''] }).success).toBe(false);
    expect(abstentionSchema.safeParse({ ...valid, available: [''] }).success).toBe(false);
    expect(abstentionSchema.safeParse({ ...valid, toolsAffected: [''] }).success).toBe(false);
  });

  it('rejects an empty nextStep', () => {
    expect(abstentionSchema.safeParse({ ...valid, nextStep: '' }).success).toBe(false);
  });

  it('rejects an unknown reason value', () => {
    expect(abstentionSchema.safeParse({ ...valid, reason: 'unknown_reason' }).success).toBe(false);
  });

  it('rejects an unknown severity value', () => {
    expect(abstentionSchema.safeParse({ ...valid, severity: 'fatal' }).success).toBe(false);
  });

  it('accepts an envelope without the optional claim field', () => {
    const { claim: _, ...withoutClaim } = valid;
    const parsed = abstentionSchema.safeParse(withoutClaim);
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty available array (all-incomplete scenario)', () => {
    const allIncomplete: Abstention = {
      ...valid,
      available: [],
    };
    expect(abstentionSchema.safeParse(allIncomplete).success).toBe(true);
  });

  it('accepts severity=warning (warning-tier abstention path)', () => {
    const warningTier: Abstention = { ...valid, severity: 'warning' };
    expect(abstentionSchema.safeParse(warningTier).success).toBe(true);
  });

  it('accepts every declared VerdictCode enum value', () => {
    for (const reason of ['ok', 'low_confidence', 'stale', 'incomplete'] as const) {
      expect(abstentionSchema.safeParse({ ...valid, reason }).success).toBe(true);
    }
  });

  it('rejects unknown top-level keys via strict mode', () => {
    expect(abstentionSchema.safeParse({ ...valid, extraField: 'nope' }).success).toBe(false);
  });
});

// ── Fase C — additive AgentResult / ChatResponse abstention fields ────────────

describe('AgentResult / ChatResponse abstention fields', () => {
  const abstention: Abstention = {
    schema: ABSTENTION_SCHEMA,
    reason: 'incomplete',
    severity: 'critical',
    missing: ['get_onu_detail'],
    available: ['list_onus'],
    nextStep: 'Verificá el identificador (ID, SN o filtro) y volvé a intentar.',
    toolsAffected: ['get_onu_detail'],
  };

  it('AgentResult carries a valid abstention envelope through a JSON round-trip', () => {
    const result: AgentResult = {
      text: 'No puedo responder con la evidencia disponible.',
      toolCalls: [{ name: 'get_onu_detail', arguments: { onuId: 'ONU-1' }, result: 'boom' }],
      verdicts: [
        { toolName: 'get_onu_detail', code: 'incomplete', reason: 'no-envelope', severity: 'critical' },
      ],
      abstention,
      abstained: true,
    };

    const roundTripped = JSON.parse(JSON.stringify(result)) as AgentResult;
    expect(roundTripped.abstained).toBe(true);
    expect(abstentionSchema.safeParse(roundTripped.abstention).success).toBe(true);
    expect(roundTripped.abstention?.missing).toEqual(['get_onu_detail']);
    expect(roundTripped.text).toBe('No puedo responder con la evidencia disponible.');
    expect(roundTripped.verdicts?.[0]?.code).toBe('incomplete');
  });

  it('AgentResult without abstention fields stays valid (backward compatible)', () => {
    const result: AgentResult = {
      text: 'La ONU ONU-1 está online con RX -21.4 dBm.',
      toolCalls: [{ name: 'get_onu_detail', arguments: { onuId: 'ONU-1' } }],
    };

    expect(result.abstention).toBeUndefined();
    expect(result.abstained).toBeUndefined();
    expect(result.text).toBe('La ONU ONU-1 está online con RX -21.4 dBm.');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('ChatResponse forwards the same abstention envelope to the client', () => {
    const response: ChatResponse = {
      reply: 'No puedo responder con la evidencia disponible.',
      toolsUsed: [{ name: 'get_onu_detail', args: { onuId: 'ONU-1' } }],
      conversationId: 'conv-1',
      abstention,
    };

    const roundTripped = JSON.parse(JSON.stringify(response)) as ChatResponse;
    expect(abstentionSchema.safeParse(roundTripped.abstention).success).toBe(true);
    expect(roundTripped.abstention?.nextStep).toBe(abstention.nextStep);
    expect(roundTripped.reply).toBe('No puedo responder con la evidencia disponible.');
  });

  it('ChatResponse without abstention stays valid (backward compatible)', () => {
    const response: ChatResponse = {
      reply: 'Todo OK en la OLT-001.',
      toolsUsed: [],
    };

    expect(response.abstention).toBeUndefined();
    expect(response.reply).toBe('Todo OK en la OLT-001.');
    expect(response.toolsUsed).toEqual([]);
  });
});

// ── Fase D — ftth.confirmed-incident.v1 ──────────────────────────────────────

describe('ftth.confirmed-incident.v1', () => {
  const valid: ConfirmedIncident = {
    schema: CONFIRMED_INCIDENT_SCHEMA,
    id: 'ci-1',
    tenantId: 't1',
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    sourceTool: 'list_onus',
    summary: 'Pérdida de señal en ONU-1',
    symptoms: [{ kind: 'rx_low', value: '-27.5', observedAt: '2026-08-30T12:00:00.000Z' }],
    rootCause: 'Conector flojo en roseta',
    fix: 'Re-insertar conector y verificar',
    observedAt: '2026-08-30T12:00:00.000Z',
    resolvedAt: '2026-08-30T13:30:00.000Z',
    createdAt: '2026-08-30T13:35:00.000Z',
    updatedAt: '2026-08-30T13:35:00.000Z',
    confirmedBy: 'operator',
    searchTokens: 'onu-1 pérdida señal conector',
  };

  it('exports the literal version marker ftth.confirmed-incident.v1', () => {
    expect(CONFIRMED_INCIDENT_SCHEMA).toBe('ftth.confirmed-incident.v1');
  });

  it('accepts a valid base envelope', () => {
    expect(confirmedIncidentSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a wrong schema literal (v2)', () => {
    expect(
      confirmedIncidentSchema.safeParse({ ...valid, schema: 'ftth.confirmed-incident.v2' }).success,
    ).toBe(false);
  });

  it('rejects empty tenantId', () => {
    expect(confirmedIncidentSchema.safeParse({ ...valid, tenantId: '' }).success).toBe(false);
  });

  it('rejects empty deviceId', () => {
    expect(confirmedIncidentSchema.safeParse({ ...valid, deviceId: '' }).success).toBe(false);
  });

  it('rejects empty summary, rootCause, or fix', () => {
    expect(confirmedIncidentSchema.safeParse({ ...valid, summary: '' }).success).toBe(false);
    expect(confirmedIncidentSchema.safeParse({ ...valid, rootCause: '' }).success).toBe(false);
    expect(confirmedIncidentSchema.safeParse({ ...valid, fix: '' }).success).toBe(false);
  });

  it('rejects invalid datetimes on observedAt/resolvedAt/createdAt', () => {
    expect(
      confirmedIncidentSchema.safeParse({ ...valid, observedAt: 'not-a-date' }).success,
    ).toBe(false);
    expect(
      confirmedIncidentSchema.safeParse({ ...valid, resolvedAt: 'not-a-date' }).success,
    ).toBe(false);
    expect(
      confirmedIncidentSchema.safeParse({ ...valid, createdAt: 'not-a-date' }).success,
    ).toBe(false);
  });

  it('rejects unknown confirmedBy values', () => {
    expect(
      confirmedIncidentSchema.safeParse({ ...valid, confirmedBy: 'human' as never }).success,
    ).toBe(false);
  });

  it('rejects a score outside [0,1]', () => {
    expect(confirmedIncidentSchema.safeParse({ ...valid, score: 1.5 }).success).toBe(false);
    expect(confirmedIncidentSchema.safeParse({ ...valid, score: -0.1 }).success).toBe(false);
  });

  it('accepts an optional score in [0,1] (retrieval path)', () => {
    expect(confirmedIncidentSchema.safeParse({ ...valid, score: 0.42 }).success).toBe(true);
  });

  it('accepts an empty searchTokens (no tokens after stop-word drop)', () => {
    expect(confirmedIncidentSchema.safeParse({ ...valid, searchTokens: '' }).success).toBe(true);
  });

  it('rejects unknown top-level keys via strict mode', () => {
    expect(
      confirmedIncidentSchema.safeParse({ ...valid, extraField: 'nope' }).success,
    ).toBe(false);
  });

  it('round-trips through JSON.parse(JSON.stringify(...)) preserving all fields', () => {
    const roundTripped = JSON.parse(JSON.stringify(valid)) as ConfirmedIncident;
    expect(confirmedIncidentSchema.safeParse(roundTripped).success).toBe(true);
    expect(roundTripped.id).toBe('ci-1');
    expect(roundTripped.confirmedBy).toBe('operator');
    expect(roundTripped.searchTokens).toBe('onu-1 pérdida señal conector');
  });

  it('RelevantIncidentResult type narrows ConfirmedIncident & { score: number }', () => {
    const enriched: RelevantIncidentResult = { ...valid, score: 0.8 };
    expect(enriched.score).toBe(0.8);
    expect(enriched.schema).toBe(CONFIRMED_INCIDENT_SCHEMA);
  });
});

// ── Fase D — ftth.pending-incident-candidate.v1 ──────────────────────────────

describe('ftth.pending-incident-candidate.v1', () => {
  const valid: PendingIncidentCandidate = {
    schema: PENDING_INCIDENT_CANDIDATE_SCHEMA,
    id: 'pic-1',
    tenantId: 't1',
    sourceIncidentId: 'inc-1',
    runSessionId: 'run-1',
    summary: 'Sugerencia automática basada en historial',
    toolCallsJson: [{ name: 'list_onus', args: {}, result: [] }],
    proposedConfirmedAt: '2026-08-30T13:35:00.000Z',
    status: 'pending',
  };

  it('exports the literal version marker ftth.pending-incident-candidate.v1', () => {
    expect(PENDING_INCIDENT_CANDIDATE_SCHEMA).toBe('ftth.pending-incident-candidate.v1');
  });

  it('accepts a valid base envelope', () => {
    expect(pendingIncidentCandidateSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a wrong schema literal', () => {
    expect(
      pendingIncidentCandidateSchema.safeParse({
        ...valid,
        schema: 'ftth.pending-incident-candidate.v2',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown status value', () => {
    expect(
      pendingIncidentCandidateSchema.safeParse({ ...valid, status: 'archived' as never }).success,
    ).toBe(false);
  });

  it('accepts every declared status value', () => {
    for (const status of ['pending', 'promoted', 'rejected'] as const) {
      expect(pendingIncidentCandidateSchema.safeParse({ ...valid, status }).success).toBe(true);
    }
  });

  it('rejects empty tenantId or summary', () => {
    expect(pendingIncidentCandidateSchema.safeParse({ ...valid, tenantId: '' }).success).toBe(false);
    expect(pendingIncidentCandidateSchema.safeParse({ ...valid, summary: '' }).success).toBe(false);
  });

  it('rejects invalid proposedConfirmedAt', () => {
    expect(
      pendingIncidentCandidateSchema.safeParse({ ...valid, proposedConfirmedAt: 'not-a-date' })
        .success,
    ).toBe(false);
  });

  it('rejects unknown top-level keys via strict mode', () => {
    expect(
      pendingIncidentCandidateSchema.safeParse({ ...valid, extraField: 'nope' }).success,
    ).toBe(false);
  });
});
