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

const fakeUser = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const INCIDENT = {
  id: 'inc-1',
  deviceKind: 'ONU',
  deviceId: 'onu-1',
  connectionId: 'conn-1',
};

const validSnapshot: InvestigationResult = {
  schema: 'ftth.investigation-result.v1',
  resultId: 'res-test-1',
  runId: 'r_test',
  versionId: 'v_test',
  tenantId: 'tenant-1',
  connectionId: 'conn-1',
  incidentId: 'inc-1',
  windowStart: '2026-09-08T00:00:00.000Z',
  windowEnd: '2026-09-09T00:00:00.000Z',
  windowDays: 1,
  cutoffAt: '2026-09-09T00:00:00.000Z',
  rulesetVersion: 'ruleset@1.0.0',
  modelVersion: 'test-model',
  promptVersion: 'prompt@1.0.0',
  evidenceRefs: [],
  hypotheses: [
    {
      hypothesisId: 'hyp-1',
      summary: 'Atenuación severa detectada',
      supportLevel: 'supported',
      forRefIds: [],
      againstRefIds: [],
    },
  ],
  contradictions: [],
  missing: [],
  suggestedChecks: [],
  sufficiency: 'sufficient',
  sufficiencyReason: 'Evidencia consistente',
  producedAt: '2026-09-09T00:01:00.000Z',
  producedBy: 'agent-core@0.1.0',
};

const persistedVersionV0: PersistedInvestigationVersion = {
  id: 'db-ver-0',
  tenantId: 'tenant-1',
  runId: 'r_test',
  versionId: 'v_test',
  versionIndex: 0,
  rulesetVersion: 'ruleset@1.0.0',
  promptVersion: 'prompt@1.0.0',
  modelVersion: 'test-model',
  snapshot: validSnapshot,
  snapshotAt: new Date('2026-09-09T00:01:00.000Z'),
};

function resetMocks() {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.consumeInvestigationQuota.mockReset();
  mocks.runInvestigationPipeline.mockReset();
  mocks.persistInvestigationVersion.mockReset();
  mocks.getLatestInvestigationVersion.mockReset();
  mocks.prismaIncidentFindFirst.mockReset();
  mocks.prismaInvestigationRunFindFirst.mockReset();
  mocks.prismaInvestigationRunCreate.mockReset();
  mocks.prismaInvestigationRunUpdate.mockReset();
  mocks.prismaAgentActionLogCreate.mockReset();

  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
  mocks.consumeInvestigationQuota.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.prismaIncidentFindFirst.mockResolvedValue(INCIDENT);
  mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);
  mocks.runInvestigationPipeline.mockResolvedValue(validSnapshot);
  mocks.persistInvestigationVersion.mockResolvedValue(persistedVersionV0);
  mocks.getLatestInvestigationVersion.mockResolvedValue(persistedVersionV0);
  mocks.prismaInvestigationRunCreate.mockImplementation(({ data }) => ({
    id: 'run-row-1',
    ...data,
    requestedAt: new Date('2026-09-09T00:00:00.000Z'),
  }));
  mocks.prismaInvestigationRunUpdate.mockImplementation(({ data }) => ({
    id: 'run-row-1',
    ...data,
  }));
  mocks.prismaAgentActionLogCreate.mockImplementation(({ data }) => ({
    id: 'log-1',
    ...data,
  }));
}

beforeEach(() => {
  resetMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callPost(id: string, body: Record<string, unknown> = {}): Promise<Response> {
  const { POST } = await import('@/app/api/incidents/[id]/investigate/route');
  const req = new Request(`http://localhost/api/incidents/${id}/investigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ id }),
  });
}

async function callGet(id: string): Promise<Response> {
  const { GET } = await import('@/app/api/incidents/[id]/investigate/route');
  const req = new Request(`http://localhost/api/incidents/${id}/investigate`, {
    method: 'GET',
  });
  return GET(req as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ id }),
  });
}

describe('POST /api/incidents/:id/investigate — security & quotas', () => {
  it('returns 403 when user lacks view_network', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await callPost('inc-1');
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callPost('inc-1');
    expect(res.status).toBe(401);
  });

  it('returns 429 with Retry-After when investigation quota is exceeded', async () => {
    mocks.consumeInvestigationQuota.mockResolvedValue({ allowed: false, retryAfter: 45 });
    const res = await callPost('inc-1');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    const json = (await res.json()) as { error: string; retryAfter: number };
    expect(json.retryAfter).toBe(45);
    expect(mocks.runInvestigationPipeline).not.toHaveBeenCalled();
  });

  it('returns 404 when incident does not belong to caller tenant', async () => {
    mocks.prismaIncidentFindFirst.mockResolvedValue(null);
    const res = await callPost('inc-other-tenant');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/incidents/:id/investigate — duplicate protection & concurrency', () => {
  it('returns 202 Pending when an investigation is already in-flight', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue({
      id: 'run-row-pending',
      runId: 'r_inflight',
      status: 'pending',
    });

    const res = await callPost('inc-1');
    expect(res.status).toBe(202);
    const json = (await res.json()) as { status: string; runId: string; retryAfterMs: number };
    expect(json.status).toBe('pending');
    expect(json.runId).toBe('r_inflight');
    expect(json.retryAfterMs).toBe(3000);
    expect(mocks.runInvestigationPipeline).not.toHaveBeenCalled();
  });
});

describe('POST /api/incidents/:id/investigate — happy path & refresh', () => {
  it('executes pipeline and returns 201 Created with full diagnosis on initial run', async () => {
    const res = await callPost('inc-1');
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      status: string;
      runId: string;
      versionId: string;
      versionIndex: number;
      result: InvestigationResult;
    };
    expect(body.status).toBe('ready');
    expect(body.versionIndex).toBe(0);
    expect(body.result.schema).toBe('ftth.investigation-result.v1');
    expect(mocks.runInvestigationPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.persistInvestigationVersion).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with idempotent: true when run is ready and refresh is not requested', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue({
      id: 'run-row-ready',
      runId: 'r_ready',
      status: 'ready',
    });

    const res = await callPost('inc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; idempotent: boolean };
    expect(body.status).toBe('ready');
    expect(body.idempotent).toBe(true);
    expect(mocks.runInvestigationPipeline).not.toHaveBeenCalled();
  });

  it('creates new version (versionIndex 1) when refresh: true is passed', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue({
      id: 'run-row-ready',
      runId: 'r_ready',
      status: 'ready',
    });
    mocks.persistInvestigationVersion.mockResolvedValue({
      ...persistedVersionV0,
      versionIndex: 1,
      versionId: 'v_refreshed_1',
    });

    const res = await callPost('inc-1', { refresh: true });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      status: string;
      versionIndex: number;
      idempotent: boolean;
    };
    expect(body.status).toBe('ready');
    expect(body.versionIndex).toBe(1);
    expect(body.idempotent).toBe(false);
    expect(mocks.runInvestigationPipeline).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/incidents/:id/investigate — timeout handling', () => {
  it('returns 202 Accepted pending response when execution exceeds timeoutMs', async () => {
    // Simulate pipeline taking longer than timeoutMs
    mocks.runInvestigationPipeline.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(validSnapshot), 200)),
    );

    const res = await callPost('inc-1', { timeoutMs: 50 });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; retryAfterMs: number };
    expect(body.status).toBe('pending');
    expect(body.retryAfterMs).toBe(3000);
  });
});

describe('GET /api/incidents/:id/investigate', () => {
  it('returns 404 when run does not exist for incident', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);
    const res = await callGet('inc-1');
    expect(res.status).toBe(404);
  });

  it('returns 200 with run status and latest version snapshot', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue({
      id: 'run-row-ready',
      runId: 'r_ready',
      status: 'ready',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
    });

    const res = await callGet('inc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runId: string;
      status: string;
      version: { versionId: string; versionIndex: number; snapshot: InvestigationResult };
    };
    expect(body.runId).toBe('r_ready');
    expect(body.status).toBe('ready');
    expect(body.version.versionIndex).toBe(0);
    expect(body.version.snapshot.schema).toBe('ftth.investigation-result.v1');
  });
});
