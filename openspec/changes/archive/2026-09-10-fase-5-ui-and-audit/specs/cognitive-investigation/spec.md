# Fase 5 PR #3 — Maintenance UI Rendering + Suppression Audit Log (Spec Delta)

## Why

Complete Roadmap Fase 5 requirements 5.4 and 5.5 and satisfy Gate 5 auditability.

## Scenarios (Given/When/Then)

### Scenario: Suppressed event is recorded in the audit log (5.4)

Given an event evaluated by `applyMaintenanceNotificationPolicy` returning `suppress`
When `recordSuppressionAudit` is invoked
Then an entry is persisted in `AgentActionLog` with `toolName: '__maintenance_suppression__'`
  carrying `windowId`, `category`, `deviceKind`, `deviceId`, `whenMs`, and `reason`
  and associated with the tenant.

### Scenario: Operator queries suppressed events for a maintenance window

Given a tenant with recorded suppressed events for window `win-1`
When an authorized operator (with `manage_maintenance`) calls `GET /api/maintenance-windows/win-1/suppressions`
Then the response returns 200 with the array of suppressed event records.

### Scenario: Operator from another tenant cannot query suppressions (tenant isolation)

Given window `win-1` belonging to tenant A
When an operator belonging to tenant B calls `GET /api/maintenance-windows/win-1/suppressions`
Then the response is 404 (existence disclosure prevention).

### Scenario: InvestigationCard displays related maintenance windows as operational context (5.5)

Given an incident with active or overlapping maintenance windows returned by `/api/incidents/:id`
When `InvestigationCard` is loaded for the incident
Then it renders a visible "Mantenimiento programado" block
  and displays the window title, timeframe, and status
  and includes an explicit disclaimer that maintenance is operational context and not an automated root cause.

### Scenario: InvestigationCard with zero related maintenance windows

Given an incident with `relatedMaintenance: []`
When `InvestigationCard` is loaded
Then no maintenance block is rendered or a clean empty state is shown without warnings.
