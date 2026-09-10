# Fase 4 PR #2 — Temporal Topology Querying at Incident Time (Fase 4.2)

## Why

Roadmap Fase 4 (4.2): "Consultar topología válida a la hora del incidente; no aplicar ciegamente la topología actual a hechos históricos."

In telecommunications networks, FTTH infrastructure changes over time:
- An ONU is relocated from `CTO-1` to `CTO-2`.
- A feeder cable is re-patched to a different splitter port.
- New branches or splitters are introduced.

Prior to this phase, topology BFS traversal (`bfsAncestors`, `bfsDownstream`, `topologyPath`) only checked whether `validTo === null`, assuming the currently active topology represents the entirety of network history. If an operator or automated investigation evaluates an incident from 3 days ago, applying current topology yields misleading or false correlations (e.g. diagnosing a failure on `CTO-2` when the ONU was actually on `CTO-1` at the moment of the drop).

## What changes

1. **Point-in-Time Edge Validity (`isEdgeValidAt`)**:
   - Introduce pure deterministic helper `isEdgeValidAt(edge: TopologyEdge, asOf?: string | Date | number | null): boolean`:
     - If `asOf` is provided: valid if `validFrom <= asOf` AND (`validTo === null` OR `validTo > asOf`).
     - If `asOf` is omitted: backward-compatible active check (`validTo === null || validTo === undefined`).
2. **Temporal BFS Traversals in `@ftth-copilot/evidence`**:
   - Update `bfsDownstream(edges, rootKind, rootId, asOf?)`.
   - Update `bfsAncestors(edges, leafKind, leafId, asOf?)`.
   - Update `topologyPath(edges, leafKind, leafId, asOf?)`.
3. **Temporal Historical Correlation in `correlateByTopologyAndTime`**:
   - Evaluate cluster ancestors against the topology as it existed at the time of the events (`clusterStartTime` or `asOf`), guaranteeing historical incident analysis does not leak future edge changes.
4. **API Endpoints (`/api/topology/path` and `/api/topology/downstream`)**:
   - Accept optional `asOf` ISO-8601 query parameter, querying Prisma with point-in-time bounds: `validFrom <= asOf` AND `(validTo IS NULL OR validTo > asOf)`.
5. **Comprehensive Tests**:
   - Pure-TS BFS unit tests for edge migrations, replacements, expired subtrees, future edges, and historical point-in-time reconstruction.
   - Correlation engine tests verifying that past incidents correlate to the historical CTO, not the future migrated CTO.

## Out of scope

- Identity resolution and backfill for connections (Fase 4.3).
- Persistent group deduplication storage (Fase 4.4).
- Shared infrastructure enrichment in investigation card (Fase 4.5).
