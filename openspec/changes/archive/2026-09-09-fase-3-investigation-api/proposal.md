# Fase 3 PR #6 — Cognitive investigation API with quotas, timeouts, and duplicate protection

## Why

Roadmap Fase 3 (3.6): "Crear API de investigación con cuotas, timeout, cancelación
y protección contra duplicados simultáneos. Definir respuesta de ejecución pendiente
si el tiempo máximo HTTP no alcanza."

Following PR #120 (`ftth.investigation-result.v1` contract), PR #123 (evidence collector),
PR #124 (facts & cognitive engine), PR #125 (server validator), and PR #126 (immutable version
store), this phase wires the end-to-end investigation pipeline into HTTP API routes in `apps/web`.

Key requirements:
1. Investigation Quota / Rate Limiting: enforce user-level and tenant-level limits on
   investigation executions per minute and per day using `RateLimitBucket` (HTTP 429).
2. Protection against concurrent duplicates: if an investigation run for `(tenantId, incidentId)`
   is currently `pending`, concurrent requests do not spawn redundant parallel LLM executions,
   returning HTTP 202 Accepted with status `pending` and `retryAfterMs`.
3. Execution timeout & pending fallback: bounds HTTP execution time with an `AbortController`.
   If timeout is reached before LLM completion, the run remains in `pending` and responds
   with HTTP 202 indicating pending execution.
4. End-to-end orchestration:
   - Queries telemetry metrics, syslog events, topology edges, and past incidents.
   - Collects evidence via `collectInvestigationEvidence`.
   - Runs `investigateIncident` from `@ftth-copilot/agent-core`.
   - Validates via `validateInvestigationResult`.
   - Persists version into `investigation_versions` via `persistInvestigationVersion`.
5. Idempotent retrieval and refresh:
   - `GET /api/incidents/[id]/investigate`: returns the run and latest version snapshot.
   - `POST /api/incidents/[id]/investigate`: returns existing version if already ready,
     or creates a new version (`versionIndex + 1`) when `refresh: true` is requested.

## What changes

- `apps/web/lib/investigations/quota.ts` (new):
  - `consumeInvestigationQuota(userId)`: rate limiting for investigation endpoints.
- `apps/web/app/api/incidents/[id]/investigate/route.ts`:
  - Implements GET to retrieve latest run and version snapshot.
  - Upgrades POST with full end-to-end collection, LLM engine execution, validation,
    persistence, quota enforcement, concurrency locking, and timeout handling.
- `apps/web/tests/api/investigate-route.test.ts`:
  - Upgraded test suite covering quota rejection (429), pending concurrent request
    handling (202), timeout fallback, refresh requests, and GET retrieval.

## Out of scope

- UI investigation card component and frontend rendering (Fase 3 PR #7 / 3.7).
- Full UI/API/DB integration with fault injection (Fase 3 PR #8 / 3.8).
