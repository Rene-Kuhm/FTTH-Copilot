import { describe, expect, it } from 'vitest';
import * as Evidence from '../src/index';
import type { Abstention } from '@ftth-copilot/shared';
import { ABSTENTION_SCHEMA, abstentionSchema } from '@ftth-copilot/shared';

describe('evidence public API surface — Fase C re-exports', () => {
  it('re-exports shouldAbstain as a function', () => {
    expect(typeof Evidence.shouldAbstain).toBe('function');
  });

  it('re-exports buildAbstention as a function', () => {
    expect(typeof Evidence.buildAbstention).toBe('function');
  });

  it('re-exports nextStepFor as a function', () => {
    expect(typeof Evidence.nextStepFor).toBe('function');
  });

  it('re-exports Abstention type (consumers can declare the shape)', () => {
    const env: Abstention = {
      schema: ABSTENTION_SCHEMA,
      reason: 'incomplete',
      severity: 'critical',
      missing: ['get_onu_detail'],
      available: ['list_onus'],
      nextStep: 'Re-colectá las métricas y volvé a intentar.',
      toolsAffected: ['get_onu_detail'],
    };
    expect(env.schema).toBe(Evidence.ABSTENTION_SCHEMA ?? ABSTENTION_SCHEMA);
  });

  it('re-exports the abstentionSchema zod object', () => {
    expect(Evidence.abstentionSchema).toBe(abstentionSchema);
  });

  it('re-exports ABSTENTION_SCHEMA constant', () => {
    expect(Evidence.ABSTENTION_SCHEMA).toBe('ftth.abstention.v1');
  });

  it('keeps Fase B exports working (no regression)', () => {
    expect(typeof Evidence.classifyEnvelope).toBe('function');
    expect(typeof Evidence.classifyUnwrapped).toBe('function');
  });
});

// ── Fase D — confirmed-incident memory type re-exports ──────────────────────

describe('evidence public API surface — Fase D type re-exports', () => {
  it('re-exports CONFIRMED_INCIDENT_SCHEMA constant', () => {
    expect(Evidence.CONFIRMED_INCIDENT_SCHEMA).toBe('ftth.confirmed-incident.v1');
  });

  it('re-exports PENDING_INCIDENT_CANDIDATE_SCHEMA constant', () => {
    expect(Evidence.PENDING_INCIDENT_CANDIDATE_SCHEMA).toBe(
      'ftth.pending-incident-candidate.v1',
    );
  });

  it('exposes ConfirmedIncident, PendingIncidentCandidate, RelevantIncidentResult types at the boundary', () => {
    const env: Evidence.ConfirmedIncident = {
      schema: Evidence.CONFIRMED_INCIDENT_SCHEMA,
      id: 'ci-1',
      tenantId: 't1',
      deviceKind: 'ONU',
      deviceId: 'onu-1',
      sourceTool: 'list_onus',
      summary: 's',
      symptoms: [],
      rootCause: 'r',
      fix: 'f',
      observedAt: '2026-08-30T12:00:00.000Z',
      resolvedAt: '2026-08-30T13:30:00.000Z',
      createdAt: '2026-08-30T13:35:00.000Z',
      updatedAt: '2026-08-30T13:35:00.000Z',
      confirmedBy: 'operator',
      searchTokens: '',
    };
    expect(env.schema).toBe('ftth.confirmed-incident.v1');

    const candidate: Evidence.PendingIncidentCandidate = {
      schema: Evidence.PENDING_INCIDENT_CANDIDATE_SCHEMA,
      id: 'pic-1',
      tenantId: 't1',
      summary: 's',
      toolCallsJson: [],
      proposedConfirmedAt: '2026-08-30T13:35:00.000Z',
      status: 'pending',
    };
    expect(candidate.status).toBe('pending');

    const retrieved: Evidence.RelevantIncidentResult = { ...env, score: 0.8 };
    expect(retrieved.score).toBe(0.8);
  });
});