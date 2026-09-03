import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { topologyNodeKindSchema, type TopologyEdge } from '@ftth-copilot/shared';
import { topologyPath } from '@ftth-copilot/evidence';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOPOLOGY_PATH_SCHEMA = 'ftth.topology.v1' as const;

interface PrismaTopologyEdgeRow {
  id: string;
  tenantId: string;
  parentKind: string;
  parentId: string;
  childKind: string;
  childId: string;
  validFrom: Date | string;
  validTo: Date | string | null;
  source: string;
  createdAt: Date | string;
}

function toIsoString(value: Date | string | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return value.toISOString();
}

function toTopologyEdgeEnvelope(row: PrismaTopologyEdgeRow): TopologyEdge {
  return {
    schema: 'ftth.topology-edge.v1',
    id: row.id,
    tenantId: row.tenantId,
    parentKind: topologyNodeKindSchema.parse(row.parentKind),
    parentId: row.parentId,
    childKind: topologyNodeKindSchema.parse(row.childKind),
    childId: row.childId,
    validFrom: toIsoString(row.validFrom),
    validTo: row.validTo === null || row.validTo === undefined ? null : toIsoString(row.validTo),
    source: row.source,
    createdAt: toIsoString(row.createdAt),
  };
}

/**
 * GET /api/topology/path?kind=&id=
 *
 * Returns the leaf-first ancestor chain for a tenant-scoped topology
 * device. Gates:
 *   - 401 unauthenticated
 *   - 403 missing `view_network`
 *   - 400 missing/invalid `kind` / empty `id`
 *   - 404 cross-tenant device id (existence-disclosure safe)
 *   - 200 with `{schema, kind, id, path: Array<{kind,id}>}`; `path` may be
 *     `[]` for an unreachable device within the tenant.
 *
 * All Prisma reads scope by `user.tenantId` and filter `validTo: null`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const url = new URL(request.url);
  const kindParam = url.searchParams.get('kind');
  const idParam = url.searchParams.get('id');

  if (!kindParam || !idParam) {
    return NextResponse.json(
      { error: 'Missing required query params: kind, id' },
      { status: 400 },
    );
  }
  const kindParse = topologyNodeKindSchema.safeParse(kindParam);
  if (!kindParse.success) {
    return NextResponse.json(
      { error: `Invalid kind: ${kindParam}` },
      { status: 400 },
    );
  }
  if (idParam.trim().length === 0) {
    return NextResponse.json({ error: 'id must be non-empty' }, { status: 400 });
  }

  const edges = await prisma.topologyEdge.findMany({
    where: { tenantId: user.tenantId, validTo: null },
    select: {
      id: true,
      tenantId: true,
      parentKind: true,
      parentId: true,
      childKind: true,
      childId: true,
      validFrom: true,
      validTo: true,
      source: true,
      createdAt: true,
    },
  });

  const topologyEdges = edges.map(toTopologyEdgeEnvelope);

  // Cross-tenant guard: if the device id exists but only in another tenant
  // we already filtered it out → 404. If the device has zero edges in this
  // tenant AND we can't find it in the global table → 404. If the device
  // exists in this tenant's table → 200 with the (possibly empty) path.
  const existsInAnyTenant = await prisma.topologyEdge.findFirst({
    where: {
      OR: [{ parentKind: kindParse.data, parentId: idParam }, { childKind: kindParse.data, childId: idParam }],
    },
    select: { tenantId: true },
  });
  if (existsInAnyTenant && existsInAnyTenant.tenantId !== user.tenantId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const path = topologyPath(topologyEdges, kindParse.data, idParam);
  return NextResponse.json({
    schema: TOPOLOGY_PATH_SCHEMA,
    kind: kindParse.data,
    id: idParam,
    path,
  });
}