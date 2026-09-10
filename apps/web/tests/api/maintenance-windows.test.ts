import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/auth/permissions';

/**
 * RED tests for the maintenance-window routes:
 *   - POST   /api/maintenance-windows
 *   - GET    /api/maintenance-windows
 *   - DELETE /api/maintenance-windows/:id
 *
 * Contract under test (Roadmap Fase 5 — 5.1, 5.2):
 *   1. POST is gated on `manage_maintenance` — 403 without it.
 *   2. Body validation: title, startUtc, endUtc, timezone, scope
 *      all required; endUtc must be > startUtc.
 *   3. Overlapping windows of the same tenant → 409 with the
 *      overlapping window's id, title, start, end (deterministic).
 *   4. Happy path: creates the row with status 'scheduled',
 *      createdByUserId = user.id.
 *   5. DELETE on a scheduled window soft-cancels (status='cancelled',
 *      cancelledAt, cancelledByUserId, cancellationReason).
 *   6. DELETE on a 'cancelled' or 'completed' window → 409.
 *   7. Tenant isolation: a t_A user can NEVER see or cancel a t_B
 *      window (404, not 403, to avoid leaking existence).
 *   8. GET returns windows intersecting the requested range
 *      (default now ± 24 h).
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaMaintenanceFindMany: vi.fn(),
  prismaMaintenanceCreate: vi.fn(),
  prismaMaintenanceFindUnique: vi.fn(),
  prismaMaintenanceUpdate: vi.fn(),
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
      findMany: mocks.prismaMaintenanceFindMany,
      create: mocks.prismaMaintenanceCreate,
      findUnique: mocks.prismaMaintenanceFindUnique,
      update: mocks.prismaMaintenanceUpdate,
    },
  },
}));

import { POST as createWindow, GET as listWindows } from '@/app/api/maintenance-windows/route';
import { DELETE as cancelWindow } from '@/app/api/maintenance-windows/[id]/route';

const fakeUser = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'ADMIN' as Role,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const fakeOtherUser = {
  ...fakeUser,
  id: 'user-2',
  tenantId: 'tenant-2',
  tenant: { id: 'tenant-2', name: 'Other ISP', slug: 'other' },
};

beforeEach(() => {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaMaintenanceFindMany.mockReset();
  mocks.prismaMaintenanceCreate.mockReset();
  mocks.prismaMaintenanceFindUnique.mockReset();
  mocks.prismaMaintenanceUpdate.mockReset();
  // Default: admin who passes manage_maintenance.
  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/maintenance-windows', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/maintenance-windows (5.1 + 5.2)', () => {
  it('returns 401 when not authenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await createWindow(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user lacks manage_maintenance', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await createWindow(makeRequest({
      title: 'Maintenance',
      startUtc: '2026-09-10T12:00:00.000Z',
      endUtc: '2026-09-10T13:00:00.000Z',
      timezone: 'UTC',
      scope: { kind: 'tenant' },
    }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.missing).toBe('manage_maintenance');
  });

  it('returns 400 when endUtc <= startUtc', async () => {
    const res = await createWindow(makeRequest({
      title: 'Bad window',
      startUtc: '2026-09-10T13:00:00.000Z',
      endUtc: '2026-09-10T12:00:00.000Z',
      timezone: 'UTC',
      scope: { kind: 'tenant' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when scope.kind=connection without id', async () => {
    const res = await createWindow(makeRequest({
      title: 'Bad scope',
      startUtc: '2026-09-10T12:00:00.000Z',
      endUtc: '2026-09-10T13:00:00.000Z',
      timezone: 'UTC',
      scope: { kind: 'connection' },
    }));
    expect(res.status).toBe(400);
  });

  it('returns 409 when an overlapping non-cancelled window exists (5.2)', async () => {
    mocks.prismaMaintenanceFindMany.mockResolvedValue([
      {
        id: 'mw_overlap',
        tenantId: 'tenant-1',
        title: 'Existing window',
        description: null,
        scopeJson: '{"kind":"tenant"}',
        startUtc: new Date('2026-09-10T12:30:00.000Z'),
        endUtc: new Date('2026-09-10T13:30:00.000Z'),
        timezone: 'UTC',
        status: 'scheduled',
        createdByUserId: 'user-0',
        createdAt: new Date('2026-09-10T11:00:00.000Z'),
        updatedAt: new Date('2026-09-10T11:00:00.000Z'),
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
      },
    ]);
    const res = await createWindow(makeRequest({
      title: 'New window',
      startUtc: '2026-09-10T12:00:00.000Z',
      endUtc: '2026-09-10T13:00:00.000Z',
      timezone: 'UTC',
      scope: { kind: 'tenant' },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.overlappingWindowId).toBe('mw_overlap');
  });

  it('happy path: creates the row and returns 201', async () => {
    mocks.prismaMaintenanceFindMany.mockResolvedValue([]);
    mocks.prismaMaintenanceCreate.mockResolvedValue({
      id: 'mw_new',
      tenantId: 'tenant-1',
      title: 'Splice on CTO-1',
      description: null,
      scopeJson: '{"kind":"tenant"}',
      startUtc: new Date('2026-09-10T22:00:00.000Z'),
      endUtc: new Date('2026-09-11T00:00:00.000Z'),
      timezone: 'UTC',
      status: 'scheduled',
      createdByUserId: 'user-1',
      createdAt: new Date('2026-09-10T11:00:00.000Z'),
      updatedAt: new Date('2026-09-10T11:00:00.000Z'),
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    });
    const res = await createWindow(makeRequest({
      title: 'Splice on CTO-1',
      startUtc: '2026-09-10T22:00:00.000Z',
      endUtc: '2026-09-11T00:00:00.000Z',
      timezone: 'UTC',
      scope: { kind: 'tenant' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('mw_new');
    expect(body.createdByUserId).toBe('user-1');
    expect(body.status).toBe('scheduled');
  });

  it('cancelled windows do NOT trigger overlap (deterministic, evidence intact)', async () => {
    mocks.prismaMaintenanceFindMany.mockResolvedValue([
      {
        id: 'mw_cancelled',
        tenantId: 'tenant-1',
        title: 'Cancelled window',
        description: null,
        scopeJson: '{"kind":"tenant"}',
        startUtc: new Date('2026-09-10T12:00:00.000Z'),
        endUtc: new Date('2026-09-10T13:00:00.000Z'),
        timezone: 'UTC',
        status: 'cancelled',
        createdByUserId: 'user-0',
        createdAt: new Date('2026-09-10T11:00:00.000Z'),
        updatedAt: new Date('2026-09-10T11:00:00.000Z'),
        cancelledAt: new Date('2026-09-10T11:30:00.000Z'),
        cancelledByUserId: 'user-0',
        cancellationReason: 'rolled back',
      },
    ]);
    mocks.prismaMaintenanceCreate.mockResolvedValue({
      id: 'mw_new',
      tenantId: 'tenant-1',
      title: 'Replacement',
      description: null,
      scopeJson: '{"kind":"tenant"}',
      startUtc: new Date('2026-09-10T12:00:00.000Z'),
      endUtc: new Date('2026-09-10T13:00:00.000Z'),
      timezone: 'UTC',
      status: 'scheduled',
      createdByUserId: 'user-1',
      createdAt: new Date('2026-09-10T11:00:00.000Z'),
      updatedAt: new Date('2026-09-10T11:00:00.000Z'),
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    });
    const res = await createWindow(makeRequest({
      title: 'Replacement',
      startUtc: '2026-09-10T12:00:00.000Z',
      endUtc: '2026-09-10T13:00:00.000Z',
      timezone: 'UTC',
      scope: { kind: 'tenant' },
    }));
    expect(res.status).toBe(201);
  });
});

describe('GET /api/maintenance-windows', () => {
  it('returns windows intersecting the requested range', async () => {
    mocks.prismaMaintenanceFindMany.mockResolvedValue([
      {
        id: 'mw_1',
        tenantId: 'tenant-1',
        title: 'Window A',
        description: null,
        scopeJson: '{"kind":"tenant"}',
        startUtc: new Date('2026-09-10T08:00:00.000Z'),
        endUtc: new Date('2026-09-10T10:00:00.000Z'),
        timezone: 'UTC',
        status: 'scheduled',
        createdByUserId: 'user-1',
        createdAt: new Date('2026-09-10T07:00:00.000Z'),
        updatedAt: new Date('2026-09-10T07:00:00.000Z'),
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
      },
    ]);
    const res = await listWindows(new Request('http://localhost/api/maintenance-windows'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windows).toHaveLength(1);
    expect(body.windows[0]!.id).toBe('mw_1');
  });

  it('returns 401 when not authenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await listWindows(new Request('http://localhost/api/maintenance-windows'));
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/maintenance-windows/:id', () => {
  function makeDeleteRequest(id: string, body: unknown): Request {
    return new Request(`http://localhost/api/maintenance-windows/${id}`, {
      method: 'DELETE',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  }

  it('returns 401 when not authenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await cancelWindow(
      makeDeleteRequest('mw_1', { cancellationReason: 'rolled back' }),
      { params: Promise.resolve({ id: 'mw_1' }) } as never,
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 without manage_maintenance', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await cancelWindow(
      makeDeleteRequest('mw_1', { cancellationReason: 'rolled back' }),
      { params: Promise.resolve({ id: 'mw_1' }) } as never,
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the window does not exist', async () => {
    mocks.prismaMaintenanceFindUnique.mockResolvedValue(null);
    const res = await cancelWindow(
      makeDeleteRequest('mw_404', { cancellationReason: 'rolled back' }),
      { params: Promise.resolve({ id: 'mw_404' }) } as never,
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 (NOT 403) when the window belongs to another tenant — tenant isolation', async () => {
    mocks.prismaMaintenanceFindUnique.mockResolvedValue({
      id: 'mw_other',
      tenantId: 'tenant-2',
      title: 'Other',
      description: null,
      scopeJson: '{"kind":"tenant"}',
      startUtc: new Date('2026-09-10T12:00:00.000Z'),
      endUtc: new Date('2026-09-10T13:00:00.000Z'),
      timezone: 'UTC',
      status: 'scheduled',
      createdByUserId: 'user-2',
      createdAt: new Date('2026-09-10T11:00:00.000Z'),
      updatedAt: new Date('2026-09-10T11:00:00.000Z'),
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    });
    const res = await cancelWindow(
      makeDeleteRequest('mw_other', { cancellationReason: 'rolled back' }),
      { params: Promise.resolve({ id: 'mw_other' }) } as never,
    );
    expect(res.status).toBe(404);
  });

  it('returns 409 when the window is already cancelled', async () => {
    mocks.prismaMaintenanceFindUnique.mockResolvedValue({
      id: 'mw_cancelled',
      tenantId: 'tenant-1',
      title: 'Cancelled',
      description: null,
      scopeJson: '{"kind":"tenant"}',
      startUtc: new Date('2026-09-10T12:00:00.000Z'),
      endUtc: new Date('2026-09-10T13:00:00.000Z'),
      timezone: 'UTC',
      status: 'cancelled',
      createdByUserId: 'user-1',
      createdAt: new Date('2026-09-10T11:00:00.000Z'),
      updatedAt: new Date('2026-09-10T11:00:00.000Z'),
      cancelledAt: new Date('2026-09-10T11:30:00.000Z'),
      cancelledByUserId: 'user-1',
      cancellationReason: 'rolled back',
    });
    const res = await cancelWindow(
      makeDeleteRequest('mw_cancelled', { cancellationReason: 'rolled back' }),
      { params: Promise.resolve({ id: 'mw_cancelled' }) } as never,
    );
    expect(res.status).toBe(409);
  });

  it('happy path: soft-cancels the row', async () => {
    mocks.prismaMaintenanceFindUnique.mockResolvedValue({
      id: 'mw_1',
      tenantId: 'tenant-1',
      title: 'Window',
      description: null,
      scopeJson: '{"kind":"tenant"}',
      startUtc: new Date('2026-09-10T22:00:00.000Z'),
      endUtc: new Date('2026-09-11T00:00:00.000Z'),
      timezone: 'UTC',
      status: 'scheduled',
      createdByUserId: 'user-1',
      createdAt: new Date('2026-09-10T11:00:00.000Z'),
      updatedAt: new Date('2026-09-10T11:00:00.000Z'),
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
    });
    mocks.prismaMaintenanceUpdate.mockResolvedValue({
      id: 'mw_1',
      tenantId: 'tenant-1',
      title: 'Window',
      description: null,
      scopeJson: '{"kind":"tenant"}',
      startUtc: new Date('2026-09-10T22:00:00.000Z'),
      endUtc: new Date('2026-09-11T00:00:00.000Z'),
      timezone: 'UTC',
      status: 'cancelled',
      createdByUserId: 'user-1',
      createdAt: new Date('2026-09-10T11:00:00.000Z'),
      updatedAt: new Date('2026-09-10T11:50:00.000Z'),
      cancelledAt: new Date('2026-09-10T11:50:00.000Z'),
      cancelledByUserId: 'user-1',
      cancellationReason: 'rolled back',
    });
    const res = await cancelWindow(
      makeDeleteRequest('mw_1', { cancellationReason: 'rolled back' }),
      { params: Promise.resolve({ id: 'mw_1' }) } as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('cancelled');
    expect(body.cancellationReason).toBe('rolled back');
    expect(body.cancelledByUserId).toBe('user-1');
  });
});
