import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for `apps/web/app/api/topology/downstream/route.ts` (E-6.2).
 *
 * Contract:
 *   - 401 unauthenticated
 *   - 403 missing `view_network`
 *   - 400 missing/invalid `kind` / empty `id`
 *   - 404 cross-tenant device id
 *   - 200 happy path with `{schema, kind, id, onuIds, edgesTraversed}`.
 *   - 200 with `{onuIds: [], edgesTraversed: 0}` for a leaf device.
 *   - Expired edges are filtered (Prisma `where: {validTo: null}`).
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaTopologyEdgeFindMany: vi.fn(),
  prismaTopologyEdgeFindFirst: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    topologyEdge: {
      findMany: mocks.prismaTopologyEdgeFindMany,
      findFirst: mocks.prismaTopologyEdgeFindFirst,
    },
  },
}));

const fakeOwner = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const fakeMember = {
  ...fakeOwner,
  role: 'MEMBER' as const,
};

function edge(partial: {
  id: string;
  tenantId: string;
  parentKind: string;
  parentId: string;
  childKind: string;
  childId: string;
  validFrom?: string;
  validTo?: string | null;
}) {
  return {
    id: partial.id,
    tenantId: partial.tenantId,
    parentKind: partial.parentKind,
    parentId: partial.parentId,
    childKind: partial.childKind,
    childId: partial.childId,
    validFrom: partial.validFrom ?? '2026-09-01T00:00:00.000Z',
    validTo: partial.validTo === undefined ? null : partial.validTo,
    source: 'manual:test',
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaTopologyEdgeFindMany.mockReset();
  mocks.prismaTopologyEdgeFindFirst.mockReset();
  mocks.prismaTopologyEdgeFindMany.mockResolvedValue([]);
  mocks.prismaTopologyEdgeFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(query: Record<string, string>): Promise<Response> {
  const { GET } = await import('@/app/api/topology/downstream/route');
  const qs = new URLSearchParams(query).toString();
  const req = new Request(`http://localhost/api/topology/downstream?${qs}`, {
    method: 'GET',
  });
  return GET(req as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/topology/downstream — auth + permission gates', () => {
  it('returns 401 when no user is signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callRoute({ kind: 'OLT', id: 'OLT-1' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user lacks view_network', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeMember);
    mocks.hasPermission.mockReturnValue(false);
    const res = await callRoute({ kind: 'OLT', id: 'OLT-1' });
    expect(res.status).toBe(403);
    expect(mocks.prismaTopologyEdgeFindMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/topology/downstream — validation', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(fakeOwner);
    mocks.hasPermission.mockReturnValue(true);
  });

  it('returns 400 when kind is missing', async () => {
    const res = await callRoute({ id: 'OLT-1' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when id is missing', async () => {
    const res = await callRoute({ kind: 'OLT' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when kind is not a valid TopologyNodeKind', async () => {
    const res = await callRoute({ kind: 'DSLAM', id: 'X' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/topology/downstream — happy path', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(fakeOwner);
    mocks.hasPermission.mockReturnValue(true);
  });

  it('returns the downstream ONU set for an OLT with three direct children', async () => {
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([
      edge({ id: 'te-1', tenantId: 'tenant-1', parentKind: 'OLT', parentId: 'OLT-1', childKind: 'ONU', childId: 'ONU-1' }),
      edge({ id: 'te-2', tenantId: 'tenant-1', parentKind: 'OLT', parentId: 'OLT-1', childKind: 'ONU', childId: 'ONU-2' }),
      edge({ id: 'te-3', tenantId: 'tenant-1', parentKind: 'OLT', parentId: 'OLT-1', childKind: 'ONU', childId: 'ONU-3' }),
    ]);
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue({ tenantId: 'tenant-1' });

    const res = await callRoute({ kind: 'OLT', id: 'OLT-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schema: string;
      kind: string;
      id: string;
      onuIds: string[];
      edgesTraversed: number;
    };
    expect(body.schema).toBe('ftth.topology.v1');
    expect(body.kind).toBe('OLT');
    expect(body.id).toBe('OLT-1');
    expect(body.onuIds.sort()).toEqual(['ONU-1', 'ONU-2', 'ONU-3']);
    expect(body.edgesTraversed).toBe(3);
    // Prisma read scoped by tenantId AND filtered by validTo: null.
    const args = mocks.prismaTopologyEdgeFindMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; validTo: null };
    };
    expect(args.where.tenantId).toBe('tenant-1');
    expect(args.where.validTo).toBeNull();
  });

  it('returns onuIds: [] and edgesTraversed: 0 for a leaf device', async () => {
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([
      edge({ id: 'te-1', tenantId: 'tenant-1', parentKind: 'OLT', parentId: 'OTHER-OLT', childKind: 'ONU', childId: 'ONU-1' }),
    ]);
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue(null);

    const res = await callRoute({ kind: 'OLT', id: 'LEAF-OLT' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { onuIds: string[]; edgesTraversed: number };
    expect(body.onuIds).toEqual([]);
    expect(body.edgesTraversed).toBe(0);
  });

  it('returns 404 when the device exists in another tenant', async () => {
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([]);
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue({ tenantId: 'tenant-2' });

    const res = await callRoute({ kind: 'OLT', id: 'OLT-OTHER' });
    expect(res.status).toBe(404);
  });

  it('excludes expired edges and returns the surviving downstream set', async () => {
    // Prisma already filtered; we mirror the DB after the {validTo: null} read.
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([
      edge({ id: 'te-2', tenantId: 'tenant-1', parentKind: 'OLT', parentId: 'OLT-1', childKind: 'ONU', childId: 'ONU-2' }),
    ]);
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue({ tenantId: 'tenant-1' });

    const res = await callRoute({ kind: 'OLT', id: 'OLT-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { onuIds: string[]; edgesTraversed: number };
    expect(body.onuIds).toEqual(['ONU-2']);
    expect(body.edgesTraversed).toBe(1);
  });
});