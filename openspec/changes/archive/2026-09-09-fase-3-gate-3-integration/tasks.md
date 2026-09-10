# Tareas — Fase 3 PR #8: Integration Tests, Fault Resilience, and Gate 3 Acceptance

## 3.8.1 Pruebas de Integración y Resiliencia de Fallas LLM (RED)

- [x] Crear `apps/web/tests/api/investigate-gate3.test.ts`:
  - Ciclo de vida completo: recolección -> hechos deterministas -> LLM controlado -> validación -> persistencia v0 -> feedback humano v0.
  - Re-investigación con `refresh: true`: persistencia v1 inmutable, v0 y feedbacks previos intactos.
  - Resiliencia ante falla del proveedor LLM: inyección de error/500 en LLM, retorno controlado de fallback seguro (`sufficiency: 'insufficient'`) sin 500 no controlado.
  - Resiliencia ante timeout: retorno 202 `pending` con `retryAfterMs`.
  - Poda/rechazo de referencias alucinadas: LLM inventa `evidenceRefId` inexistente, validador limpia la referencia sin corromper el contrato.
  - Rechazo estricto de comprobaciones mutantes: intento de inyectar acciones destructivas descartado hacia checks de solo lectura.
  - Aislamiento multi-tenant: llamadas de Tenant B hacia incidentes o runs de Tenant A retornan 404/403.

## 3.8.2 Pruebas E2E de Playwright (Ficha y Feedback)

- [x] Crear `apps/web/e2e/investigation-card.spec.ts`:
  - Carga del panel de incidentes y apertura de ficha mediante toggle.
  - Visualización de hipótesis, referencias a favor/en contra, badges de calidad de evidencia y comprobaciones de solo lectura.
  - Manejo de estado `pending` (HTTP 202) con indicador de análisis en curso.
  - Disparo de "Reinvestigar" con `{ refresh: true }`.
  - Envío de adjudicación de feedback técnico y actualización del registro histórico.

## 3.8.3 Validación de Gate 3 y Calidad

- [x] Ejecutar suites de tests y confirmar 100% verde (GREEN).
- [x] Ejecutar `pnpm turbo run build lint test` en todo el monorepo.
