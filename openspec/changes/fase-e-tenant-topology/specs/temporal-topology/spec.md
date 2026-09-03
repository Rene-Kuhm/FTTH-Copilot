# Temporal Topology Specification

## Purpose

Single-edge `TopologyEdge` table traversing the FTTH hierarchy (`OLT → PON_PORT → SPLITTER → CTO → ONU`) with temporal validity. Two read-only tools: `get_topology_path` (ascending to OLT) and `get_downstream_clients` (descending BFS to ONUs). Soft-expiry via `validTo`. Empty graph → `incomplete` verdict.

## Requirements

### Requirement: `TopologyEdge` envelope (`ftth.topology-edge.v1`)

`packages/shared` MUST export `TOPOLOGY_EDGE_SCHEMA` and `topologyEdgeSchema`. `packages/db` MUST define `TopologyEdge { id, tenantId, parentKind, parentId, childKind, childId, validFrom, validTo?, source, createdAt }` mapped to `topology_edges`, with indexes on `(tenantId, parentKind, parentId)` and `(tenantId, childKind, childId)`. Fields: `schema` literal `'ftth.topology-edge.v1'`; id strings non-empty; `parentKind`/`childKind` enum `OLT|PON_PORT|SPLITTER|CTO|ONU`; `validFrom`/`createdAt` ISO datetime; `validTo?` MUST be `> validFrom` when set.

#### Scenario: Schema, validity, kind guards

- GIVEN `schema: '…v2'`, OR `validFrom === validTo`, OR self-loop, OR `parentKind: 'SWITCH'`
- WHEN `safeParse` runs per case
- THEN each `.success === false`

#### Scenario: All five kinds accepted

- GIVEN payloads with each of `OLT`, `PON_PORT`, `SPLITTER`, `CTO`, `ONU`
- WHEN `safeParse` runs per case
- THEN each `.success === true`

### Requirement: Pure BFS helpers

`packages/evidence/src/topology.ts` MUST export:

- `bfsDownstream(edges, rootKind, rootId): string[]` — reachable ONU `childId`s. Excludes `validTo != null`.
- `bfsAncestors(edges, leafKind, leafId): Array<{kind, id}>` — chain up to root OLT (no leaf).
- `topologyPath(edges, leafKind, leafId): Array<{kind, id}>` — `bfsAncestors` reversed.

Each MUST use a `Set<string>` visited guard and filter `edges.filter((e) => e.validTo === null)`.

#### Scenario: Expired, path, cycle

- GIVEN `[A→B valid, A→C expired]` rooted at `A`
- WHEN `bfsDownstream(edges, 'OLT', 'A')` runs
- THEN descendants of `B` returned; `C` is not

- GIVEN `OLT1 → PON1 → SPL1 → CTO1 → ONU1`
- WHEN `topologyPath(edges, 'ONU', 'ONU1')` runs
- THEN returns `[{ONU1}, {CTO1}, {SPL1}, {PON1}, {OLT1}]`

- GIVEN `A→B, B→A`
- WHEN `bfsAncestors(edges, 'CTO', 'B')` runs
- THEN returns `[{OLT, A}]` (no loop)

### Requirement: `get_topology_path` tool

`packages/agent-core/src/tools/index.ts` MUST add `get_topology_path { deviceKind, deviceId }`. Loads all active edges where `{deviceKind, deviceId}` matches either side, then calls `topologyPath(...)`. Result wrapped in `evidence.provenance.v1`.

#### Scenario: Unknown device returns null

- GIVEN `deviceId` absent from any edge
- WHEN the tool runs
- THEN `data === null`; classifier emits `code: 'incomplete', reason: 'no-envelope'`

### Requirement: `get_downstream_clients` tool

Must add `get_downstream_clients { deviceKind, deviceId }`. Loads all active edges and runs `bfsDownstream(...)`. Returned `data` MUST be `{ root: {kind, id}, onuIds: string[], edgesTraversed: number }`. Wrapped in `evidence.provenance.v1`.

#### Scenario: BFS and empty subtree

- GIVEN a CTO with 3 ONUs (one expired subtree)
- WHEN the tool runs
- THEN `onuIds.length === 3`, `edgesTraversed` equals non-expired edges walked

- GIVEN a leaf OLT with no downstream edges
- WHEN the tool runs
- THEN `onuIds === []`, `edgesTraversed === 0`

### Requirement: Empty graph = `incomplete` verdict

Both tools MUST emit `incomplete` verdicts when no edges match.

#### Scenario: Classifier emits `incomplete`

- GIVEN `get_topology_path` returns `data: null`
- WHEN `classifyEnvelope` runs
- THEN verdict `code === 'incomplete'` AND `reason === 'no-envelope'`

### Requirement: Expired-edge filter

`validTo != null` rows MUST be excluded from BFS. Prisma queries MUST use `where: { validTo: null }` for active-edge reads.

#### Scenario: Prisma filters expired

- GIVEN mixed edges
- WHEN the tool queries
- THEN `where` contains `validTo: null`

### Requirement: `PROVENANCE_TOOL_META` entries

`packages/agent-core/src/tools/provenance.ts` MUST register both tools with `{ completeness: 'partial', confidence: 0.9 }`. Topology can be stale; never mark `complete`.

#### Scenario: Both tools registered

- GIVEN `PROVENANCE_TOOL_META['get_topology_path']` and `…['get_downstream_clients']`
- WHEN read
- THEN each has `completeness === 'partial'` AND `confidence === 0.9`

### Requirement: Tenant isolation on topology routes

`GET /api/topology/path` and `GET /api/topology/downstream` MUST scope every query by `user.tenantId`. Cross-tenant device IDs MUST return 404 (not 403, to avoid disclosing existence). Both routes MUST require `view_network` permission.

#### Scenario: Cross-tenant 404, missing permission 403

- GIVEN `user.tenantId: 't1'` AND `deviceId` belongs to `'t2'`
- WHEN either route runs
- THEN responds 404

- GIVEN a user without `view_network`
- WHEN either route runs
- THEN responds 403