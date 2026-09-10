# Spec Delta: Cognitive Investigation API with Quotas and Concurrency Protection (Fase 3.6)

## Scenarios (Given/When/Then)

### Scenario: Investigation quota exceeded returns HTTP 429

Given an authenticated user who has exceeded their per-minute or daily investigation quota
When `POST /api/incidents/[id]/investigate` is called
Then the route returns HTTP 429 Too Many Requests with a `Retry-After` header.

### Scenario: Concurrent request to an in-flight investigation returns HTTP 202 Pending

Given an `InvestigationRun` currently in status `pending`
When another concurrent `POST /api/incidents/[id]/investigate` arrives for the same incident
Then the route does not launch a second pipeline, but returns HTTP 202 Accepted
  with `{ runId, status: 'pending', retryAfterMs: 3000 }`.

### Scenario: Investigation timeout yields HTTP 202 Pending response

Given an investigation execution whose processing exceeds the maximum HTTP timeout budget
When the request reaches the timeout limit
Then the route safely aborts the synchronous wait, marks/keeps the run as `pending`,
  and returns HTTP 202 with `{ runId, status: 'pending', retryAfterMs: 3000 }`.

### Scenario: End-to-end investigation run creates version and returns HTTP 201

Given a valid incident in the caller's tenant and available telemetry
When `POST /api/incidents/[id]/investigate` executes
Then it collects evidence, executes the cognitive engine, validates the snapshot,
  persists `InvestigationVersion` at index 0, transitions run to `ready`,
  and returns HTTP 201 with `{ runId, versionId, versionIndex: 0, status: 'ready', result: InvestigationResult }`.

### Scenario: Re-investigation with refresh: true creates version index 1

Given an existing `ready` investigation run with version index 0
When `POST /api/incidents/[id]/investigate` is called with `{ refresh: true }`
Then it runs the pipeline and creates version index 1, leaving version index 0 untouched,
  and returns HTTP 201 with `{ runId, versionId, versionIndex: 1, idempotent: false }`.

### Scenario: GET returns latest investigation version and snapshot

Given an incident with a completed investigation run
When `GET /api/incidents/[id]/investigate` is requested
Then it returns HTTP 200 with `{ runId, status: 'ready', version: { versionId, versionIndex, snapshot } }`.

### Scenario: Cross-tenant access is rejected with HTTP 404

Given an incident ID belonging to another tenant
When `GET` or `POST /api/incidents/[id]/investigate` is requested
Then the endpoint returns HTTP 404 Not Found without leaking run existence.
