# Tareas — Fase 3 PR #6: Cognitive investigation API with quotas and concurrency protection

## 3.6.1 Cuotas de investigación

- [x] Crear `apps/web/lib/investigations/quota.ts`:
  - `consumeInvestigationQuota(userId)` con límites por minuto y por día usando `rateLimitBucket`.
  - Retorno de `{ allowed: boolean; retryAfter: number }`.

## 3.6.2 Pipeline de recolección y ejecución

- [x] Crear helper de recolección en `apps/web/lib/investigations/pipeline.ts`:
  - Lee muestras de métricas (`MetricSample`), eventos syslog (`DeviceEvent`), aristas topológicas (`TopologyEdge`), e incidentes confirmados (`ConfirmedIncident`).
  - Llama a `collectInvestigationEvidence` de `@ftth-copilot/evidence`.
  - Invoca `investigateIncident` de `@ftth-copilot/agent-core`.
  - Valida el resultado con `validateInvestigationResult` de `@ftth-copilot/agent-core`.
  - Persiste el resultado inmutable con `persistInvestigationVersion` de `@ftth-copilot/db`.

## 3.6.3 Actualización de ruta HTTP

- [x] Actualizar `apps/web/app/api/incidents/[id]/investigate/route.ts`:
  - `GET`: obtiene el estado actual del run y el último snapshot de `InvestigationVersion`.
  - `POST`:
    - Aplica cuota de investigación (429 si se excede).
    - Comprueba duplicados en vuelo (retorna 202 si el run ya está `pending`).
    - Soporta `refresh: true` para generar una nueva versión (`versionIndex + 1`).
    - Aplica timeout HTTP acotado devolviendo 202 con `retryAfterMs` si se supera el presupuesto.
    - Devuelve 201 en nueva versión y 200 en lectura idempotente.

## 3.6.4 Pruebas unitarias y de integración de la ruta

- [x] Actualizar `apps/web/tests/api/investigate-route.test.ts`:
  - Prueba de cuota excedida (429).
  - Prueba de concurrencia en vuelo (202 Pending).
  - Prueba de timeout excedido (202 Pending con retryAfterMs).
  - Prueba de re-investigación con `refresh: true` (201, versión incrementada).
  - Prueba de `GET` con recuperación del snapshot completo.
  - Preservación de permisos y aislamiento multi-tenant (404 en tenant ajeno).

## 3.6.5 Verificación y CI

- [x] Ejecutar `pnpm turbo run build lint test` y confirmar 100% verde en local.
