# Fase 3 PR #2 — Evidence Collector Specification

## Why

Roadmap Fase 3 (3.2): "Reunir evidencia desde fuentes autorizadas en
`packages/evidence`. Recuperar historial confirmado como contexto, no como
prueba de la causa actual."

The evidence collector gathers raw data across 5 distinct domains:
1. `metric`: Telemetry samples from the target device.
2. `event`: Device syslog events and state changes.
3. `topology`: Upstream / downstream network topology hops.
4. `incident_history`: Past confirmed incidents for this device/connection.
5. `feedback`: Historical adjudications from past investigations.

Downstream consumers (`agent-core` prompt builder and API handlers) rely on this
module to produce an array of `InvestigationEvidenceRef` strictly conforming to
the contract locked in PR #120 (`ftth.investigation-result.v1`).

## Scenarios (Given/When/Then)

### Scenario: collects telemetry metrics within window and evaluates quality

Given an array of metric samples within [windowStart, windowEnd]
When `collectInvestigationEvidence` is called with target deviceId and window
Then each sample produces an `InvestigationEvidenceRef` with kind `metric`
And its `quality` is determined via `evidence-quality` (fresh/stale/insufficient)
And samples outside the window are omitted.

### Scenario: tags historical confirmed incidents as background context

Given past confirmed incidents for the same device or connection
When `collectInvestigationEvidence` gathers incident history
Then each history ref has kind `incident_history`
And its `summary` explicitly includes `[Contexto Histórico]`
And it is never marked as current confirmed root cause.

### Scenario: rejects data belonging to another tenant

Given candidates where `tenantId` does not match the requested tenantId
When `collectInvestigationEvidence` executes
Then any candidate from another tenant is strictly discarded
And if the requested `tenantId` is empty or invalid, the collector throws `MissingTenantError`.

### Scenario: caps total evidence refs to MAX_INVESTIGATION_EVIDENCE_REFS

Given raw inputs yielding more than 64 total evidence items
When `collectInvestigationEvidence` finishes collection
Then the resulting array contains at most `MAX_INVESTIGATION_EVIDENCE_REFS` (64) items
And preserves the most recent and critical observations without overflow.

### Scenario: incorporates topology hops

Given upstream and downstream topology hops for the device
When `collectInvestigationEvidence` processes topology
Then each hop produces an `InvestigationEvidenceRef` with kind `topology`
And summary details node relationship (e.g. OLT -> PON_PORT -> CTO -> ONU).

### Scenario: incorporates feedback history

Given past `InvestigationFeedback` rows for the same incident/run
When `collectInvestigationEvidence` processes feedback
Then each adjudication produces an `InvestigationEvidenceRef` with kind `feedback`
And summary records the technician's verdict (`confirmed`, `incorrect`, `insufficient_data`).

### Scenario: deterministic ordering

Given multiple evidence items collected across kinds and timestamps
When the collection output is generated
Then evidence items are deterministically sorted by `observedAt` descending,
then by `kind`, then by `evidenceRefId`.

## Rules (RFC 2119)

- The collector MUST be a pure TypeScript function, independent of Prisma / DB.
- The output array MUST only contain objects matching `investigationEvidenceRefSchema`.
- Every item MUST belong to the requested `tenantId`.
- The total number of returned refs MUST NOT exceed `MAX_INVESTIGATION_EVIDENCE_REFS` (64).
- Historical incidents MUST be marked as context only (`kind: 'incident_history'`).
- Time window MUST NOT exceed `MAX_INVESTIGATION_WINDOW_DAYS` (30 days).
