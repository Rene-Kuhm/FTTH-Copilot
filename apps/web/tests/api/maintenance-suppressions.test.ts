import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaMaintenanceWindowFindUnique: vi.fn(),
  prismaAgentActionLogFindMany: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    maintenanceWindow: {
      findUnique: mocks.prismaMaintenanceWindowFindUnique,
    },
    agentActionLog: {
      findMany: mocks.prismaAgentActionLogFindMany,
    },
  },
}));

const fakeUser = {
  id: 'usr-1',
  email: 'admin@isp.com',
  name: 'Admin',
  role: 'ADMIN' as const,
  tenantId: 'tenant-1',
};

beforeEach(() => {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaMaintenanceWindowFindUnique.mockReset();
  mocks.prismaAgentActionLogFindMany.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(id: string): Promise<Response> {
  const { GET } = await import('@/app/api/maintenance-windows/[id]/suppressions/route');
  const req = new Request(`http://localhost/api/maintenance-windows/${id}/suppressions`, {
    method: 'GET',
  });
  return GET(req, { params: Promise.resolve({ id }) });
}

describe('GET /api/maintenance-windows/:id/suppressions — auth & permission gates', () => {
  it('returns 401 when no user is signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callRoute('win-1');
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks manage_maintenance', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(false);
    const res = await callRoute('win-1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when window does not exist', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(true);
    mocks.prismaMaintenanceWindowFindUnique.mockResolvedValue(null);
    const res = await callRoute('win-unknown');
    expect(res.status).toBe(404);
  });

  it('returns 404 when window belongs to another tenant (isolation)', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(true);
    mocks.prismaMaintenanceWindowFindUnique.mockResolvedValue({
      id: 'win-other',
      tenantId: 'tenant-2',
    });
    const res = await callRoute('win-other');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/maintenance-windows/:id/suppressions — happy path', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(true);
    mocks.prismaMaintenanceWindowFindUnique.mockResolvedValue({
      id: 'win-1',
      tenantId: 'tenant-1',
      title: 'Upgrade OLT',
    });
  });

  it('returns list of suppressed events for the window', async () => {
    mocks.prismaAgentActionLogFindMany.mockResolvedValue([
      {
        id: 'log-1',
        tenantId: 'tenant-1',
        toolName: '__maintenance_suppression__',
        parameters: {
          windowId: 'win-1',
          category: 'optical_loss',
          deviceKind: 'ONU',
          deviceId: 'ONU-001',
          whenMs: 1757498400000,
          reason: 'inside_active_maintenance_window',
        },
        createdAt: new Date('2026-09-10T12:00:00Z'),
      },
    ]);

    const res = await callRoute('win-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windowId).toBe('win-1');
    expect(body.suppressions).toHaveLength(1);
    expect(body.suppressions[0]).toMatchObject({
      id: 'log-1',
      windowId: 'win-1',
      deviceKind: 'ONU',
      deviceId: 'ONU-001',
      category: 'optical_loss',
    });
  });
});
