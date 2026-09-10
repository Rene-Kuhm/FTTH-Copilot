# Fase 4 PR #3 — Topology-edge identity + collision detection + backfill planning (spec delta)

## Why

Roadmap Fase 4 (4.3): "Resolver identidad por conexión y tenant en
aristas existentes. Cualquier migración MUST incluir detección de
colisiones y backfill verificable."

`TopologyEdge` keys identity on `(parentKind, parentId, childKind,
childId)` inside one tenant. That breaks when two connections reach
the same tuple (a backup NMS, a planned migration). The Fase 4.2
temporal lookup already returned edges valid at incident time, but
the identity projection itself wasn't there: a migration that
*adds* a `connectionId` column could silently collapse distinct
devices or duplicate one device into two rows.

This PR ships the pure helpers the migration needs; the migration
itself (Prisma schema + backfill) is a separate, additive PR
behind a flag (roadmap MUST-10).

## What changes

- `packages/evidence/src/edge-identity.ts` (new):
  - `composeEdgeIdentityKey(identity)` → stable hash.
  - `projectEdgeIdentity(edge, connectionId)` → identity tuple.
  - `detectEdgeCollisions({before, after})` → reports two kinds:
    - `duplicate-identity`: two legacy edges share an identity tuple.
    - `cross-connection-collapse`: more connections BEFORE than AFTER.
  - `planBackfill(reports, snapshots)` → conservative plan: `preserve`
    for clean buckets, `split` for duplicates, `preserve` for
    collapses (manual review).
  - `planMigration(snapshots)` → composite helper.
- `packages/evidence/src/index.ts`: re-exports.
- `packages/evidence/tests/edge-identity.test.ts` (new): 17 tests
  covering stability, connection discrimination, duplicate detection,
  collapse detection, preserve/split policies, identity stability.

## Identity tuple

`(tenantId, connectionId, parentKind, parentId, childKind, childId)`.

`connectionId === null` represents an inter-connection edge (the
device is reachable from every connection in the tenant). The hash
uses `*` for null so the result is always a non-empty string and
sortable.

## Scenarios (Given/When/Then)

### Scenario: legacy duplicate identity is flagged

Given two legacy edges with the same `(tenantId, connectionId,
parentKind, parentId, childKind, childId)` tuple
When `detectEdgeCollisions` runs
Then the result is `clean: false`
And the report is `duplicate-identity` with both legacy ids in
`beforeIds`

### Scenario: cross-connection collapse is flagged

Given the BEFORE set has the same `(parentKind, parentId, childKind,
childId)` reached through two connections
And the AFTER set has only one of them
When `detectEdgeCollisions` runs
Then the report is `cross-connection-collapse`

### Scenario: identity-stable verification

Given a BEFORE/AFTER pair with no dropped identities
When `planMigration` runs
Then `plan.verification.identityStable === true`
And the reviewer can replay the planner after the migration to
confirm the property

### Scenario: dropped identity is flagged

Given a BEFORE edge that has no AFTER counterpart
When `planMigration` runs
Then `plan.verification.identityStable === false`

## Rules (RFC 2119)

- The identity tuple MUST distinguish by `(tenantId, connectionId,
  parentKind, parentId, childKind, childId)`. Two edges in the same
  tuple are a collision by definition.
- The detector MUST be pure. Same snapshots → same reports array,
  sorted by identity hash for determinism.
- The planner MUST be conservative: collisions without a clear
  resolution emit `preserve` so the reviewer investigates manually
  instead of silently losing data.
- `identityStable` MUST be `true` iff every preserved identity tuple
  appears in the AFTER set under at least one of its legacy ids.

## Out of scope

- The migration itself (Prisma schema + backfill application +
  flag). This PR ships the helpers; the migration runs behind a
  feature flag in a separate PR.
- Correlation rule updates (Fase 4.1/#130 and 4.2/#131 already
  shipped); this PR does not touch `topology-correlation.ts`.
