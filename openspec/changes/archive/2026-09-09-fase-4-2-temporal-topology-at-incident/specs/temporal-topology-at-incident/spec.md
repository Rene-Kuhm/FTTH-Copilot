# Spec Delta: Point-in-Time Temporal Topology Querying (Fase 4.2)

## Scenarios (Given/When/Then)

### Scenario: Querying topology asOf a historical incident reflects the connection at that time

Given an ONU `ONU-100` connected to `CTO-1` from `2026-08-01T00:00:00.000Z` to `2026-09-05T00:00:00.000Z`
  and migrated to `CTO-2` starting `2026-09-05T00:00:00.000Z` with `validTo: null`
When `bfsAncestors` or `topologyPath` is queried with `asOf: '2026-09-01T12:00:00.000Z'`
Then the returned ancestor chain contains `CTO-1` and not `CTO-2`.

### Scenario: Querying topology currently or without asOf reflects current connection

Given the same ONU `ONU-100` migrated from `CTO-1` to `CTO-2` on `2026-09-05T00:00:00.000Z`
When `bfsAncestors` or `topologyPath` is queried with no `asOf` (or `asOf` after the migration)
Then the returned ancestor chain contains `CTO-2` and not `CTO-1`.

### Scenario: Future edges are not visible in historical queries

Given a new splitter edge created with `validFrom: '2026-09-15T00:00:00.000Z'`
When `bfsDownstream` is queried with `asOf: '2026-09-09T00:00:00.000Z'`
Then the edge is excluded from the downstream traversal.

### Scenario: Historical correlation uses topology valid at the time of the incident

Given 3 ONUs under `CTO-1` that failed simultaneously on `2026-09-01T10:00:00.000Z`
  and one of those ONUs was moved to `CTO-5` on `2026-09-06T00:00:00.000Z`
When `correlateByTopologyAndTime` evaluates the historical events
Then it groups all 3 ONUs under `CTO-1` because `CTO-1` was their shared ancestor at incident time.
