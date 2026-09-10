# Fase 4 PR #4 — Topology-correlation group reconciler (spec delta)

## Why

Roadmap Fase 4 (4.4): "Generar grupos reproducibles con
deduplicación y asociación a incidentes originales. No borrar ni
fusionar destructivamente evidencia previa."

`correlateByTopologyAndTime` (PR #130) emits raw groups per pass.
A nightly re-run emits overlapping groups; without a reconciler
the UI sees the same outage twice and a confirmed incident is
never linked to its topology evidence.

## What changes

- `packages/evidence/src/groups-reconciler.ts` (new): pure helpers
  - `composeGroupIdentityKey` / `groupIdentityHash` → canonical key.
  - `dedupGroups({groups, reconciledAt})` → first occurrence wins;
    duplicates carry `duplicateOf`; the canonical carries
    `mergedGroupIds`. Nothing is destroyed.
  - `associateGroupsWithIncidents({groups, incidents, windowMs?})`
    → links the nearest incident within `associationWindowMs`
    (default 15 min) by tenant.
  - `reconcileGroups(groups, incidents, reconciledAt, …)` → composite.
  - `ReconciledGroup` is additive: `group` (verbatim) +
    `identityHash` + `canonicalGroupId` + `mergedGroupIds` +
    `duplicateOf` + `associatedIncidentId` + `reconciledAt`.
- `packages/evidence/src/index.ts`: re-exports.
- `packages/evidence/tests/groups-reconciler.test.ts` (new): 14
  tests covering hash stability, dedup, association, multi-tenant
  isolation, idempotence, purity.

## Scenarios (Given/When/Then)

### Scenario: two groups with the same identity collapse, the second is `duplicateOf` the first

Given two groups with the same `(tenantId, ancestorKind,
ancestorId, windowStart, windowEnd)`
When `dedupGroups` runs
Then the first is `canonicalGroupId: 'g_1'`, `duplicateOf: null`,
`mergedGroupIds: ['g_2']`
And the second is `duplicateOf: 'g_1'`

### Scenario: tenant isolation — `t_A` group never sees a `t_B` incident

Given a group with `tenantId: 't_A'` and an incident with
`tenantId: 't_B'`
When `associateGroupsWithIncidents` runs
Then `associatedIncidentId === null`

### Scenario: nearest incident within the window wins

Given two incidents within the association window
When `associateGroupsWithIncidents` runs
Then the closer one wins by absolute gap

### Scenario: nothing is destroyed

Given the input has N groups
When `dedupGroups` runs
Then the output has N rows; every input survives as either the
canonical or a `duplicateOf` entry. No deletion.

## Rules (RFC 2119)

- The reconciler MUST NOT mutate input groups or incidents. The
  output is a new array of `ReconciledGroup` wrappers.
- A duplicate MUST carry `duplicateOf` pointing at the canonical's
  `groupId`, not its `id` (the group has no `id` — it has a
  `groupId`).
- The canonical MUST carry `mergedGroupIds: string[]` listing every
  duplicate `groupId` that survived the dedup.
- Association MUST be tenant-scoped. A group MUST NEVER see
  incidents from another tenant.
- The reconciler is OFF by default (roadmap MUST-10); the consumer
  passes groups explicitly.

## Out of scope

- Persistence on a new `TopologyCorrelationGroup` table.
- Nightly scheduling (already in place for the upstream corrector).
- Updates to `topology-correlation.ts` itself.
