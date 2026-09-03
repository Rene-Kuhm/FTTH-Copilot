import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for `apps/web/app/api/topology/path/route.ts` (E-6.1).
 *
 * Contract:
 *   - 401 when no user is signed in.
 *   - 403 when the signed-in user lacks `view_network`.
 *   - 400 when `kind` or `id` is missing/invalid.
 *   - 404 when the device exists in another tenant (cross-tenant guard).
 *   - 200 happy path with `{schema, kind, id, path: Array<{kind,id}>`}.
 *   - 200 with `path: []` when the device has no edges in this tenant.
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

const fakeUserWithNetwork = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const fakeUserNoNetwork = {
  ...fakeUserWithNetwork,
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
  const { GET } = await import('@/app/api/topology/path/route');
  const qs = new URLSearchParams(query).toString();
  const req = new Request(`http://localhost/api/topology/path?${qs}`, {
    method: 'GET',
  });
  return GET(req as unknown as Parameters<typeof GET>[0]);
}

describe('GET /api/topology/path — auth + permission gates', () => {
  it('returns 401 when no user is signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callRoute({ kind: 'OLT', id: 'OLT-1' });
    expect(res.status).toBe(401);
    expect(mocks.prismaTopologyEdgeFindMany).not.toHaveBeenCalled();
  });

  it('returns 403 when the user lacks view_network', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeUserNoNetwork);
    mocks.hasPermission.mockReturnValue(false);
    const res = await callRoute({ kind: 'OLT', id: 'OLT-1' });
    expect(res.status).toBe(403);
    expect(mocks.prismaTopologyEdgeFindMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/topology/path — validation', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(fakeUserWithNetwork);
    mocks.hasPermission.mockReturnValue(true);
  });

  it('returns 400 when kind is missing', async () => {
    const res = await callRoute({ id: 'OLT-1' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/kind/);
  });

  it('returns 400 when id is missing', async () => {
    const res = await callRoute({ kind: 'OLT' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when kind is not a valid TopologyNodeKind', async () => {
    const res = await callRoute({ kind: 'SWITCH', id: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when id is empty string', async () => {
    const res = await callRoute({ kind: 'OLT', id: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/topology/path — happy path', () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(fakeUserWithNetwork);
    mocks.hasPermission.mockReturnValue(true);
  });

  it('returns the leaf-first path for an OLT → ONU chain', async () => {
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([
      edge({ id: 'te-1', tenantId: 'tenant-1', parentKind: 'OLT', parentId: 'OLT-1', childKind: 'PON_PORT', childId: 'PON-1' }),
      edge({ id: 'te-2', tenantId: 'tenant-1', parentKind: 'PON_PORT', parentId: 'PON-1', childKind: 'CTO', childId: 'CTO-1' }),
      edge({ id: 'te-3', tenantId: 'tenant-1', parentKind: 'CTO', parentId: 'CTO-1', childKind: 'ONU', childId: 'ONU-1' }),
    ]);
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue({ tenantId: 'tenant-1' });

    const res = await callRoute({ kind: 'ONU', id: 'ONU-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schema: string;
      kind: string;
      id: string;
      path: Array<{ kind: string; id: string }>;
    };
    expect(body.schema).toBe('ftth.topology.v1');
    expect(body.kind).toBe('ONU');
    expect(body.id).toBe('ONU-1');
    expect(body.path).toEqual([
      { kind: 'ONU', id: 'ONU-1' },
      { kind: 'CTO', id: 'CTO-1' },
      { kind: 'PON_PORT', id: 'PON-1' },
      { kind: 'OLT', id: 'OLT-1' },
    ]);
    // Prisma read scoped by tenantId AND filtered by validTo: null.
    expect(mocks.prismaTopologyEdgeFindMany).toHaveBeenCalledTimes(1);
    const args = mocks.prismaTopologyEdgeFindMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; validTo: null };
    };
    expect(args.where.tenantId).toBe('tenant-1');
    expect(args.where.validTo).toBeNull();
  });

  it('returns 200 with empty path when the device has no edges in this tenant', async () => {
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([]);
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue(null);

    const res = await callRoute({ kind: 'OLT', id: 'UNKNOWN' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: unknown[] };
    expect(body.path).toEqual([]);
  });

  it('returns 404 when the device exists in another tenant', async () => {
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([]);
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue({ tenantId: 'tenant-2' });

    const res = await callRoute({ kind: 'OLT', id: 'OLT-OTHER' });
    expect(res.status).toBe(404);
  });

  it('excludes edges whose validTo is set', async () => {
    mocks.prismaTopologyEdgeFindMany.mockResolvedValue([]); // DB already filtered
    mocks.prismaTopologyEdgeFindFirst.mockResolvedValue({ tenantId: 'tenant-1' });

    const res = await callRoute({ kind: 'ONU', id: 'ONU-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: unknown[] };
    expect(body.path).toEqual([]);
    const args = mocks.prismaTopologyEdgeFindMany.mock.calls[0]?.[0] as {
      where: { validTo: null };
    };
    expect(args.where.validTo).toBeNull();
  });
});