# Fase 4 PR #5 — Investigation enrichment (4.5 spec delta)

## Why

Roadmap Fase 4 (4.5): "Enriquecer investigación con infraestructura
compartida, afectados observados y equipos sanos conocidos. No
inferir splitters o tramos físicos que no estén registrados."

Without a typed enrichment envelope, the investigation card has no
canonical place to surface:
  - which ancestor chain the operator should look at first
    (sharedInfrastructure),
  - which devices the topology + history agree were affected
    (affectedObserved),
  - which devices the operator marked healthy AND the topology
    supports (knownHealthy).

Auto-inferring "this device is healthy because it's not in the
affected list" is forbidden by 4.5. The module enforces it by
intersecting the declared-healthy list with topology-reachable
nodes only, and by leaving `flaggedSplitters` as a frozen empty
list — splitters are NEVER inferred.

## What changes

- `packages/evidence/src/investigation-enrichment.ts` (new):
  pure `enrichInvestigation({...})` returning `EnrichedInvestigation`.
- `packages/evidence/src/index.ts`: re-exports.
- `packages/evidence/tests/investigation-enrichment.test.ts` (new):
  8 tests covering BFS ancestors, topology-supported affected list,
  tenant isolation, declared-healthy intersection, splitter
  emptiness, purity, and the asOf timestamp.

## Scenarios (Given/When/Then)

### Scenario: shared infrastructure is reachable from the ancestor at asOf

Given a CTO-1 with edges CTO-1 → ONU-*, CTO-1 → PON-1, PON-1 → OLT-1
When `enrichInvestigation` runs at incident time
Then `sharedInfrastructure` lists PON-1 and OLT-1 with `source:
'topology'`

### Scenario: a history device not reachable from the ancestor is NOT affected

Given a confirmed incident on ONU-99 that has no edge path to CTO-1
When `enrichInvestigation` runs
Then `affectedObserved` does NOT include `ONU-99`

### Scenario: a t_B incident never surfaces in a t_A enrichment

Given history filtered to `t_B` and an enrichment for `t_A`
When `enrichInvestigation` runs
Then `affectedObserved` is empty (tenant-scoped)

### Scenario: declared-healthy outside the topology is dropped

Given a declared `ONU-99` that has no edge into the topology
When `enrichInvestigation` runs
Then `knownHealthy` does NOT include `ONU-99`

### Scenario: splitters are NEVER inferred

Given any inputs
When `enrichInvestigation` runs
Then `flaggedSplitters === []`

## Rules (RFC 2119)

- `affectedObserved` MUST be the intersection of `history` (tenant
  + deviceKind ∈ {OLT, ONU}) and topology-reachable nodes. No
  device may be marked affected based on history alone.
- `knownHealthy` MUST be the intersection of `declaredHealthy` and
  topology-reachable nodes. Absence from the affected list is NOT
  evidence of health.
- `flaggedSplitters` MUST always be an empty list. Splitter
  knowledge is the operator's responsibility and has its own
  explicit input slot in a separate change.
- The enrichment MUST be pure (same inputs → same output) and
  MUST respect the synthetic clock passed in `asOfMs`.

## Out of scope

- Splitter registration (the input that would populate
  `flaggedSplitters` lives in a separate change; today the slot
  exists but is empty by design).
- Persistence of the enrichment.
- UI surfaces (lives in a separate Fase 3 follow-up).
