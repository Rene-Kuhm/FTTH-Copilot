# Spec Delta: Immutable Investigation Version Persistence & Snapshot Store (Fase 3.5)

## Scenarios (Given/When/Then)

### Scenario: Persist initial investigation version (index 0)

Given an existing `InvestigationRun` in `pending` status and a valid `InvestigationResult`
When `persistInvestigationVersion` executes
Then an `InvestigationVersion` row is created with `versionIndex: 0`,
  its `snapshotJson` stores the envelope, and the run status becomes `ready`.

### Scenario: Subsequent investigation creates next immutable version (index 1)

Given an `InvestigationRun` that already has version index 0
When `persistInvestigationVersion` is called with a new `InvestigationResult`
Then a new `InvestigationVersion` row is created with `versionIndex: 1`,
  leaving the version 0 row completely unchanged.

### Scenario: Retrieve latest investigation version

Given an `InvestigationRun` with version 0 and version 1
When `getLatestInvestigationVersion` is called
Then it returns version 1 with its parsed `snapshotJson` matching `investigationResultSchema`.

### Scenario: Retrieve historical version for adjudication audit

Given an `InvestigationRun` with version 0 that received technician feedback, followed by version 1
When `getInvestigationVersionById` is queried with `versionId` of version 0
Then it returns the exact immutable snapshot of version 0 as evaluated by the technician.

### Scenario: Reject cross-tenant persistence or read

Given an `InvestigationRun` belonging to `tenant-a`
When `persistInvestigationVersion` or `getLatestInvestigationVersion` is invoked with `tenant-b`
Then the operation fails with a tenant mismatch error or returns not found.

### Scenario: Reject invalid investigation result payload before persistence

Given an `investigationResult` that violates schema limits (e.g. > 64 evidence refs)
When `persistInvestigationVersion` runs
Then the operation throws a schema validation error and writes zero rows to the database.
