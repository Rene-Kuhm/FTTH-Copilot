# Tareas — Fase 3 PR #5: Immutable investigation version persistence & snapshot store

## 3.5.1 Definición de tipos y store de persistencia

- [x] Crear `packages/db/src/investigation-store.ts`:
  - `PersistInvestigationVersionArgs`: `tenantId`, `runId`, `investigationResult`, `connectionId?`, `incidentId?`, `requestedByUserId?`.
  - `PersistedInvestigationVersion`: versión con `snapshot: InvestigationResult`.
  - `persistInvestigationVersion(prisma, args)`:
    - Validación del sobre con `investigationResultSchema.parse`.
    - Transacción atómica: cálculo de `versionIndex` siguiente (0, 1, 2...).
    - Inserción inmutable en `investigation_versions`.
    - Actualización de estado en `investigation_runs` a `ready`.
  - `getLatestInvestigationVersion(prisma, { tenantId, runId })`:
    - Lectura del último snapshot por `versionIndex desc`.
  - `getInvestigationVersionById(prisma, { tenantId, runId, versionId })`:
    - Lectura de versión inmutable específica para auditoría de feedback.
  - `listInvestigationVersions(prisma, { tenantId, runId })`:
    - Historial de versiones ordenado.

## 3.5.2 Exportaciones y Barrel

- [x] Re-exportar funciones y tipos de `investigation-store.ts` en `packages/db/src/index.ts`.

## 3.5.3 Pruebas de integración TDD

- [x] Crear `packages/db/tests/investigation-store.test.ts` cubriendo:
  - Creación de versión inicial (index 0).
  - Creación atómica de versión subsecuente (index 1) preservando inmutable la versión 0.
  - Recuperación de última versión y versiones históricas.
  - Aislamiento multi-tenant.
  - Rechazo de sobres inválidos antes de escribir en base de datos.

## 3.5.4 Verificación y CI

- [x] Ejecutar `pnpm turbo run build lint test` y confirmar 100% verde en local.
