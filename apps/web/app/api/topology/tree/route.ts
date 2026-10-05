import { NextResponse } from 'next/server';
import { prisma } from '@ftth-copilot/db';
import { topologyNodeKindSchema } from '@ftth-copilot/shared';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TreeNode {
  kind: string;
  id: string;
  children: TreeNode[];
  /** Number of direct + transitive downstream nodes (excluding self). */
  downstreamCount: number;
}

function buildTree(
  edges: Array<{ parentKind: string; parentId: string; childKind: string; childId: string }>,
): { roots: TreeNode[]; nodeCount: number } {
  // Count downstream per node (out-degree in the tree)
  const outDegree = new Map<string, number>();
  for (const e of edges) {
    outDegree.set(e.parentId, (outDegree.get(e.parentId) ?? 0) + 1);
  }

  const childrenOf = new Map<string, TreeNode[]>();
  for (const e of edges) {
    if (!childrenOf.has(e.parentId)) childrenOf.set(e.parentId, []);
    childrenOf.get(e.parentId)!.push({ kind: e.childKind, id: e.childId, children: [], downstreamCount: 0 });
  }

  // Merge duplicate child nodes (same id+kind under same parent)
  const seen = new Map<string, TreeNode>();
  for (const [parentId, kids] of childrenOf) {
    childrenOf.set(parentId, []);
    for (const k of kids) {
      const key = `${k.kind}:${k.id}`;
      if (!seen.has(key)) {
        seen.set(key, k);
        childrenOf.get(parentId)!.push(k);
      }
    }
  }

  // Build downstream count recursively
  function countDownstream(node: TreeNode): number {
    const kids = childrenOf.get(node.id) ?? [];
    node.children = kids;
    const direct = kids.length;
    const transitive = kids.reduce((s, c) => s + countDownstream(c), 0);
    node.downstreamCount = direct + transitive;
    return direct + transitive;
  }

  // Root nodes: those that never appear as a child
  const childIds = new Set(edges.map(e => e.childId));
  const nodes = new Map<string, TreeNode>();
  for (const e of edges) {
    if (!nodes.has(e.parentId)) {
      nodes.set(e.parentId, { kind: e.parentKind, id: e.parentId, children: [], downstreamCount: 0 });
    }
    if (!nodes.has(e.childId)) {
      nodes.set(e.childId, { kind: e.childKind, id: e.childId, children: [], downstreamCount: 0 });
    }
  }
  for (const [id, node] of nodes) {
    if (!childIds.has(id)) {
      countDownstream(node);
    }
  }

  const roots = [...nodes.values()].filter(n => !childIds.has(n.id));
  for (const r of roots) countDownstream(r);
  roots.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  return { roots, nodeCount: nodes.size };
}

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const rows = await prisma.topologyEdge.findMany({
    where: { tenantId: user.tenantId, validTo: null },
    select: { parentKind: true, parentId: true, childKind: true, childId: true },
  });

  // Cast via safe-parse (DB stores as strings; enum is enforced at write-time)
  const edges = rows
    .map(r => ({
      parentKind: topologyNodeKindSchema.safeParse(r.parentKind).success ? r.parentKind : 'OLT',
      parentId: r.parentId,
      childKind: topologyNodeKindSchema.safeParse(r.childKind).success ? r.childKind : 'PON_PORT',
      childId: r.childId,
    }));

  const { roots, nodeCount } = buildTree(edges);

  return NextResponse.json({ roots, nodeCount, count: roots.length });
}
