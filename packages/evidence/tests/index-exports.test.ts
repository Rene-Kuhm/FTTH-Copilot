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
// ── Fase D WU2 — retrieval runtime surface ──────────────────────────────────

describe('evidence public API surface — Fase D WU2 retrieval helpers', () => {
  it('re-exports the BM25Lite scorer surface', () => {
    expect(typeof Evidence.tokenize).toBe('function');
    expect(typeof Evidence.scoreBM25).toBe('function');
    expect(typeof Evidence.scoreCorpus).toBe('function');
    expect(Evidence.BM25_K1).toBe(1.5);
    expect(Evidence.BM25_B).toBe(0.75);
    expect(Evidence.BM25_STOPWORDS).toContain('de');
  });

  it('re-exports the retrieval surface with its locked constants', () => {
    expect(typeof Evidence.retrieveRelevantIncidents).toBe('function');
    expect(typeof Evidence.formatRelevantIncidentsBlock).toBe('function');
    expect(Evidence.RRF_K).toBe(60);
    expect(Evidence.MIN_SPARSESCORE).toBe(0.05);
    expect(Evidence.DEFAULT_LIMIT).toBe(5);
    expect(Evidence.DEFAULT_SINCE_DAYS).toBe(90);
    expect(Evidence.RELEVANT_INCIDENTS_HEADING).toContain('contexto, no evidencia');
  });

  it('re-exports MissingTenantError as a throwable class', () => {
    expect(() =>
      Evidence.retrieveRelevantIncidents({ tenantId: '', query: 'x', confirmedIncidents: [] }),
    ).toThrow(Evidence.MissingTenantError);
  });

  it('re-exports the pending-candidate helpers', () => {
    const draft = Evidence.buildPendingIncidentCandidate({
      tenantId: 't1',
      summary: 's',
      toolCallsJson: [],
      now: new Date('2026-09-01T12:00:00.000Z'),
    });
    expect(draft.status).toBe('pending');
    expect(
      Evidence.eligibleForPromotion(
        draft,
        { status: 'resolved', resolvedAt: new Date('2026-08-30T12:00:00.000Z') },
        new Date('2026-09-01T12:00:00.000Z'),
        false,
      ),
    ).toBe(true);
  });
});

// ── Fase E — per-tenant policy re-exports ────────────────────────────────────

describe('evidence public API surface — Fase E TenantPolicy re-exports', () => {
  it('re-exports TENANT_POLICY_SCHEMA constant', () => {
    expect(Evidence.TENANT_POLICY_SCHEMA).toBe('ftth.tenant-policy.v1');
  });

  it('re-exports tenantPolicySchema zod object', () => {
    expect(typeof Evidence.tenantPolicySchema).toBe('object');
    expect(typeof Evidence.tenantPolicySchema.safeParse).toBe('function');
    const parsed = Evidence.tenantPolicySchema.safeParse({
      schema: Evidence.TENANT_POLICY_SCHEMA,
      schemaVersion: 1,
      tenantId: 't1',
      createdAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('exposes the TenantPolicy type at the boundary', () => {
    const env: Evidence.TenantPolicy = {
      schema: Evidence.TENANT_POLICY_SCHEMA,
      schemaVersion: 1,
      tenantId: 't1',
      retrievalLimit: 7,
      truthGateMode: 'observe',
      createdAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    };
    expect(env.tenantId).toBe('t1');
    expect(env.truthGateMode).toBe('observe');
  });
});
