# Tareas — Fase 5 PR #1: Maintenance-Window Model and API

## 5.1 Modelo y Persistencia
- [x] Definir modelo `MaintenanceWindow` en `packages/db/prisma/schema.prisma` con `tenantId`, `scope`, `startTimeUtc`, `endTimeUtc`, `reason`, `status`.
- [x] Aplicar migración y generar cliente Prisma.

## 5.2 Rutas API
- [x] Crear endpoints `GET/POST/DELETE /api/maintenance-windows`.
- [x] Resolver solapamientos de ventanas de forma determinista y auditar creador/cancelación.
- [x] Tests en `apps/web/tests/api/maintenance-windows.test.ts`.
