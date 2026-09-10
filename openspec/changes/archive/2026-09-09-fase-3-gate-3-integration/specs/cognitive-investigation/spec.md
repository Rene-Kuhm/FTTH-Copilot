# Spec Delta: Integration Tests, Fault Resilience, and Gate 3 Acceptance (Fase 3.8)

## Scenarios (Given/When/Then)

### Scenario: Full investigation lifecycle from incident to versioned feedback

Given an incident in the database with telemetry metrics, syslog events, topology edges, and historical feedback
When an operator calls `POST /api/incidents/[id]/investigate`
Then the pipeline collects evidence, computes facts, validates the result, and persists `InvestigationVersion` at index 0,
  and when the operator calls `POST /api/investigations/[runId]/versions/[versionId]/feedback` with label `confirmed`,
  the adjudication is persisted in the database and linked to that exact `versionId`.

### Scenario: Re-investigation creates version 1 preserving version 0 and its feedback

Given an incident with a completed investigation version at index 0 with recorded feedback
When an operator calls `POST /api/incidents/[id]/investigate` with `{ refresh: true }`
Then a new `InvestigationVersion` is persisted at index 1,
  the existing version 0 and its feedback records remain completely unmodified,
  and the run status remains `ready`.

### Scenario: LLM provider outage or 500 error falls back safely

Given an incident being investigated while the LLM provider fails (network disconnect, 500 status, or throws)
When the pipeline executes
Then it does not crash or throw an unhandled 500 to the caller,
  but instead catches the fault and returns a safe fallback result (`sufficiency: 'insufficient'`)
  documenting the missing analysis in `missing`.

### Scenario: LLM timeout returns HTTP 202 Pending response

Given an investigation request whose execution exceeds the HTTP budget
When the request runs
Then it safely returns HTTP 202 Accepted with status `pending` and `retryAfterMs: 3000`,
  and does not create a broken partial version in the database.

### Scenario: Hallucinated references from LLM are rejected or pruned

Given an LLM response containing an `evidenceRefId` not present in the gathered evidence references
When the server-side validator evaluates the candidate result
Then the hallucinated reference is pruned or triggers safe fallback,
  ensuring zero fabricated references are accepted into the persistent record.

### Scenario: Non-read-only checks are strictly rejected

Given an LLM candidate response suggesting a mutating check kind (e.g. `reboot_onu` or `change_vlan`)
When evaluated by the server validator
Then the check is rejected and sanitized, ensuring that only read-only check kinds
  (`observe_only`, `topology_lookup`, `recent_events`, `metric_history`) reach the technician.

### Scenario: Cross-tenant isolation is maintained with zero data leakage

Given an incident and investigation run belonging to Tenant A
When a user belonging to Tenant B attempts to read or trigger investigation or submit feedback
Then the endpoints return HTTP 404 or 403, preventing any cross-tenant data leakage.

### Scenario: UI E2E renders complete investigation card and submits feedback

Given the web application running with an open incident
When the operator expands the investigation card
Then it displays sufficiency status, competing hypotheses with for/against evidence references,
  evidence catalog with quality badges, and allows submitting feedback that persists to the version.
