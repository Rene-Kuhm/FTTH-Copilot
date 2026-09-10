# Tareas — Fase 5 PR #3: Maintenance UI Rendering + Suppression Audit Log

## 5.3.1 Suppression Audit Helper & Evaluation
- [x] Implementar `apps/web/lib/maintenance/suppression-audit.ts`:
  - `recordSuppressionAudit(prisma, input)`
  - `listSuppressedEvents(prisma, input)`
- [x] Tests unitarios TDD en `apps/web/tests/lib/maintenance/suppression-audit.test.ts`.

## 5.3.2 API de Auditoría de Supresiones
- [x] Crear ruta `GET /api/maintenance-windows/[id]/suppressions/route.ts`:
  - Autenticación (401), permiso `manage_maintenance` (403), tenant isolation (404).
  - Listar supresiones registradas para la ventana.
- [x] Tests de ruta en `apps/web/tests/api/maintenance-suppressions.test.ts`.

## 5.3.3 UI Rendering en InvestigationCard
- [x] Actualizar `apps/web/components/InvestigationCard.tsx`:
  - Fetch de `/api/incidents/:id` para obtener `relatedMaintenance`.
  - Renderizar sección de contexto de mantenimiento con banner/badge de "Contexto, no causa raíz".
- [x] Tests de componente en `apps/web/tests/components/investigation-card-maintenance.test.ts`.

## 5.3.4 Verificación Monorepo
- [x] Correr tests de `apps/web`.
- [x] Correr `pnpm turbo run build lint test` en todo el monorepo.
