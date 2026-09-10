# Tareas — Fase 7: Piloto y Aceptación

## 7.1 Tenant Piloto y Runbook Operativo de Respaldo (7.1)
- [x] Definir contrato y tipos de aprovisionamiento de piloto (`pilotTenantConfigSchema`) en `packages/eval/src/pilot-tenant.ts`.
- [x] Documentar procedimiento operativo de respaldo (SOP) en `docs/operations/pilot-sop-and-fallback.md`.
- [x] Tests unitarios de autorización de piloto y feature flags progresivos en `packages/eval/tests/pilot-tenant.test.ts`.

## 7.2 Conjunto de Evaluación Congelado y Trazabilidad (7.2)
- [x] Implementar dataset congelado independiente `packages/eval/src/pilot-frozen-dataset.ts` con schema `ftth.pilot-frozen-eval.v1`.
- [x] Tests de integridad y separación de fixtures en `packages/eval/tests/pilot-frozen-dataset.test.ts`.

## 7.3 Métricas de Calidad y Rendimiento (7.3, 7.4)
- [x] Implementar motor de métricas de piloto en `packages/eval/src/pilot-metrics.ts` (precisión de diagnóstico, afirmaciones respaldadas, abstención, falsos positivos, latencia p95, costo por investigación, tiempo a causa vs tiempo a resolución con muestra N).
- [x] Tests unitarios en `packages/eval/tests/pilot-metrics.test.ts`.

## 7.4 Umbrales de Aceptación y Criterios Duros (7.5, 7.6)
- [x] Implementar evaluador de criterios duros (0 accesos cruzados, 0 acciones NMS, rechazo de referencias inexistentes) y umbrales mínimos (14 días, 50 casos) en `packages/eval/src/pilot-acceptance.ts`.
- [x] Tests unitarios en `packages/eval/tests/pilot-acceptance.test.ts`.

## 7.5 Rollback, Verificación Monorepo y Gate 7 (7.7 & Gate 7)
- [x] Implementar test de rollback seguro (flag OFF sin eliminación de datos) en `packages/eval/tests/pilot-rollback.test.ts`.
- [x] Exportar módulos en `packages/eval/src/index.ts`.
- [x] Documentar evidencia y reporte de Gate 7 en `docs/validation/fase-7-pilot-report.md`.
- [x] Ejecutar `pnpm turbo run build lint test` en todo el monorepo.
