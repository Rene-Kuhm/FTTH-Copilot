# Tareas — Fase 4 PR #2: Point-in-Time Temporal Topology Querying (Fase 4.2)

## 4.2.1 Helpers de Validez Temporal en `@ftth-copilot/evidence`

- [x] Implementar `isEdgeValidAt(edge, asOf)` en `packages/evidence/src/topology.ts`.
- [x] Actualizar `bfsAncestors`, `bfsDownstream` y `topologyPath` para aceptar `asOf?: string | Date | number | null`.
- [x] Exportar `isEdgeValidAt` desde `packages/evidence/src/index.ts`.

## 4.2.2 Integración en Motor de Correlación Topológica

- [x] Actualizar `packages/evidence/src/topology-correlation.ts` para evaluar ancestros y población downstream según el timestamp del cluster temporal (`asOf`), permitiendo correlación histórica fiel.

## 4.2.3 Soporte de `asOf` en Endpoints de API

- [x] Actualizar `apps/web/app/api/topology/path/route.ts` para aceptar parámetro opcional `asOf`.
- [x] Actualizar `apps/web/app/api/topology/downstream/route.ts` para aceptar parámetro opcional `asOf`.

## 4.2.4 Pruebas Unitarias TDD (RED -> GREEN)

- [x] Crear suite de pruebas de topología temporal en `packages/evidence/tests/temporal-topology.test.ts`.
- [x] Probar reconstrucción histórica, ramas migradas, bordes temporales (`validFrom`/`validTo`), aristas futuras y correlación histórica.

## 4.2.5 Verificación y Calidad

- [x] Ejecutar suites de tests de `@ftth-copilot/evidence` y `@ftth-copilot/web`.
- [x] Ejecutar `pnpm turbo run build lint test` en todo el monorepo.
