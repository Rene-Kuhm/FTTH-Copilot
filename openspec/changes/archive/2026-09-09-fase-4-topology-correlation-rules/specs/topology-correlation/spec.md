# Spec Delta: Deterministic Topology and Time Correlation Rules (Fase 4.1)

## Scenarios (Given/When/Then)

### Scenario: Multiple ONUs under same CTO failing within time window forms CTO correlation group

Given an authoritative topology where ONUs `onu-1`, `onu-2`, and `onu-3` belong to `CTO-10`
  and correlation config with `minAffectedCount: 3`, `minAffectedRatio: 0.5`, `timeWindowMs: 300000`
When events for all 3 ONUs arrive within a 2-minute span
Then `correlateByTopologyAndTime` produces a correlation group with ancestor `CTO:CTO-10`,
  `affectedCount: 3`, `totalPopulation: 4`, and `affectedRatio: 0.75`.

### Scenario: Single ONU failure does not trigger group correlation

Given an authoritative topology where `ONU-1` belongs to `CTO-10` (total 4 ONUs)
  and correlation config requiring `minAffectedCount: 2`
When only `ONU-1` emits a failure event
Then `correlateByTopologyAndTime` returns no correlation group for that event.

### Scenario: Failures across multiple CTOs under same Splitter trigger Splitter-level group

Given an authoritative topology where `CTO-A` (4 ONUs) and `CTO-B` (4 ONUs) connect to `SPLITTER-1` (total 8 ONUs)
  and correlation config with `minAffectedCount: 4`, `minAffectedRatio: 0.5`
When 2 ONUs from `CTO-A` and 2 ONUs from `CTO-B` fail within the time window
Then neither CTO meets `minAffectedCount: 4`, but `SPLITTER-1` has 4 affected ONUs out of 8 (ratio 0.5)
  and `correlateByTopologyAndTime` produces a correlation group bound to `SPLITTER:SPLITTER-1`.

### Scenario: Independent simultaneous failures below minAffectedRatio do not trigger parent group

Given an authoritative topology with `PON-1` hosting 32 ONUs across 8 CTOs
  and correlation config requiring `minAffectedRatio: 0.3` and `minAffectedCount: 3`
When 2 ONUs on `CTO-1` and 1 ONU on `CTO-5` fail concurrently (3 total out of 32 = 9.3% of PON)
Then no CTO meets `minAffectedCount: 3`, and `PON-1` fails `minAffectedRatio` (0.093 < 0.3),
  so no parent PON correlation group is created.

### Scenario: Events outside time window are not grouped together

Given 3 ONUs under `CTO-10` that fail with timestamps separated by 4 hours
  and correlation config with `timeWindowMs: 300000` (5 minutes)
When correlation is evaluated
Then the events are not clustered into a single correlation group.

### Scenario: Multi-tenant events and edges are never crossed

Given events and topology edges for `tenant-alpha` and `tenant-beta`
When `correlateByTopologyAndTime` is invoked for `tenant-alpha`
Then all edges and events belonging to `tenant-beta` are strictly excluded,
  and no cross-tenant correlation group is generated.
