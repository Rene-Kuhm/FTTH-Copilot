# Fase 5 PR #1 — Maintenance-window model + create / cancel / list API (spec delta)

## Why

Roadmap Fase 5 (5.1 + 5.2): "Definir ventanas con tenant,
equipos/alcance explícito, inicio/fin UTC, zona horaria de
presentación, motivo, autor y estado. Primera versión sin
recurrencias." And "Incorporar creación, cancelación y auditoría
con permiso específico. Resolver ventanas solapadas de forma
determinista."

Without a typed window surface, an operator has no way to tell the
platform "we will be replacing the splitter at CTO-1 between 22:00
and 00:00 local time"; the suppression policy that depends on
maintenance state (5.3 + 5.4) has no signal to consume.

## What changes

- `packages/db/prisma/schema.prisma`: additive `MaintenanceWindow`
  model + back-relation on `Tenant`. Existing tables unchanged.
- `packages/db/prisma/migrations/20260910120000_maintenance_windows/migration.sql`:
  additive `CREATE TABLE` + 2 indexes. No backfill (table starts
  empty, grows with operator input).
- `apps/web/lib/auth/permissions.ts`: new permission
  `manage_maintenance` granted to OWNER + ADMIN.
- `apps/web/lib/maintenance/overlap.ts` (new): pure helpers —
  `validateMaintenanceInput`, `rangesOverlap`, `findOverlap`,
  `isInsideActiveMaintenance`.
- `apps/web/app/api/maintenance-windows/route.ts` (new):
  - `POST` — create; rejects overlapping non-cancelled windows
    with **409** (deterministic, no silent merge).
  - `GET` — list windows intersecting a UTC range (default ±24 h).
- `apps/web/app/api/maintenance-windows/[id]/route.ts` (new):
  - `DELETE` — soft-cancel; row stays in the table with
    `status='cancelled'`, `cancelledAt`, `cancelledByUserId`,
    `cancellationReason`. Already-cancelled or completed windows
    return 409 (no double-cancel).
- Tests: 16 pure tests in
  `apps/web/tests/lib/maintenance/overlap.test.ts` + 13 route
  tests in `apps/web/tests/api/maintenance-windows.test.ts`.

## Scenarios (Given/When/Then)

### Scenario: an operator with `manage_maintenance` creates a scheduled window

Given a tenant-scoped user with role ADMIN or OWNER
When the operator POSTs a valid window body
Then the route creates a `MaintenanceWindow` with `status='scheduled'`,
`createdByUserId = user.id`, and returns 201

### Scenario: overlapping windows are rejected deterministically (5.2)

Given a non-cancelled window `[12:30, 13:30]` of the same tenant
When the operator POSTs `[12:00, 13:00]`
Then the route returns 409 with `overlappingWindowId`, `overlappingWindowTitle`,
`overlappingStartUtc`, `overlappingEndUtc`
And NO new row is written

### Scenario: cancelled windows do NOT trigger overlap

Given an existing cancelled window at the same range
When the operator POSTs a new window with the same range
Then the route returns 201 (the cancellation preserved the
historical evidence; the new window is allowed)

### Scenario: tenant isolation

Given a `t_A` user
When the user DELETEs a `t_B` window
Then the route returns 404 (NOT 403 — no existence leak)

### Scenario: soft cancel preserves the row

Given a scheduled window
When the operator DELETEs with a `cancellationReason`
Then the route returns the cancelled row with `status='cancelled'`,
`cancelledAt`, `cancelledByUserId`, `cancellationReason`
And the original `createdByUserId` / `createdAt` / `scopeJson` are
intact

## Rules (RFC 2119)

- The maintenance permission MUST be checked server-side on every
  write route. A missing permission is 403.
- Tenant isolation MUST be enforced. Cross-tenant access is 404
  (no existence leak), never 403.
- Solapamiento MUST be deterministic and rejection-based: two
  non-cancelled windows of the same tenant may NOT coexist. The
  operator merges manually if needed.
- Cancel MUST be soft. The row stays in the table; the suppression
  policy retains the audit trail.
- The `scopeJson` field is opaque JSON (kind ∈ {tenant, connection,
  device}). The route validates structurally only — semantic
  interpretation lives in the consumer (Fase 5 PR #2).

## Out of scope

- Recurring windows (5.1 explicitly says "primera versión sin
  recurrencias").
- Notification policy (Fase 5 PR #2 — 5.3 + 5.4).
- Showing maintenance on the investigation card (5.5 — Fase 3
  follow-up).
- Re-evaluation when a window ends (5.6 — Fase 5 PR #2).
- The MIBs / SNMP / SOC integration (Fase 6).
