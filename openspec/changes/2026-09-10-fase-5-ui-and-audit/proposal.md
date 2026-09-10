# Fase 5 PR #3 — Maintenance UI Rendering + Suppression Audit Log

## Why

Roadmap Fase 5 (5.4 + 5.5 + Gate 5 completion):
- 5.4: "Definir eventos que nunca se silencian por mantenimiento... Registrar cada supresión y su motivo."
- 5.5: "Mostrar mantenimiento en la investigación sin etiquetarlo automáticamente como causa real."
- Gate 5: "se preserva evidencia durante toda la ventana; quedan auditados avisos suprimidos y reactivados."

PR #136 delivered the `MaintenanceWindow` model and CRUD. PR #137 delivered the notification policy, reevaluate route, and `GET /api/incidents/:id` returning `relatedMaintenance`. This change completes the remaining surfaces: auditing event suppressions and rendering the related maintenance context inside the investigation card.

## What changes

1. `apps/web/lib/maintenance/suppression-audit.ts` (new):
   - `recordSuppressionAudit(prisma, { tenantId, windowId, event, reason })`: records suppression in `AgentActionLog` with `toolName: '__maintenance_suppression__'`.
   - `listSuppressedEvents(prisma, { tenantId, windowId, limit? })`: queries suppressed events for a window with tenant isolation.
2. `apps/web/app/api/maintenance-windows/[id]/suppressions/route.ts` (new):
   - `GET /api/maintenance-windows/:id/suppressions`: returns audit entries for suppressed events under the window. Gated by `manage_maintenance` and tenant isolation (404 on cross-tenant).
3. `apps/web/components/InvestigationCard.tsx`:
   - Fetches `relatedMaintenance` from `GET /api/incidents/:id`.
   - Renders a dedicated "Mantenimiento programado (Contexto)" block with explicit disclaimer "Contexto operativo — no etiquetado como causa raíz".
4. Tests:
   - Pure audit helper unit tests (`apps/web/tests/lib/maintenance/suppression-audit.test.ts`).
   - Route tests for `/api/maintenance-windows/:id/suppressions` (`apps/web/tests/api/maintenance-suppressions.test.ts`).
   - UI tests verifying maintenance rendering in `InvestigationCard` (`apps/web/tests/components/investigation-card-maintenance.test.tsx`).
