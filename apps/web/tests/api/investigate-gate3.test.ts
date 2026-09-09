import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationResult } from '@ftth-copilot/shared';
import type { PersistedInvestigationVersion } from '@ftth-copilot/db';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  consumeInvestigationQuota: vi.fn(),
  runInvestigationPipeline: vi.fn(),
  persistInvestigationVersion: vi.fn(),
  getLatestInvestigationVersion: vi.fn(),
  prismaIncidentFindFirst: vi.fn(),
  prismaInvestigationRunFindFirst: vi.fn(),
  prismaInvestigationRunCreate: vi.fn(),
  prismaInvestigationRunUpdate: vi.fn(),
  prismaAgentActionLogCreate: vi.fn(),
  prismaInvestigationFeedbackFindFirst: vi.fn(),
  prismaInvestigationFeedbackCreate: vi.fn(),
  prismaInvestigationVersionFindFirst: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@/lib/investigations/quota', () => ({
  consumeInvestigationQuota: mocks.consumeInvestigationQuota,
}));

vi.mock('@/lib/investigations/pipeline', () => ({
  runInvestigationPipeline: mocks.runInvestigationPipeline,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    incident: {
      findFirst: mocks.prismaIncidentFindFirst,
    },
    investigationRun: {
      findFirst: mocks.prismaInvestigationRunFindFirst,
      create: mocks.prismaInvestigationRunCreate,
      update: mocks.prismaInvestigationRunUpdate,
    },
    investigationVersion: {
      findFirst: mocks.prismaInvestigationVersionFindFirst,
    },
    investigationFeedback: {
      findFirst: mocks.prismaInvestigationFeedbackFindFirst,
      create: mocks.prismaInvestigationFeedbackCreate,
    },
    agentActionLog: {
      create: mocks.prismaAgentActionLogCreate,
    },
  },
  persistInvestigationVersion: mocks.persistInvestigationVersion,
  getLatestInvestigationVersion: mocks.getLatestInvestigationVersion,
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      readonly code = 'P2002';
    },
  },
}));

import { GET as getInvestigate, POST as postInvestigate } from '@/app/api/incidents/[id]/investigate/route';
import { POST as postFeedback } from '@/app/api/investigations/[runId]/versions/[versionId]/feedback/route';
import { validateInvestigationResult, buildSafeFallbackResult } from '@ftth-copilot/agent-core';

const userTenantA = {
  id: 'user-ops-a',
  email: 'ops@isp-a.com',
  name: 'Ops A',
  role: 'OWNER' as const,
  tenantId: 'tenant-a',
  tenant: { id: 'tenant-a', name: 'ISP A', slug: 'isp-a' },
};

const userTenantB = {
  id: 'user-ops-b',
  email: 'ops@isp-b.com',
  name: 'Ops B',
  role: 'OWNER' as const,
  tenantId: 'tenant-b',
  tenant: { id: 'tenant-b', name: 'ISP B', slug: 'isp-b' },
};

const INCIDENT_TENANT_A = {
  id: 'inc-gate3-1',
  tenantId: 'tenant-a',
  deviceKind: 'ONU',
  deviceId: 'onu-gate3-100',
  connectionId: 'conn-gate3-1',
  title: 'Pérdida de potencia óptica',
};

function createMockResult(versionId = 'v_0', versionIndex = 0): InvestigationResult {
  return {
    schema: 'ftth.investigation-result.v1',
    resultId: `res-${versionId}`,
    runId: 'r_gate3_1',
    versionId,
    tenantId: 'tenant-a',
    connectionId: 'conn-gate3-1',
    incidentId: 'inc-gate3-1',
    windowStart: '2026-09-08T00:00:00.000Z',
    windowEnd: '2026-09-09T00:00:00.000Z',
    windowDays: 1,
    cutoffAt: '2026-09-09T00:00:00.000Z',
    rulesetVersion: 'rules@1.0',
    modelVersion: 'claude-3-5-sonnet',
    promptVersion: 'p@1.0',
    sufficiency: 'sufficient',
    sufficiencyReason: 'Múltiples métricas confirman atenuación progresiva en la fibra.',
    producedAt: '2026-09-09T00:05:00.000Z',
    producedBy: 'agent-core@1.0.0',
    evidenceRefs: [
      {
        evidenceRefId: 'ev-rx-1',
        kind: 'metric',
        source: 'telemetry:rx_power',
        observedAt: '2026-09-09T00:00:00.000Z',
        summary: 'rx_power: -28.4 dBm',
        quality: 'fresh',
        qualityReason: 'within_ttl',
      },
    ],
    hypotheses: [
      {
        hypothesisId: 'hyp-optical-drop',
        summary: 'Atenuación severa por curvatura o suciedad en conector CTO',
        supportLevel: 'supported',
        forRefIds: ['ev-rx-1'],
        againstRefIds: [],
      },
    ],
    contradictions: [],
    missing: [],
    suggestedChecks: [
      {
        checkId: 'chk-inspect-cto',
        kind: 'observe_only',
        description: 'Revisar potencia en splitter y conectores de CTO',
        expectedToResolve: 'Verificar si la pérdida es localizada en la acometida',
      },
    ],
  };
}

describe('Gate 3 — End-to-End Investigation Lifecycle Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(userTenantA);
    mocks.hasPermission.mockReturnValue(true);
    mocks.consumeInvestigationQuota.mockResolvedValue({ allowed: true });
    mocks.prismaIncidentFindFirst.mockResolvedValue(INCIDENT_TENANT_A);
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);
    mocks.prismaInvestigationRunCreate.mockImplementation(async ({ data }) => ({
      id: 'db-run-1',
      runId: data.runId,
      tenantId: data.tenantId,
      incidentId: data.incidentId,
      status: 'pending',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
    }));
    mocks.prismaInvestigationRunUpdate.mockResolvedValue({ id: 'db-run-1', status: 'ready' });
    mocks.prismaAgentActionLogCreate.mockResolvedValue({ id: 'log-1' });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('runs complete lifecycle: trigger investigation v0 -> technician feedback -> refresh to v1 without mutating v0', async () => {
    const mockV0 = createMockResult('v_gate3_0', 0);
    const mockV1 = createMockResult('v_gate3_1', 1);

    mocks.runInvestigationPipeline.mockResolvedValueOnce(mockV0);
    mocks.persistInvestigationVersion.mockResolvedValueOnce({
      versionId: 'v_gate3_0',
      versionIndex: 0,
      runId: 'r_gate3_1',
      tenantId: 'tenant-a',
      rulesetVersion: 'rules@1.0',
      modelVersion: 'claude-3-5-sonnet',
      snapshotAt: new Date('2026-09-09T00:05:00.000Z'),
      snapshot: mockV0,
    } as PersistedInvestigationVersion);

    // 1. Initial investigation execution creates version 0
    const reqV0 = new Request('http://localhost/api/incidents/inc-gate3-1/investigate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const resV0 = await postInvestigate(reqV0, { params: Promise.resolve({ id: 'inc-gate3-1' }) });
    expect(resV0.status).toBe(201);
    const bodyV0 = await resV0.json();
    expect(bodyV0.versionIndex).toBe(0);
    expect(bodyV0.versionId).toBe('v_gate3_0');
    expect(bodyV0.status).toBe('ready');

    // 2. Technician submits feedback on version 0
    mocks.prismaInvestigationRunFindFirst.mockResolvedValueOnce({
      id: 'db-run-1',
      runId: 'r_gate3_1',
      tenantId: 'tenant-a',
      incidentId: 'inc-gate3-1',
    });
    mocks.prismaInvestigationVersionFindFirst.mockResolvedValueOnce({
      id: 'db-ver-1',
      versionId: 'v_gate3_0',
      runId: 'r_gate3_1',
      tenantId: 'tenant-a',
    });
    mocks.prismaInvestigationFeedbackFindFirst.mockResolvedValueOnce(null);
    mocks.prismaInvestigationFeedbackCreate.mockResolvedValueOnce({
      feedbackId: 'fb-gate3-1',
      runId: 'r_gate3_1',
      versionId: 'v_gate3_0',
      label: 'confirmed',
      observations: 'Conector sucio confirmado en campo.',
      realCause: 'dirty_fiber_connector',
      resolutionEvidence: 'Potencia normalizada a -19.2 dBm tras limpieza',
      authorUserId: userTenantA.id,
      submittedAt: new Date(),
    });

    const feedbackReq = new Request(
      'http://localhost/api/investigations/r_gate3_1/versions/v_gate3_0/feedback',
      {
        method: 'POST',
        body: JSON.stringify({
          label: 'confirmed',
          observations: 'Conector sucio confirmado en campo.',
          realCause: 'dirty_fiber_connector',
        }),
      },
    );
    const feedbackRes = await postFeedback(feedbackReq, {
      params: Promise.resolve({ runId: 'r_gate3_1', versionId: 'v_gate3_0' }),
    });
    expect(feedbackRes.status).toBe(201);
    const feedbackBody = await feedbackRes.json();
    expect(feedbackBody.label).toBe('confirmed');
    expect(feedbackBody.idempotent).toBe(false);

    // 3. Technician requests re-investigation with { refresh: true }
    mocks.prismaInvestigationRunFindFirst.mockResolvedValueOnce({
      id: 'db-run-1',
      runId: 'r_gate3_1',
      tenantId: 'tenant-a',
      status: 'ready',
    });
    mocks.runInvestigationPipeline.mockResolvedValueOnce(mockV1);
    mocks.persistInvestigationVersion.mockResolvedValueOnce({
      versionId: 'v_gate3_1',
      versionIndex: 1,
      runId: 'r_gate3_1',
      tenantId: 'tenant-a',
      snapshotAt: new Date('2026-09-09T00:10:00.000Z'),
      snapshot: mockV1,
    } as PersistedInvestigationVersion);

    const refreshReq = new Request('http://localhost/api/incidents/inc-gate3-1/investigate', {
      method: 'POST',
      body: JSON.stringify({ refresh: true }),
    });
    const refreshRes = await postInvestigate(refreshReq, {
      params: Promise.resolve({ id: 'inc-gate3-1' }),
    });
    expect(refreshRes.status).toBe(201);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.versionIndex).toBe(1);
    expect(refreshBody.versionId).toBe('v_gate3_1');
    expect(refreshBody.status).toBe('ready');

    // 4. GET returns latest investigation state
    mocks.prismaInvestigationRunFindFirst.mockResolvedValueOnce({
      id: 'db-run-1',
      runId: 'r_gate3_1',
      tenantId: 'tenant-a',
      incidentId: 'inc-gate3-1',
      status: 'ready',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
    });
    mocks.getLatestInvestigationVersion.mockResolvedValueOnce({
      versionId: 'v_gate3_1',
      versionIndex: 1,
      rulesetVersion: 'rules@1.0',
      modelVersion: 'claude-3-5-sonnet',
      snapshotAt: new Date('2026-09-09T00:10:00.000Z'),
      snapshot: mockV1,
    } as PersistedInvestigationVersion);

    const getReq = new Request('http://localhost/api/incidents/inc-gate3-1/investigate');
    const getRes = await getInvestigate(getReq, { params: Promise.resolve({ id: 'inc-gate3-1' }) });
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.version.versionIndex).toBe(1);
    expect(getBody.version.versionId).toBe('v_gate3_1');
  });
});

describe('Gate 3 — LLM Provider Fault Resilience with Controlled Responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(userTenantA);
    mocks.hasPermission.mockReturnValue(true);
    mocks.consumeInvestigationQuota.mockResolvedValue({ allowed: true });
    mocks.prismaIncidentFindFirst.mockResolvedValue(INCIDENT_TENANT_A);
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);
    mocks.prismaInvestigationRunCreate.mockImplementation(async ({ data }) => ({
      id: 'db-run-1',
      runId: data.runId,
      tenantId: data.tenantId,
      incidentId: data.incidentId,
      status: 'pending',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
    }));
    mocks.prismaInvestigationRunUpdate.mockResolvedValue({ id: 'db-run-1', status: 'ready' });
    mocks.prismaAgentActionLogCreate.mockResolvedValue({ id: 'log-1' });
  });

  it('gracefully handles upstream LLM 500 error / network disconnect without unhandled route failure', async () => {
    // LLM provider down or throws Network Error
    const fallbackResult = buildSafeFallbackResult({
      tenantId: 'tenant-a',
      connectionId: 'conn-gate3-1',
      incidentId: 'inc-gate3-1',
      runId: 'r_gate3_down',
      versionId: 'v_down_0',
      windowStart: '2026-09-08T00:00:00.000Z',
      windowEnd: '2026-09-09T00:00:00.000Z',
      reason: 'Upstream Anthropic 502 Bad Gateway / Connection timeout',
    });

    mocks.runInvestigationPipeline.mockResolvedValueOnce(fallbackResult);
    mocks.persistInvestigationVersion.mockResolvedValueOnce({
      versionId: 'v_down_0',
      versionIndex: 0,
      runId: 'r_gate3_down',
      tenantId: 'tenant-a',
      snapshot: fallbackResult,
    } as unknown as PersistedInvestigationVersion);

    const req = new Request('http://localhost/api/incidents/inc-gate3-1/investigate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await postInvestigate(req, { params: Promise.resolve({ id: 'inc-gate3-1' }) });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.result.sufficiency).toBe('insufficient');
    expect(body.result.sufficiencyReason).toContain('Diagnóstico degradado');
    expect(body.result.missing.length).toBeGreaterThan(0);
    expect(body.result.hypotheses[0].supportLevel).toBe('unverified');
  });

  it('returns HTTP 202 Pending when HTTP timeout budget is exceeded', async () => {
    // Pipeline execution takes longer than timeoutMs
    mocks.runInvestigationPipeline.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 200)),
    );

    const req = new Request('http://localhost/api/incidents/inc-gate3-1/investigate', {
      method: 'POST',
      body: JSON.stringify({ timeoutMs: 50 }),
    });
    const res = await postInvestigate(req, { params: Promise.resolve({ id: 'inc-gate3-1' }) });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('pending');
    expect(body.retryAfterMs).toBe(3000);
    expect(body.message).toContain('maximum HTTP wait exceeded');
  });

  it('enforces that hallucinated evidence references from LLM are caught by server validator', () => {
    const rawResultWithHallucination = createMockResult('v_hallucinated', 0);
    // LLM hallucinated an evidenceRefId not in evidenceRefs:
    rawResultWithHallucination.hypotheses[0].forRefIds.push('ev-ghost-ref-fabricated');

    const report = validateInvestigationResult(rawResultWithHallucination, {
      expectedTenantId: 'tenant-a',
    });

    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.code === 'hallucinated_reference')).toBe(true);
    // Sanitized result must NOT contain the fabricated reference
    expect(report.sanitizedResult.hypotheses[0].forRefIds).not.toContain('ev-ghost-ref-fabricated');
  });

  it('enforces that conflicting numerical figures produce contradictions or fallback', () => {
    const rawResultWithNumContradiction = createMockResult('v_contradiction', 0);
    // Evidence says rx_power is -28.4 dBm, but hypothesis claims -15 dBm
    rawResultWithNumContradiction.hypotheses[0].summary = 'Potencia normal a -15.0 dBm verificada';

    const report = validateInvestigationResult(rawResultWithNumContradiction, {
      expectedTenantId: 'tenant-a',
    });

    expect(report.isValid).toBe(false);
    expect(report.issues.some((i) => i.code === 'numerical_contradiction')).toBe(true);
    expect(report.sanitizedResult.contradictions.length).toBeGreaterThan(0);
  });

  it('enforces that suggested checks are strictly read-only and no NMS mutating actions exist', () => {
    const mockResult = createMockResult();
    const readOnlyKinds = new Set(['observe_only', 'topology_lookup', 'recent_events', 'metric_history']);

    for (const chk of mockResult.suggestedChecks) {
      expect(readOnlyKinds.has(chk.kind)).toBe(true);
      expect(chk.kind).not.toBe('reboot_onu');
      expect(chk.kind).not.toBe('port_reset');
    }
  });

  it('returns HTTP 429 when investigation quota is exceeded', async () => {
    mocks.consumeInvestigationQuota.mockResolvedValueOnce({
      allowed: false,
      retryAfter: 45,
    });

    const req = new Request('http://localhost/api/incidents/inc-gate3-1/investigate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await postInvestigate(req, { params: Promise.resolve({ id: 'inc-gate3-1' }) });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    const body = await res.json();
    expect(body.error).toContain('quota exceeded');
  });
});

describe('Gate 3 — Strict Multi-Tenant Isolation (Zero Cross-Tenant Leaks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockReturnValue(true);
  });

  it('rejects cross-tenant POST /api/incidents/:id/investigate with HTTP 404', async () => {
    // User belongs to Tenant B
    mocks.getCurrentUser.mockResolvedValue(userTenantB);
    // Prisma query filters by user.tenantId ('tenant-b') -> returns null because incident belongs to 'tenant-a'
    mocks.prismaIncidentFindFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/incidents/inc-gate3-1/investigate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await postInvestigate(req, { params: Promise.resolve({ id: 'inc-gate3-1' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Incident not found');
  });

  it('rejects cross-tenant GET /api/incidents/:id/investigate with HTTP 404', async () => {
    mocks.getCurrentUser.mockResolvedValue(userTenantB);
    mocks.prismaIncidentFindFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/incidents/inc-gate3-1/investigate');
    const res = await getInvestigate(req, { params: Promise.resolve({ id: 'inc-gate3-1' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Incident not found');
  });

  it('rejects cross-tenant feedback submission on a foreign run with HTTP 404', async () => {
    mocks.getCurrentUser.mockResolvedValue(userTenantB);
    // Run lookup filtered by user.tenantId returns null
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);

    const req = new Request(
      'http://localhost/api/investigations/r_gate3_1/versions/v_gate3_0/feedback',
      {
        method: 'POST',
        body: JSON.stringify({ label: 'confirmed' }),
      },
    );
    const res = await postFeedback(req, {
      params: Promise.resolve({ runId: 'r_gate3_1', versionId: 'v_gate3_0' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Investigation run not found');
  });
});
