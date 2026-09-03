import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { topologyNodeKindSchema, type TopologyEdge } from '@ftth-copilot/shared';
import { bfsDownstream } from '@ftth-copilot/evidence';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOPOLOGY_DOWNSTREAM_SCHEMA = 'ftth.topology.v1' as const;

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
 * GET /api/topology/downstream?kind=&id=
 *
 * Returns every reachable ONU id from a tenant-scoped topology device.
 * Gates:
 *   - 401 unauthenticated
 *   - 403 missing `view_network`
 *   - 400 missing/invalid `kind` / empty `id`
 *   - 404 cross-tenant device id (existence-disclosure safe)
 *   - 200 with `{schema, kind, id, onuIds, edgesTraversed}`; `onuIds`
 *     defaults to `[]` for an unreachable device.
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

  // Cross-tenant 404 guard (same logic as /path).
  const existsInAnyTenant = await prisma.topologyEdge.findFirst({
    where: {
      OR: [{ parentKind: kindParse.data, parentId: idParam }, { childKind: kindParse.data, childId: idParam }],
    },
    select: { tenantId: true },
  });
  if (existsInAnyTenant && existsInAnyTenant.tenantId !== user.tenantId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const onuIds = bfsDownstream(topologyEdges, kindParse.data, idParam);
  // Count of active edges actually walked: equivalent to the count of
  // unique downstream reachable nodes minus the root (one hop per node).
  // Implemented inline here to avoid the agent-core's internal helper.
  let edgesTraversed = 0;
  {
    const visited = new Set<string>([`${kindParse.data}:${idParam}`]);
    let frontier: Array<{ kind: typeof kindParse.data; id: string }> = [
      { kind: kindParse.data, id: idParam },
    ];
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        for (const e of topologyEdges) {
          if (e.parentKind !== node.kind || e.parentId !== node.id) continue;
          const k = `${e.childKind}:${e.childId}`;
          if (visited.has(k)) continue;
          visited.add(k);
          edgesTraversed += 1;
          next.push({ kind: e.childKind, id: e.childId });
        }
      }
      frontier = next;
    }
  }

  return NextResponse.json({
    schema: TOPOLOGY_DOWNSTREAM_SCHEMA,
    kind: kindParse.data,
    id: idParam,
    onuIds,
    edgesTraversed,
  });
}