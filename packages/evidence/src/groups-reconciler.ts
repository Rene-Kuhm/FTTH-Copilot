/**
 * Topology-correlation group reconciler (Roadmap Fase 4 — 4.4).
 *
 * Background:
 *
 * `correlateByTopologyAndTime` (PR #130) emits raw groups per
 * pass. A nightly re-run emits overlapping groups: the same outage
 * on the same CTO appears twice. Roadmap 4.4 says:
 *   "Generar grupos reproducibles con deduplicación y asociación a
 *    incidentes originales. No borrar ni fusionar destructivamente
 *    evidencia previa."
 *
 * This module is the pure, non-destructive reconciler:
 *
 *   - **Dedup** by group identity (`tenantId`, `ancestorKind`,
 *     `ancestorId`, `windowStart`, `windowEnd`). Duplicates carry
 *     `duplicateOf: <canonicalGroupId>` and the canonical group
 *     carries `mergedGroupIds: string[]` listing every duplicate
 *     that survived the merge — nothing is destroyed.
 *
 *   - **Association** to confirmed incidents by temporal proximity:
 *     a group whose window starts within `associationWindowMs` of a
 *     confirmed incident's `createdAt` is associated, not merged.
 *     The original incident stays intact; the group carries
 *     `associatedIncidentId`.
 *
 * The reconciler is OFF by default (roadmap MUST-10); the consumer
 * passes the raw groups explicitly.
 */

import type {
  TopologyCorrelationGroup,
  ConfirmedIncident,
} from '@ftth-copilot/shared';

// ── Augmented group shape ──────────────────────────────────────────────────

/**
 * A topology-correlation group plus the reconciler's metadata.
 *
 * The reconciler NEVER mutates the input group: every augmentation
 * is additive (`duplicateOf`, `mergedGroupIds`, `associatedIncidentId`,
 * `reconciledAt`).
 */
export interface ReconciledGroup {
  /** The original group, verbatim. */
  readonly group: TopologyCorrelationGroup;
  /** Stable identity hash the reconciler computed. */
  readonly identityHash: string;
  /**
   * `canonicalGroupId` when this group is the representative of a
   * dedup cluster; `null` when the group has no duplicates. Every
   * group is canonical for itself when no duplicates exist.
   */
  readonly canonicalGroupId: string;
  /**
   * Other groups the canonical group absorbed (preserved; nothing
   * destroyed). Empty when no duplicates exist.
   */
  readonly mergedGroupIds: ReadonlyArray<string>;
  /**
   * Set when a duplicate carries `duplicateOf` pointing here.
   * Empty when this is not a duplicate.
   */
  readonly duplicateOf: string | null;
  /** Confirmed incident the group is associated with, or null. */
  readonly associatedIncidentId: string | null;
  /** When the reconciler ran. Pure consumers MUST pass it explicitly. */
  readonly reconciledAt: string;
}

// ── Identity projection ────────────────────────────────────────────────────

/**
 * Compose the canonical identity for a group. Two groups with the
 * same identity hash are considered the same incident.
 */
export function composeGroupIdentityKey(
  g: Pick<TopologyCorrelationGroup, 'tenantId' | 'ancestorKind' | 'ancestorId' | 'windowStart' | 'windowEnd'>,
): string {
  return [g.tenantId, g.ancestorKind, g.ancestorId, g.windowStart, g.windowEnd].join('|');
}

/** Project a group's identity hash (pure). */
export function groupIdentityHash(g: TopologyCorrelationGroup): string {
  return composeGroupIdentityKey(g);
}

// ── Dedup ──────────────────────────────────────────────────────────────────

export interface DedupArgs {
  groups: ReadonlyArray<TopologyCorrelationGroup>;
  /** When the reconciler ran; tests pass an explicit value. */
  reconciledAt: string;
}

/**
 * Deduplicate groups by identity. Pure: same input → same output.
 *
 * The first group in `groups` for a given identity hash is the
 * canonical representative; subsequent matches carry
 * `duplicateOf` and the canonical carries `mergedGroupIds`. Nothing
 * is deleted — every input group survives in the output.
 */
export function dedupGroups(args: DedupArgs): ReconciledGroup[] {
  const out: ReconciledGroup[] = [];
  const canonicalByHash = new Map<string, ReconciledGroup>();

  for (const g of args.groups) {
    const hash = groupIdentityHash(g);
    const canonical = canonicalByHash.get(hash);
    if (canonical === undefined) {
      const r: ReconciledGroup = {
        group: g,
        identityHash: hash,
        canonicalGroupId: g.groupId,
        mergedGroupIds: [],
        duplicateOf: null,
        associatedIncidentId: null,
        reconciledAt: args.reconciledAt,
      };
      canonicalByHash.set(hash, r);
      out.push(r);
      continue;
    }
    // Duplicate: append a duplicate entry that points at the canonical.
    out.push({
      group: g,
      identityHash: hash,
      canonicalGroupId: canonical.canonicalGroupId,
      mergedGroupIds: [],
      duplicateOf: canonical.canonicalGroupId,
      associatedIncidentId: null,
      reconciledAt: args.reconciledAt,
    });
    // Update the canonical in place — we are building the output
    // array and no consumer sees the canonical until after the loop.
    const merged = [...canonical.mergedGroupIds, g.groupId];
    canonicalByHash.set(hash, { ...canonical, mergedGroupIds: merged });
    const idx = out.indexOf(canonical);
    out[idx] = canonicalByHash.get(hash)!;
  }

  return out;
}

// ── Association to confirmed incidents (4.4) ──────────────────────────────

export interface AssociateArgs {
  groups: ReadonlyArray<ReconciledGroup>;
  incidents: ReadonlyArray<ConfirmedIncident>;
  /**
   * Maximum gap (ms) between a group's windowStart and a confirmed
   * incident's createdAt. Default 15 minutes.
   */
  associationWindowMs?: number;
}

/**
 * Associate groups with the nearest confirmed incident by temporal
 * proximity. Pure: same inputs → same output. The reconciled group
 * list is rebuilt — the input is not mutated.
 */
export function associateGroupsWithIncidents(args: AssociateArgs): ReconciledGroup[] {
  const windowMs = args.associationWindowMs ?? 15 * 60 * 1000;
  const incidentsByTenant = new Map<string, ConfirmedIncident[]>();
  for (const i of args.incidents) {
    let bucket = incidentsByTenant.get(i.tenantId);
    if (bucket === undefined) {
      bucket = [];
      incidentsByTenant.set(i.tenantId, bucket);
    }
    bucket.push(i);
  }
  for (const bucket of incidentsByTenant.values()) {
    bucket.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return args.groups.map((g) => {
    const bucket = incidentsByTenant.get(g.group.tenantId) ?? [];
    const groupStart = new Date(g.group.windowStart).getTime();
    let best: ConfirmedIncident | null = null;
    let bestGap = Infinity;
    for (const inc of bucket) {
      const incStart = new Date(inc.createdAt).getTime();
      const gap = Math.abs(incStart - groupStart);
      if (gap <= windowMs && gap < bestGap) {
        best = inc;
        bestGap = gap;
      }
    }
    if (best === null) return g;
    return { ...g, associatedIncidentId: best.id };
  });
}

// ── Convenience pipeline (4.4) ─────────────────────────────────────────────

/**
 * Run dedup + association in a single call. The consumer MAY call
 * the stages separately if it wants to inspect intermediate state.
 */
export function reconcileGroups(
  groups: ReadonlyArray<TopologyCorrelationGroup>,
  incidents: ReadonlyArray<ConfirmedIncident>,
  reconciledAt: string,
  associationWindowMs?: number,
): ReconciledGroup[] {
  const deduped = dedupGroups({ groups, reconciledAt });
  return associateGroupsWithIncidents({
    groups: deduped,
    incidents,
    associationWindowMs,
  });
}
