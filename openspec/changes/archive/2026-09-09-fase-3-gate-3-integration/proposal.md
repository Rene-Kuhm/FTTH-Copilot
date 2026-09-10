# Fase 3 PR #8 — Integration Tests, LLM Fault Resilience, and Gate 3 Acceptance

## Why

Roadmap Fase 3 (3.8 & Gate 3):
- "3.8 Probar integración real de UI/API/DB y fallos del proveedor LLM con respuestas controladas."
- "Gate 3: caso completo reproducible desde incidente hasta feedback. Cero accesos cruzados o referencias fabricadas aceptadas en el corpus de aceptación. El técnico puede abrir la evidencia y distinguir diagnóstico provisional de causa confirmada. No se ejecutan acciones NMS."

Following PRs #120 (contract), #123 (evidence collector), #124 (facts & engine), #125 (validator), #126 (persistence), #127 (API), and #128 (UI card), this phase seals Phase 3 with end-to-end integration testing, LLM fault resilience under controlled responses, and Gate 3 acceptance validation:

1. **End-to-End Lifecycle Integration**:
   - Incident with real telemetry, syslog events, topology, and historical feedback.
   - Pipeline orchestrates collection, deterministic facts, cognitive inference, server validation, and immutable persistence.
   - Technician submits feedback on the active version via `/api/investigations/[runId]/versions/[versionId]/feedback`.
   - Re-investigation (`refresh: true`) creates a new version snapshot (`versionIndex: 1`) without modifying version 0 or existing technician adjudications.

2. **LLM Provider Fault Resilience with Controlled Responses**:
   - Upstream LLM provider 500/network error: caught gracefully, yielding safe fallback with missing items and insufficient status.
   - Upstream LLM timeout: produces HTTP 202 Pending with `retryAfterMs`.
   - Malformed/corrupt JSON response: safely caught and normalized without server crash.
   - Hallucinated references: rejected by server validator, preventing ungrounded claims.
   - Inconsistent numbers: detected as contradiction or fallback.
   - Attempted mutating actions: rejected; strictly read-only check kinds allowed.

3. **Multi-Tenant Isolation**:
   - Validates that cross-tenant access to incidents, investigation runs, snapshots, or feedback endpoints is strictly denied (404/403).

4. **UI E2E Acceptance (Playwright)**:
   - Exercises the full operator workflow in `IncidentsPanel` with `InvestigationCard`: opening investigation, viewing hypotheses and evidence, handling pending polling, re-investigating, and submitting human feedback.

## What changes

- `apps/web/tests/api/investigate-gate3.test.ts` (new):
  - Comprehensive integration test suite testing the full lifecycle, multi-tenant isolation, and controlled LLM fault injection (provider downtime, timeout, malformed payload, fabricated references, mutating checks).
- `apps/web/e2e/investigation-card.spec.ts` (new):
  - Playwright E2E spec verifying the UI investigation card, polling lifecycle, hypothesis rendering, and human feedback submission.

## Out of scope

- Multi-ONU correlation by topology and time (Fase 4).
- Maintenance windows and suppression rules (Fase 5).
