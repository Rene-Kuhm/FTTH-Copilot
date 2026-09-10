/**
 * Topology-edge identity (Roadmap Fase 4 — 4.3).
 *
 * Background:
 *
 * `TopologyEdge` keys identity on (parentKind, parentId, childKind,
 * childId) inside one tenant. That is enough while every device in
 * the tenant is reachable through exactly one NMS connection. The
 * minute two connections reach the same `(parentKind, parentId,
 * childKind, childId)` tuple — for example when a backup NMS is
 * added that mirrors the primary, or when a device is moved between
 * connections during a planned migration — the implicit identity
 * collapses and downstream correlation rules over-count shared
 * infrastructure.
 *
 * Roadmap 4.3 says:
 *   "Resolver identidad por conexión y tenant en aristas existentes.
 *    Cualquier migración MUST incluir detección de colisiones y
 *    backfill verificable."
 *
 * This module is the pure helper that the migration / correlation
 * rules call. It does NOT mutate the database; it projects edges
 * into identity buckets and reports the structural problems a
 * migration would otherwise introduce.
 *
 * Design rules:
 *  1. The identity tuple is `(tenantId, connectionId, parentKind,
 *     parentId, childKind, childId)`. `connectionId === null`
 *     represents an inter-connection edge (the device is reached
 *     through every connection of the tenant — rare but legal).
 *  2. Two edges in the same identity tuple are a collision. The
 *     detector emits one collision report per identity tuple with
 *     `beforeIds` (the legacy ids) and `afterIds` (the migration's
 *     intended ids).
 *  3. The backfill planner is pure and verifiable: every plan is
 *     accompanied by a `BackfillVerification` block that pins the
 *     identity tuples the migration preserved. A reviewer can run
 *     the migration on a snapshot, replay the planner on the result,
 *     and confirm `identityStable === true`.
 */

import type { TopologyEdge, TopologyNodeKind } from '@ftth-copilot/shared';

// ── Identity projection (4.3) ──────────────────────────────────────────────

/**
 * Augmented edge view that carries the `connectionId` the device is
 * reached through. `connectionId === null` means the edge is shared
 * across every connection in the tenant (e.g. a regional OLT
 * reachable from both the primary and the backup NMS).
 */
export interface EdgeIdentity {
  tenantId: string;
  connectionId: string | null;
  parentKind: TopologyNodeKind;
  parentId: string;
  childKind: TopologyNodeKind;
  childId: string;
}

/**
 * Compose the canonical identity tuple for a single edge. The tuple
 * is stable: same inputs → same string, in any runtime.
 */
export function composeEdgeIdentityKey(e: EdgeIdentity): string {
  // ASCII-only join; no PII, no PII-adjacent characters. Safe to log.
  return [
    e.tenantId,
    e.connectionId ?? '*',
    e.parentKind,
    e.parentId,
    e.childKind,
    e.childId,
  ].join('|');
}

/** Project a `TopologyEdge` into an `EdgeIdentity` (connectionId from caller). */
export function projectEdgeIdentity(
  edge: TopologyEdge,
  connectionId: string | null,
): EdgeIdentity {
  return {
    tenantId: edge.tenantId,
    connectionId,
    parentKind: edge.parentKind,
    parentId: edge.parentId,
    childKind: edge.childKind,
    childId: edge.childId,
  };
}

// ── Collision detector (4.3) ───────────────────────────────────────────────

export type CollisionKind =
  /** Two legacy edges share an identity tuple → the migration would duplicate. */
  | 'duplicate-identity'
  /** Two identity tuples in the BEFORE set collapse to one in the AFTER set. */
  | 'cross-connection-collapse';

export interface CollisionReport {
  kind: CollisionKind;
  identity: EdgeIdentity;
  /** Legacy edge ids that hold this identity BEFORE the migration. */
  beforeIds: string[];
  /** Intended edge ids in the AFTER set. Empty if the migration intends to drop. */
  afterIds: string[];
  /** Stable hash of the identity tuple — safe to use as a deduplication key. */
  identityHash: string;
}

export interface CollisionDetectionArgs {
  before: ReadonlyArray<TopologyEdge & { connectionId: string | null }>;
  after: ReadonlyArray<TopologyEdge & { connectionId: string | null }>;
}

export interface CollisionDetectionResult {
  /** Reports, sorted by identity hash so output is deterministic. */
  reports: CollisionReport[];
  /** True when no collisions are present; the migration is safe to run. */
  clean: boolean;
}

function bucketByIdentity(
  edges: ReadonlyArray<TopologyEdge & { connectionId: string | null }>,
): Map<string, { identity: EdgeIdentity; ids: string[] }> {
  const out = new Map<string, { identity: EdgeIdentity; ids: string[] }>();
  for (const e of edges) {
    const identity = projectEdgeIdentity(e, e.connectionId);
    const key = composeEdgeIdentityKey(identity);
    let bucket = out.get(key);
    if (bucket === undefined) {
      bucket = { identity, ids: [] };
      out.set(key, bucket);
    }
    bucket.ids.push(e.id);
  }
  return out;
}

/**
 * Detect collisions between two edge snapshots.
 *
 * A collision exists when either:
 *   1. A single identity tuple has more than one edge in the BEFORE
 *      set — a duplicate the legacy schema hid by collapsing ids.
 *   2. The BEFORE set contains more distinct identity tuples than
 *      the AFTER set for the same (tenant, parent, child) — the
 *      migration has collapsed cross-connection diversity.
 *
 * The detector is pure; same inputs → same `reports` array (sorted).
 */
export function detectEdgeCollisions(
  args: CollisionDetectionArgs,
): CollisionDetectionResult {
  const beforeBuckets = bucketByIdentity(args.before);
  const afterBuckets = bucketByIdentity(args.after);

  const reports: CollisionReport[] = [];

  for (const [hash, beforeBucket] of beforeBuckets) {
    if (beforeBucket.ids.length > 1) {
      const afterBucket = afterBuckets.get(hash);
      reports.push({
        kind: 'duplicate-identity',
        identity: beforeBucket.identity,
        beforeIds: [...beforeBucket.ids].sort(),
        afterIds: afterBucket ? [...afterBucket.ids].sort() : [],
        identityHash: hash,
      });
    }
  }

  // Cross-connection collapse: a (tenant, parent, child) tuple that
  // was reached through multiple connections in BEFORE has fewer in
  // AFTER.
  const beforeByTuple = new Map<string, Set<string>>();
  for (const e of args.before) {
    const key = [e.tenantId, e.parentKind, e.parentId, e.childKind, e.childId].join('|');
    let s = beforeByTuple.get(key);
    if (s === undefined) {
      s = new Set<string>();
      beforeByTuple.set(key, s);
    }
    s.add(e.connectionId ?? '*');
  }
  const afterByTuple = new Map<string, Set<string>>();
  for (const e of args.after) {
    const key = [e.tenantId, e.parentKind, e.parentId, e.childKind, e.childId].join('|');
    let s = afterByTuple.get(key);
    if (s === undefined) {
      s = new Set<string>();
      afterByTuple.set(key, s);
    }
    s.add(e.connectionId ?? '*');
  }
  for (const [tuple, beforeConns] of beforeByTuple) {
    const afterConns = afterByTuple.get(tuple) ?? new Set<string>();
    if (beforeConns.size > afterConns.size && afterConns.size > 0) {
      // Pick any identity tuple to carry the report; the reviewer
      // reads `beforeIds` to disambiguate.
      const sample = args.before.find((e) => {
        const k = [e.tenantId, e.parentKind, e.parentId, e.childKind, e.childId].join('|');
        return k === tuple && (e.connectionId !== null);
      });
      if (sample !== undefined) {
        const identity = projectEdgeIdentity(sample, sample.connectionId);
        const hash = composeEdgeIdentityKey(identity);
        const afterIds = args.after
          .filter((e) => {
            const k = [e.tenantId, e.parentKind, e.parentId, e.childKind, e.childId].join('|');
            return k === tuple;
          })
          .map((e) => e.id)
          .sort();
        reports.push({
          kind: 'cross-connection-collapse',
          identity,
          beforeIds: args.before
            .filter((e) => {
              const k = [e.tenantId, e.parentKind, e.parentId, e.childKind, e.childId].join('|');
              return k === tuple;
            })
            .map((e) => e.id)
            .sort(),
          afterIds,
          identityHash: hash,
        });
      }
    }
  }

  reports.sort((a, b) => (a.identityHash < b.identityHash ? -1 : a.identityHash > b.identityHash ? 1 : 0));

  return { reports, clean: reports.length === 0 };
}

// ── Backfill planner (4.3, "backfill verificable") ─────────────────────────

export type BackfillOp =
  | { op: 'split'; sourceId: string; targets: Array<{ connectionId: string | null; newId: string }> }
  | { op: 'rename'; sourceId: string; newId: string }
  | { op: 'preserve'; sourceId: string };

export interface BackfillPlan {
  ops: BackfillOp[];
  /** Verification sample: identities the migration is expected to preserve. */
  verification: {
    /** Distinct identity tuples in the BEFORE set that survive the plan. */
    preservedIdentityHashes: string[];
    /** `true` iff every preserved identity appears in the AFTER snapshot. */
    identityStable: boolean;
  };
}

/**
 * Pure planner: given the collision reports and the BEFORE/AFTER
 * snapshots, produce a deterministic list of operations and a
 * verification block. The verification block is what makes the
 * backfill *verifiable*: a reviewer can run the migration, replay
 * the planner, and confirm `identityStable === true`.
 *
 * The planner is conservative: if a collision has no clear
 * resolution (e.g. two legacy edges would have to merge but the
 * reviewer's policy forbids it), it emits a `preserve` op so the
 * reviewer can investigate manually instead of silently losing data.
 */
export function planBackfill(
  reports: ReadonlyArray<CollisionReport>,
  args: CollisionDetectionArgs,
): BackfillPlan {
  const reportByHash = new Map<string, CollisionReport>();
  for (const r of reports) reportByHash.set(r.identityHash, r);

  const ops: BackfillOp[] = [];
  const preservedHashes = new Set<string>();

  for (const [hash, bucket] of bucketByIdentity(args.before)) {
    const report = reportByHash.get(hash);
    if (report === undefined) {
      // No collision — preserve every edge in this bucket.
      for (const id of bucket.ids) {
        ops.push({ op: 'preserve', sourceId: id });
      }
      preservedHashes.add(hash);
      continue;
    }
    if (report.kind === 'duplicate-identity') {
      // Conservative split: every legacy edge gets its own new id.
      for (const sourceId of bucket.ids) {
        ops.push({
          op: 'split',
          sourceId,
          targets: [
            { connectionId: bucket.identity.connectionId, newId: sourceId + '__split' },
          ],
        });
      }
      continue;
    }
    // cross-connection-collapse — preserve and flag for review.
    for (const id of bucket.ids) {
      ops.push({ op: 'preserve', sourceId: id });
    }
  }

  // Verification: every preserved identity tuple must appear in the
  // AFTER set under at least one of its legacy ids.
  const afterIds = new Set<string>(args.after.map((e) => e.id));
  let identityStable = true;
  for (const hash of preservedHashes) {
    const bucket = bucketByIdentity(args.before).get(hash)!;
    const allPresent = bucket.ids.every((id) => afterIds.has(id));
    if (!allPresent) identityStable = false;
  }

  return {
    ops,
    verification: {
      preservedIdentityHashes: [...preservedHashes].sort(),
      identityStable,
    },
  };
}

/**
 * Convenience: run the full pipeline (detect + plan) and return the
 * composite report. The migration author MUST inspect this output
 * before applying the migration.
 */
export function planMigration(
  args: CollisionDetectionArgs,
): { detection: CollisionDetectionResult; plan: BackfillPlan } {
  const detection = detectEdgeCollisions(args);
  const plan = planBackfill(detection.reports, args);
  return { detection, plan };
}
