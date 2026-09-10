# Fase 4 PR #1 — Deterministic Topology and Time Correlation Rules (Fase 4.1)

## Why

Roadmap Fase 4 (4.1): "Definir reglas deterministas por ancestro compartido, proximidad temporal, cantidad de afectados y proporción sobre población observada. Calibrar mínimos y ventana en fixtures, sin codificarlos como universales."

Following the completion of Fase 3 (cognitive single-incident investigation, contracts, persistence, validator, API, UI card, and Gate 3 acceptance), Fase 4 tackles multi-device root cause correlation across network topology and time:

1. **Shared Ancestor & Proximity Rules**:
   - Rather than treating each affected ONU as an isolated event, identify shared upstream infrastructure (`CTO`, `SPLITTER`, `PON_PORT`, `OLT`).
   - Cluster events within configurable temporal proximity windows (`timeWindowMs`), avoiding hardcoded universal assumptions.

2. **Population-Aware Thresholds**:
   - Evaluate both absolute count of affected devices (`minAffectedCount`) and ratio over total observed population under the ancestor (`minAffectedRatio`).
   - Prevent false positive group alarms (e.g. 2 affected ONUs on a 64-ONU PON port must not trigger a massive PON outage alarm, while 4 out of 4 ONUs on a CTO must trigger a CTO association).

3. **Most Specific Shared Ancestor Resolution**:
   - When a failure is localized to a CTO, bind the correlation to that CTO rather than escalating indiscriminately to the parent splitter or OLT.

4. **Deterministic & Multi-Tenant Safe**:
   - Identical inputs and configuration produce byte-identical reproducible groups.
   - Strict tenant boundary: zero cross-tenant contamination.
   - Non-dogmatic hypothesis support: sharing an ancestor is an association supporting a hypothesis, never an absolute uncalibrated proof.

## What changes

- `@ftth-copilot/shared`:
  - Contract and schemas in `packages/shared/src/contracts.ts`:
    - `ftth.topology-correlation.v1` (`topologyCorrelationConfigSchema`, `topologyCorrelationGroupSchema`, `topologyCorrelationEventSchema`).
- `@ftth-copilot/evidence`:
  - `packages/evidence/src/topology-correlation.ts` (new):
    - `correlateByTopologyAndTime(events, edges, config)`: pure deterministic correlation algorithm.
  - `packages/evidence/tests/fixtures/topology-correlation-fixtures.ts` (new):
    - Standard test topologies (OLT -> PON -> SPLITTER -> CTO -> ONUs) and incident event fixtures.
  - `packages/evidence/tests/topology-correlation.test.ts` (new):
    - TDD test suite validating shared CTO, shared splitter, independent failures, window boundary, ratio thresholds, and multi-tenant isolation.

## Out of scope

- Point-in-time historical topology reconstruction at incident time (Fase 4.2).
- Identity resolution and backfill for connections (Fase 4.3).
- Non-destructive incident deduplication and grouping storage (Fase 4.4).
