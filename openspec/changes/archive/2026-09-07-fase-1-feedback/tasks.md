# Tareas — Fase 1: Validación Humana y Persistencia de Feedback

## 1.1 Persistencia y Modelo
- [x] Definir modelo `InvestigationFeedback` en `packages/db/prisma/schema.prisma` con `tenantId`, `versionId`, `authorUserId`, `label`, `notes`.
- [x] Ejecutar migración Prisma y generar cliente tipado.

## 1.2 Rutas API y Control de Pertenencia
- [x] Crear endpoint `POST /api/investigations/[runId]/versions/[versionId]/feedback`.
- [x] Validar permisos (`manage_incidents`), aislamiento por tenant e idempotencia ante envíos duplicados.
- [x] Tests unitarios y de integración en `apps/web/tests/api/investigations-feedback.test.ts`.
