/**
 * Pure-TS BFS helpers over the Fase E `TopologyEdge` table.
 *
 * No I/O, no Prisma, no `Date.now()` calls inside the helpers — every input
 * is data, every output is deterministic. Caller (the agent-core tool or the
 * web route) is responsible for scoping the edge list by tenant and by
 * `validTo: null` (we still defensively re-filter `validTo` here, so the
 * helpers stay correct when callers pass unfiltered slices).
 *
 * Cycle safety: every helper walks through a `Set<\`${kind}:${id}\`>` guard
 * keyed on the visited *node* (kind + id). The root node is always
 * considered visited — the result never includes the root itself.
 */
import type { TopologyEdge, TopologyNodeKind } from '@ftth-copilot/shared';

export interface TopologyHop {
  kind: TopologyNodeKind;
  id: string;
}

/**
 * Determines whether a TopologyEdge is valid at a given point in time (asOf).
 *
 * If asOf is provided:
 *   An edge is valid at instant T if validFrom <= T and (validTo === null || validTo > T).
 * If asOf is omitted or null/undefined:
 *   Maintains backward compatibility by returning true only for currently active edges (validTo === null).
 */
export function isEdgeValidAt(
  edge: TopologyEdge,
  asOf?: string | Date | number | null,
): boolean {
  if (asOf === undefined || asOf === null) {
    return edge.validTo === null || edge.validTo === undefined;
  }

  const asOfMs =
    typeof asOf === 'number'
      ? asOf
      : typeof asOf === 'string'
        ? new Date(asOf).getTime()
        : asOf.getTime();

  if (Number.isNaN(asOfMs)) {
    return edge.validTo === null || edge.validTo === undefined;
  }

  const validFromMs = new Date(edge.validFrom).getTime();
  if (!Number.isNaN(validFromMs) && validFromMs > asOfMs) {
    return false;
  }

  if (edge.validTo !== null && edge.validTo !== undefined) {
    const validToMs = new Date(edge.validTo).getTime();
    if (!Number.isNaN(validToMs) && validToMs <= asOfMs) {
      return false;
    }
  }

  return true;
}

function hopKey(kind: TopologyNodeKind, id: string): string {
  return `${kind}:${id}`;
}

/**
 * BFS from a root node, descending along parent → child edges. Returns the
 * childIds of every reachable `ONU` node (terminal leaves). The root node
 * itself is never in the result.
 *
 * Scoped by point-in-time validity via `asOf` when specified, or active edges
 * (`validTo: null`) when omitted.
 *
 * Duplicate child IDs that appear behind distinct paths collapse to a
 * single entry (Set guard keyed on the *node*, not on the edge).
 */
export function bfsDownstream(
  edges: ReadonlyArray<TopologyEdge>,
  rootKind: TopologyNodeKind,
  rootId: string,
  asOf?: string | Date | number | null,
): string[] {
  const active = edges.filter((e) => isEdgeValidAt(e, asOf));
  const visited = new Set<string>([hopKey(rootKind, rootId)]);
  const onuIds = new Set<string>();
  let frontier: TopologyHop[] = [{ kind: rootKind, id: rootId }];

  while (frontier.length > 0) {
    const nextFrontier: TopologyHop[] = [];
    for (const node of frontier) {
      for (const edge of active) {
        if (edge.parentKind !== node.kind || edge.parentId !== node.id) continue;
        const childKey = hopKey(edge.childKind, edge.childId);
        if (visited.has(childKey)) continue;
        visited.add(childKey);
        nextFrontier.push({ kind: edge.childKind, id: edge.childId });
        if (edge.childKind === 'ONU') onuIds.add(edge.childId);
      }
    }
    frontier = nextFrontier;
  }

  return Array.from(onuIds).sort();
}

/**
 * Reverse BFS from a leaf node, walking child → parent edges. Returns the
 * chain root-first (e.g. `[{OLT, OLT-1}, {PON_PORT, PON-1}, …]`). The leaf
 * itself is not in the result. If the leaf is unreachable, returns `[]`.
 *
 * Scoped by point-in-time validity via `asOf` when specified, or active edges
 * (`validTo: null`) when omitted.
 *
 * BFS explores by levels from the leaf, so the immediate parent is pushed
 * first; the helper returns the *reversed* path so the root of the chain
 * (typically an OLT) is the first element. The cycle guard is keyed on the
 * *node*, never on the edge.
 */
export function bfsAncestors(
  edges: ReadonlyArray<TopologyEdge>,
  leafKind: TopologyNodeKind,
  leafId: string,
  asOf?: string | Date | number | null,
): TopologyHop[] {
  const active = edges.filter((e) => isEdgeValidAt(e, asOf));
  const visited = new Set<string>([hopKey(leafKind, leafId)]);
  const pathLeafFirst: TopologyHop[] = [];
  let frontier: TopologyHop[] = [{ kind: leafKind, id: leafId }];

  while (frontier.length > 0) {
    const nextFrontier: TopologyHop[] = [];
    for (const node of frontier) {
      for (const edge of active) {
        if (edge.childKind !== node.kind || edge.childId !== node.id) continue;
        const parentKey = hopKey(edge.parentKind, edge.parentId);
        if (visited.has(parentKey)) continue;
        visited.add(parentKey);
        pathLeafFirst.push({ kind: edge.parentKind, id: edge.parentId });
        nextFrontier.push({ kind: edge.parentKind, id: edge.parentId });
      }
    }
    frontier = nextFrontier;
  }

  return pathLeafFirst.reverse();
}

/**
 * Convenience: `bfsAncestors` reversed to leaf-first order — useful for
 * UIs that want to render the device tree from the leaf outwards. Per the
 * spec the leaf appears first, then its immediate parent, and so on up to
 * the OLT root.
 */
export function topologyPath(
  edges: ReadonlyArray<TopologyEdge>,
  leafKind: TopologyNodeKind,
  leafId: string,
  asOf?: string | Date | number | null,
): TopologyHop[] {
  const ancestorsRootFirst = bfsAncestors(edges, leafKind, leafId, asOf);
  if (ancestorsRootFirst.length === 0) return [];
  // Reverse so the leaf is first; the root OLT (or highest reachable node)
  // ends up last.
  return [
    { kind: leafKind, id: leafId },
    ...ancestorsRootFirst.slice().reverse(),
  ];
}