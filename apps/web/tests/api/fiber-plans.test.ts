/**
 * Tests for `apps/web/app/api/fiber-plans/route.ts` and related routes.
 *
 * Uses vi.hoisted() to share mock state between vi.mock (hoisted to top of file)
 * and the test body, following the established pattern in the codebase.
 *
 * NOTE: vi.hoisted mocks persist their implementations across tests.
 * Tests that depend on specific mock state must set it explicitly in the test body
 * (not in beforeEach) to avoid cross-test contamination.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as uploadPlan, GET as listPlans } from '@/app/api/fiber-plans/route';
import { GET as getPlan } from '@/app/api/fiber-plans/[id]/route';
import { POST as createZone } from '@/app/api/fiber-plans/[id]/zones/route';
import { GET as correlate } from '@/app/api/fiber-plans/correlate/route';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakeAdmin = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Test Admin',
  role: 'ADMIN' as const,
  tenantId: 'tenant-1',
};

// ─── Hoisted mock state ───────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const fn = vi.fn();
  return {
    getCurrentUser: fn,
    hasPermission: fn,
    fiberPlan: { findMany: fn, findFirst: fn, create: fn, delete: fn },
    planZone: { findMany: fn, create: fn, findFirst: fn, delete: fn },
    planMarker: { findMany: fn },
    nmsConnection: { findFirst: fn },
  };
});

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    fiberPlan: {
      findMany: mocks.fiberPlan.findMany,
      findFirst: mocks.fiberPlan.findFirst,
      create: mocks.fiberPlan.create,
      delete: mocks.fiberPlan.delete,
    },
    planZone: {
      findMany: mocks.planZone.findMany,
      create: mocks.planZone.create,
      findFirst: mocks.planZone.findFirst,
      delete: mocks.planZone.delete,
    },
    planMarker: {
      findMany: mocks.planMarker.findMany,
    },
    nmsConnection: {
      findFirst: mocks.nmsConnection.findFirst,
    },
  },
}));

afterAll(() => { vi.restoreAllMocks(); });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetMocks() {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.fiberPlan.findMany.mockReset();
  mocks.fiberPlan.findFirst.mockReset();
  mocks.fiberPlan.create.mockReset();
  mocks.fiberPlan.delete.mockReset();
  mocks.planZone.findMany.mockReset();
  mocks.planZone.create.mockReset();
  mocks.planZone.findFirst.mockReset();
  mocks.planZone.delete.mockReset();
  mocks.planMarker.findMany.mockReset();
  mocks.nmsConnection.findFirst.mockReset();
}

// ─── GET /api/fiber-plans ─────────────────────────────────────────────────────

describe('GET /api/fiber-plans', () => {
  beforeEach(() => { resetMocks(); });

  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const res = await listPlans();
    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks view_network permission', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(false);
    const res = await listPlans();
    expect(res.status).toBe(403);
  });

  it('returns plans scoped to the user tenant', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.fiberPlan.findMany.mockResolvedValueOnce([
      {
        id: 'plan-1',
        name: 'Plano Norte',
        description: 'Barrio El Progreso',
        fileUrl: '/uploads/fiber-plans/test.png',
        mimeType: 'image/png',
        widthPx: 1920,
        heightPx: 1080,
        fileSizeBytes: null,
        connectionId: null,
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-01'),
        _count: { zones: 3 },
      },
    ]);
    const res = await listPlans();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plans).toBeInstanceOf(Array);
    expect(body.plans[0].name).toBe('Plano Norte');
    expect(body.plans[0].zoneCount).toBe(3);
    expect(mocks.fiberPlan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1' } }),
    );
  });

  it('returns empty array when no plans exist', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.fiberPlan.findMany.mockResolvedValueOnce([]);
    const res = await listPlans();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plans).toEqual([]);
    expect(body.count).toBe(0);
  });
});

// ─── GET /api/fiber-plans/correlate ──────────────────────────────────────────

describe('GET /api/fiber-plans/correlate', () => {
  beforeEach(() => { resetMocks(); });

  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    mocks.hasPermission.mockReturnValueOnce(false);
    const req = new Request('http://localhost/api/fiber-plans/correlate?deviceKind=OLT&deviceId=OLT-001');
    const res = await correlate(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when deviceKind is missing', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    const req = new Request('http://localhost/api/fiber-plans/correlate?deviceId=OLT-001');
    const res = await correlate(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('deviceKind');
  });

  it('returns 400 when deviceId is missing', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    const req = new Request('http://localhost/api/fiber-plans/correlate?deviceKind=OLT');
    const res = await correlate(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('deviceId');
  });

  it('returns 400 for invalid deviceKind', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    const req = new Request('http://localhost/api/fiber-plans/correlate?deviceKind=INVALID&deviceId=OLT-001');
    const res = await correlate(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid deviceKind');
  });

  it('returns plans grouped by marker device lookup', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.planMarker.findMany.mockResolvedValueOnce([
      {
        id: 'marker-1',
        tenantId: 'tenant-1',
        zoneId: 'zone-1',
        label: 'OLT Central',
        deviceKind: 'OLT',
        deviceId: 'OLT-001',
        xPercent: 45.5,
        yPercent: 32.1,
        createdAt: new Date(),
        zone: {
          id: 'zone-1',
          name: 'Zona Norte',
          color: '#f23077',
          plan: {
            id: 'plan-1',
            name: 'Plano Norte',
            fileUrl: '/uploads/fiber-plans/test.png',
            mimeType: 'image/png',
          },
        },
      },
    ]);
    const req = new Request('http://localhost/api/fiber-plans/correlate?deviceKind=OLT&deviceId=OLT-001');
    const res = await correlate(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deviceKind).toBe('OLT');
    expect(body.deviceId).toBe('OLT-001');
    expect(body.plans).toBeInstanceOf(Array);
    expect(body.plans[0].plan.name).toBe('Plano Norte');
    expect(body.plans[0].markers[0].label).toBe('OLT Central');
    expect(body.totalPlans).toBe(1);
  });

  it('returns empty plans when no marker matches', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.planMarker.findMany.mockResolvedValueOnce([]);
    const req = new Request('http://localhost/api/fiber-plans/correlate?deviceKind=ONU&deviceId=UNKNOWN');
    const res = await correlate(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plans).toEqual([]);
    expect(body.totalPlans).toBe(0);
  });
});

// ─── POST /api/fiber-plans (upload) ──────────────────────────────────────────

describe('POST /api/fiber-plans', () => {
  beforeEach(() => { resetMocks(); });

  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    mocks.hasPermission.mockReturnValueOnce(false);
    const body = new FormData();
    body.set('name', 'Test Plan');
    const req = new Request('http://localhost/api/fiber-plans', { method: 'POST', body });
    const res = await uploadPlan(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    const body = new FormData();
    body.set('file', new File(['fake'], 'test.png', { type: 'image/png' }));
    const req = new Request('http://localhost/api/fiber-plans', { method: 'POST', body });
    const res = await uploadPlan(req);
    expect(res.status).toBe(400);
    const body2 = await res.json();
    expect(body2.error).toContain('name');
  });

  it('returns 400 when file is missing', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    const body = new FormData();
    body.set('name', 'Test Plan');
    const req = new Request('http://localhost/api/fiber-plans', { method: 'POST', body });
    const res = await uploadPlan(req);
    expect(res.status).toBe(400);
    const body2 = await res.json();
    expect(body2.error).toContain('file');
  });

  it('returns 400 for unsupported MIME type', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    const body = new FormData();
    body.set('name', 'Test Plan');
    body.set('file', new File(['fake-content'], 'test.exe', { type: 'application/x-msdownload' }));
    const req = new Request('http://localhost/api/fiber-plans', { method: 'POST', body });
    const res = await uploadPlan(req);
    expect(res.status).toBe(400);
    const body2 = await res.json();
    expect(body2.error).toContain('Unsupported file type');
  });
});

// ─── GET /api/fiber-plans/[id] ───────────────────────────────────────────────

describe('GET /api/fiber-plans/[id]', () => {
  beforeEach(() => { resetMocks(); });

  it('returns 404 when plan not found', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.fiberPlan.findFirst.mockResolvedValueOnce(null);
    const routeContext = { params: Promise.resolve({ id: 'nonexistent' }) };
    const res = await getPlan(new Request('http://localhost'), routeContext);
    expect(res.status).toBe(404);
  });

  it('returns plan with zones and markers when found', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.fiberPlan.findFirst.mockResolvedValueOnce({
      id: 'plan-1',
      name: 'Plano Norte',
      description: 'Barrio El Progreso',
      fileUrl: '/uploads/fiber-plans/test.png',
      mimeType: 'image/png',
      widthPx: 1920,
      heightPx: 1080,
      fileSizeBytes: null,
      connectionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      zones: [
        {
          id: 'zone-1',
          name: 'Zona Norte',
          description: null,
          color: '#f23077',
          createdAt: new Date(),
          _count: { markers: 2 },
          markers: [
            { id: 'm1', label: 'OLT 1', deviceKind: 'OLT', deviceId: 'OLT-001', xPercent: 10, yPercent: 20, createdAt: new Date() },
            { id: 'm2', label: 'Splitter A', deviceKind: 'SPLITTER', deviceId: 'SPL-A', xPercent: 30, yPercent: 40, createdAt: new Date() },
          ],
        },
      ],
    });
    const routeContext = { params: Promise.resolve({ id: 'plan-1' }) };
    const res = await getPlan(new Request('http://localhost'), routeContext);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan.name).toBe('Plano Norte');
    expect(body.plan.zones).toBeInstanceOf(Array);
    expect(body.plan.zones[0].markers).toBeInstanceOf(Array);
    expect(body.plan.zones[0].markerCount).toBe(2);
  });
});

// ─── POST /api/fiber-plans/[id]/zones ────────────────────────────────────────

describe('POST /api/fiber-plans/[id]/zones', () => {
  beforeEach(() => { resetMocks(); });

  it('creates a zone with the provided name', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.fiberPlan.findFirst.mockResolvedValueOnce({ id: 'plan-1' });
    mocks.planZone.create.mockImplementationOnce(
      // Prisma calls: prisma.planZone.create({ data: { tenantId, planId, name, description, color } })
      async (args: any) => {
        const d = args?.data ?? args;
        return {
          id: 'zone-new',
          tenantId: String(d?.tenantId ?? 'tenant-1'),
          planId: String(d?.planId ?? 'plan-1'),
          name: String(d?.name ?? 'Unnamed Zone'),
          description: d?.description ?? null,
          color: String(d?.color ?? '#6366F1'),
          createdAt: new Date(),
        };
      },
    );
    const routeContext = { params: Promise.resolve({ id: 'plan-1' }) };
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zona Sur', color: '#3b82f6' }),
    });
    const res = await createZone(req, routeContext);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.zone.name).toBe('Zona Sur');
    expect(body.zone.color).toBe('#3b82f6');
  });

  it('returns 400 for invalid color format', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.fiberPlan.findFirst.mockResolvedValueOnce({ id: 'plan-1' });
    const routeContext = { params: Promise.resolve({ id: 'plan-1' }) };
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zona Test', color: 'not-a-color' }),
    });
    const res = await createZone(req, routeContext);
    expect(res.status).toBe(400);
  });

  it('returns 404 when plan does not exist', async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(fakeAdmin);
    mocks.hasPermission.mockReturnValueOnce(true);
    mocks.fiberPlan.findFirst.mockResolvedValueOnce(null);
    const routeContext = { params: Promise.resolve({ id: 'nonexistent' }) };
    const req = new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zona Test' }),
    });
    const res = await createZone(req, routeContext);
    expect(res.status).toBe(404);
  });
});
