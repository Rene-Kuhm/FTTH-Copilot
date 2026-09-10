/**
 * Investigation enrichment (Roadmap Fase 4 — 4.5).
 *
 * Background:
 *
 * Roadmap 4.5: "Enriquecer investigación con infraestructura
 * compartida, afectados observados y equipos sanos conocidos. No
 * inferir splitters o tramos físicos que no estén registrados."
 *
 * This module is the pure projection of three sources onto one
 * enrichment envelope:
 *   - topology (TopologyEdge rows valid at the incident window),
 *   - confirmed-incident history (ConfirmedIncident rows the
 *     investigator has access to),
 *   - declared healthy devices (provided by the operator; we do
 *     NOT auto-infer "this device must be healthy because it's not
 *     on the affected list").
 *
 * Splitters and physical spans are NOT inferred. The `flaggedSplitters`
 * field is intentionally a frozen empty list — the only legitimate
 * source for splitter knowledge is a registered edge or operator
 * input. Roadmap 4.5 says "no inferir splitters o tramos físicos que
 * no estén registrados"; this module enforces that rule at the API
 * level.
 */

import type {
  ConfirmedIncident,
  TopologyEdge,
  TopologyNodeKind,
} from '@ftth-copilot/shared';
import { bfsAncestors } from './topology';

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface EnrichInvestigationArgs {
  /** Group that the enrichment decorates (from the Fase 4.4 reconciler). */
  readonly ancestorKind: TopologyNodeKind;
  readonly ancestorId: string;
  /** Tenant scope. */
  readonly tenantId: string;
  /** Edges valid at the incident window (Fase 4.2 / #131). */
  readonly edges: ReadonlyArray<TopologyEdge>;
  /** Confirmed-incident history (already tenant-scoped). */
  readonly history: ReadonlyArray<ConfirmedIncident>;
  /**
   * Devices the operator (or the source system) has explicitly
   * marked healthy. Auto-inference is forbidden.
   */
  readonly declaredHealthy: ReadonlyArray<{ kind: TopologyNodeKind; id: string }>;
  /** Optional synthetic clock for the "as of" timestamp. */
  readonly asOfMs?: number;
}

export interface SharedInfrastructureRef {
  kind: TopologyNodeKind;
  id: string;
  /** The source that surfaced the node. */
  source: 'topology' | 'incident_history';
  /** Free-text reason; never a confidence number. */
  reason: string;
}

export interface EnrichedInvestigation {
  /** Always the inputs verbatim, plus the enrichments. */
  readonly ancestorKind: TopologyNodeKind;
  readonly ancestorId: string;
  readonly tenantId: string;
  /** Devices the topology + history agree were affected. */
  readonly affectedObserved: ReadonlyArray<string>;
  /** Devices the operator marked healthy AND the topology supports. */
  readonly knownHealthy: ReadonlyArray<string>;
  /** Shared infrastructure surfaced by the topology (BFS ancestors). */
  readonly sharedInfrastructure: ReadonlyArray<SharedInfrastructureRef>;
  /**
   * Splitters flagged by the operator. Roadmap 4.5 forbids inference;
   * the field exists so an explicit operator input has a place to
   * land, but the default is always an empty list.
   */
  readonly flaggedSplitters: ReadonlyArray<{ kind: TopologyNodeKind; id: string }>;
  readonly asOf: string;
}

// ── Pipeline ────────────────────────────────────────────────────────────────

export function enrichInvestigation(args: EnrichInvestigationArgs): EnrichedInvestigation {
  const asOfMs = args.asOfMs ?? Date.now();
  const asOf = new Date(asOfMs).toISOString();

  // 1. Shared infrastructure from the topology (ancestors via BFS).
  const ancestors = bfsAncestors(
    args.edges,
    args.ancestorKind,
    args.ancestorId,
    asOfMs,
  );
  const sharedInfrastructure: SharedInfrastructureRef[] = ancestors.map((hop) => ({
    kind: hop.kind,
    id: hop.id,
    source: 'topology' as const,
    reason: `reachable from ${args.ancestorKind}:${args.ancestorId} at ${asOf}`,
  }));

  // 2. Affected observed: confirmed incidents on the same tenant
  // whose device is reachable from the ancestor at incident time.
  // This is the topology-supported subset — not an over-claim.
  const affectedObserved: string[] = [];
  for (const inc of args.history) {
    if (inc.tenantId !== args.tenantId) continue;
    if (inc.deviceKind !== 'OLT' && inc.deviceKind !== 'ONU') continue;
    // Confirm the incident's device is under the ancestor at asOf.
    const path = bfsAncestors(args.edges, inc.deviceKind, inc.deviceId, asOfMs);
    const underAncestor = path.some(
      (hop) => hop.kind === args.ancestorKind && hop.id === args.ancestorId,
    );
    if (underAncestor) affectedObserved.push(inc.deviceId);
  }

  // 3. Known healthy: intersection of operator-declared healthy
  // devices with topology-reachable nodes. We do NOT add devices
  // that are merely absent from the affected list.
  const knownHealthy: string[] = [];
  for (const declared of args.declaredHealthy) {
    const path = bfsAncestors(args.edges, declared.kind, declared.id, asOfMs);
    const underAncestor = path.some(
      (hop) => hop.kind === args.ancestorKind && hop.id === args.ancestorId,
    );
    if (underAncestor) knownHealthy.push(`${declared.kind}:${declared.id}`);
  }

  // 4. Splitters: never inferred. Empty list.
  const flaggedSplitters: ReadonlyArray<{ kind: TopologyNodeKind; id: string }> = [];

  return {
    ancestorKind: args.ancestorKind,
    ancestorId: args.ancestorId,
    tenantId: args.tenantId,
    affectedObserved: Array.from(new Set(affectedObserved)).sort(),
    knownHealthy: Array.from(new Set(knownHealthy)).sort(),
    sharedInfrastructure,
    flaggedSplitters,
    asOf,
  };
}
