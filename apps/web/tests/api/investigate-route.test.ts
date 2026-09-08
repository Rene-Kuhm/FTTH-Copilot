import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for
 *   apps/web/app/api/incidents/[id]/investigate/route.ts
 *
 * Contract under test:
 *  1. Permission gate (403 without view_network).
 *  2. 404 when the incident does not exist in the caller's tenant.
 *  3. 201 on the first POST: creates InvestigationRun + a single
 *     InvestigationVersion (versionIndex = 0) with empty snapshot.
 *  4. 200 on the second POST: returns the existing run + version with
 *     idempotent: true, no new writes.
 *  5. Cross-tenant incidentId is rejected with 404 (NOT 403).
 *  6. AgentActionLog entry is written with toolName
 *     '__investigation_open__'.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaIncidentFindFirst: vi.fn(),
  prismaInvestigationRunFindFirst: vi.fn(),
  prismaInvestigationRunCreate: vi.fn(),
  prismaInvestigationVersionCreate: vi.fn(),
  prismaInvestigationVersionFindFirst: vi.fn(),
  prismaAgentActionLogCreate: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    incident: {
      findFirst: mocks.prismaIncidentFindFirst,
    },
    investigationRun: {
      findFirst: mocks.prismaInvestigationRunFindFirst,
      create: mocks.prismaInvestigationRunCreate,
    },
    investigationVersion: {
      findFirst: mocks.prismaInvestigationVersionFindFirst,
      create: mocks.prismaInvestigationVersionCreate,
    },
    agentActionLog: {
      create: mocks.prismaAgentActionLogCreate,
    },
  },
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

function resetMocks() {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaIncidentFindFirst.mockReset();
  mocks.prismaInvestigationRunFindFirst.mockReset();
  mocks.prismaInvestigationRunCreate.mockReset();
  mocks.prismaInvestigationVersionCreate.mockReset();
  mocks.prismaInvestigationVersionFindFirst.mockReset();
  mocks.prismaAgentActionLogCreate.mockReset();
  mocks.prismaIncidentFindFirst.mockResolvedValue(INCIDENT);
  mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);
  mocks.prismaInvestigationRunCreate.mockImplementation(({ data }) => ({
    runId: data.runId,
    status: data.status,
    createdAt: new Date('2026-09-07T09:00:00.000Z'),
  }));
  mocks.prismaInvestigationVersionCreate.mockImplementation(({ data }) => ({
    versionId: data.versionId,
    versionIndex: data.versionIndex,
  }));
  mocks.prismaInvestigationVersionFindFirst.mockImplementation(({ where }) => ({
    versionId: where.runId === 'r_existing' ? 'v_existing' : 'v_init',
  }));
  mocks.prismaAgentActionLogCreate.mockImplementation(({ data }) => ({
    id: 'log-1',
    ...data,
  }));
}

beforeEach(() => {
  resetMocks();
  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(id: string): Promise<Response> {
  const { POST } = await import('@/app/api/incidents/[id]/investigate/route');
  const req = new Request(`http://localhost/api/incidents/${id}/investigate`, {
    method: 'POST',
  });
  return POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ id }),
  });
}

describe('POST /api/incidents/:id/investigate — permission gate', () => {
  it('returns 403 when the user lacks view_network', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await callRoute('inc-1');
    expect(res.status).toBe(403);
    expect(mocks.prismaIncidentFindFirst).not.toHaveBeenCalled();
    expect(mocks.prismaInvestigationRunCreate).not.toHaveBeenCalled();
  });

  it('returns 401 when no user is authenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callRoute('inc-1');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/incidents/:id/investigate — incident lookup', () => {
  it('returns 404 when the incident does not exist in this tenant', async () => {
    mocks.prismaIncidentFindFirst.mockResolvedValue(null);
    const res = await callRoute('inc-foreign');
    expect(res.status).toBe(404);
    expect(mocks.prismaInvestigationRunCreate).not.toHaveBeenCalled();
  });

  it('queries incidents with the caller tenantId (cross-tenant denied)', async () => {
    await callRoute('inc-1');
    expect(mocks.prismaIncidentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-1' }),
      }),
    );
  });
});

describe('POST /api/incidents/:id/investigate — happy path', () => {
  it('creates one run + one version (versionIndex = 0) + AgentActionLog', async () => {
    const res = await callRoute('inc-1');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string; versionId: string; idempotent: boolean };
    expect(body.idempotent).toBe(false);
    expect(body.runId).toMatch(/^r_[0-9a-f]{32}$/);
    expect(body.versionId).toMatch(/^v_[0-9a-f]{32}$/);

    const runArgs = mocks.prismaInvestigationRunCreate.mock.calls[0]?.[0] as {
      data: {
        tenantId: string;
        incidentId: string;
        connectionId: string | null;
        requestedByUserId: string;
        status: string;
        runId: string;
      };
    };
    expect(runArgs.data.tenantId).toBe('tenant-1');
    expect(runArgs.data.incidentId).toBe('inc-1');
    expect(runArgs.data.connectionId).toBe('conn-1');
    expect(runArgs.data.requestedByUserId).toBe('user-1');
    expect(runArgs.data.status).toBe('pending');

    const verArgs = mocks.prismaInvestigationVersionCreate.mock.calls[0]?.[0] as {
      data: {
        tenantId: string;
        runId: string;
        versionId: string;
        versionIndex: number;
        snapshotJson: unknown;
      };
    };
    expect(verArgs.data.tenantId).toBe('tenant-1');
    expect(verArgs.data.runId).toBe(runArgs.data.runId);
    expect(verArgs.data.versionId).toBe(body.versionId);
    expect(verArgs.data.versionIndex).toBe(0);
    expect(verArgs.data.snapshotJson).toEqual({
      incident: { deviceKind: 'ONU', deviceId: 'onu-1' },
    });

    const logArgs = mocks.prismaAgentActionLogCreate.mock.calls[0]?.[0] as {
      data: { toolName: string; result: string };
    };
    expect(logArgs.data.toolName).toBe('__investigation_open__');
    expect(logArgs.data.result).toBe(runArgs.data.runId);
  });
});

describe('POST /api/incidents/:id/investigate — idempotency', () => {
  it('returns 200 with idempotent: true on a second POST (no new writes)', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue({
      runId: 'r_existing',
      status: 'pending',
      createdAt: new Date('2026-09-07T09:00:00.000Z'),
    });
    const res = await callRoute('inc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; versionId: string; idempotent: boolean };
    expect(body.runId).toBe('r_existing');
    expect(body.versionId).toBe('v_existing');
    expect(body.idempotent).toBe(true);

    expect(mocks.prismaInvestigationRunCreate).not.toHaveBeenCalled();
    expect(mocks.prismaInvestigationVersionCreate).not.toHaveBeenCalled();
    expect(mocks.prismaAgentActionLogCreate).not.toHaveBeenCalled();
  });
});
