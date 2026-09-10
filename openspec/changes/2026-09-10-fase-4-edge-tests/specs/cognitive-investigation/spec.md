# Fase 4 PR #6 — Edge-case test suite for Fase 4 (4.6 spec delta)

## Why

Roadmap Fase 4 (4.6) requires the corrector to handle six edge
cases. Without a dedicated suite the corrector's behaviour on
those cases is undocumented and regressions slip in silently.

This PR ships the test suite. No production source changes.

## What changes

- `packages/evidence/tests/topology-correlation-edges.test.ts`
  (new): 12 tests covering
  - caída individual (single ONU below threshold → no group)
  - grupo compartido (multiple ONUs under same CTO → one group)
  - fallos simultáneos independientes (different CTOs → separate
    groups, no false-positive merge)
  - ciclos / topología incompleta (BFS safety + unreachable ONU
    yields no group)
  - cambios de aristas (validTo semantics, migration collision
    detection)
  - eventos tardíos (outside-window event excluded; next-window
    event forms its own group)
  - integration: enrichment over grouped events, reconciler dedup
    across passes, tenant isolation, planMigration reuse

## Scenarios (Given/When/Then)

### Scenario: caída individual

Given a single ONU event in the topology
When `correlateByTopologyAndTime` runs
Then no group forms (below the count + ratio thresholds)

### Scenario: grupo compartido

Given 3 ONU events under CTO-1 in the time window
When `correlateByTopologyAndTime` runs
Then one group appears with `ancestorKind: 'CTO'`, `ancestorId: 'CTO-1'`,
and `affectedDeviceIds: ['ONU-1', 'ONU-2', 'ONU-3']`

### Scenario: ciclos

Given an accidental `ONU-1 → CTO-1` edge added on top of the standard topology
When `bfsAncestors` runs from `ONU-1`
Then the BFS terminates and surfaces `OLT-1` (cycle guard keyed on node)

### Scenario: cambios de aristas

Given an edge whose `validTo` is in the past
When `isEdgeValidAt(e, futureTimestamp)` runs
Then the result is `false`
And the BFS walk past that edge stops at the timestamp

### Scenario: eventos tardíos

Given 3 ONU events at T0 and another 3 at T0+10min
When `correlateByTopologyAndTime` runs with `timeWindowMs = 5min`
Then two separate CTO-1 groups form (one per window)

### Scenario: tenant isolation

Given a t_B event with t_A topology edges
When `correlateByTopologyAndTime` runs
Then no group forms (the corrector filters by tenant)

## Rules (RFC 2119)

- The suite MUST be additive (no production changes).
- Every test MUST name the roadmap scenario it pins, so a future
  reader can map a test failure back to the spec line.

## Out of scope

- Production changes (this is a test-only PR).
- New helpers (the suite uses the existing
  `correlateByTopologyAndTime`, `bfsAncestors`, `isEdgeValidAt`,
  `enrichInvestigation`, `reconcileGroups`, `detectEdgeCollisions`,
  `planMigration`).
