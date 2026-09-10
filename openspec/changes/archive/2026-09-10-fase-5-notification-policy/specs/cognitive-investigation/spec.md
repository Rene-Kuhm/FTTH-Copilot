# Fase 5 PR #2 — Notification policy + investigation-card surface + reevaluate (spec delta)

## Why

Roadmap Fase 5 (5.3 + 5.4 + 5.5 + 5.6). The model from PR #1 is in
place. Without these four surfaces, the model has no consumers and
the gates the roadmap pins are unmet.

## What changes

- `apps/web/lib/maintenance/notification-policy.ts` (new):
  pure `applyMaintenanceNotificationPolicy(args)` returning
  `'notify' | 'suppress' | 'never-suppress'`. The SOC list is
  closed (auth_failure, access, config_change, rogue_device) and
  forces 'never-suppress' even inside an active window.
- `apps/web/app/api/incidents/[id]/route.ts` (new):
  `GET` returns the incident + a `relatedMaintenance` array
  (5.5: context, NOT cause).
- `apps/web/app/api/maintenance-windows/[id]/reevaluate/route.ts`
  (new): `POST` reevaluates open incidents at window end (5.6).
  OFF by default (`MAINTENANCE_REEVAL_ENABLED` flag). Idempotent:
  one notification per (window, incident) via a dedupe row in
  AgentActionLog.
- `apps/web/tests/lib/maintenance/notification-policy.test.ts`:
  12 tests pinning the SOC list, default notify, suppression under
  tenant-wide window, never-suppress for SOC, and idempotence.

## Scenarios (Given/When/Then)

### Scenario: SOC event inside a maintenance window still notifies (5.4)

Given an event with `category='auth_failure'` and an active tenant-wide window covering its timestamp
When `applyMaintenanceNotificationPolicy` runs
Then the decision is `'never-suppress'`

### Scenario: a non-SOC warning inside a tenant-wide window is suppressed (5.3)

Given a `metric_anomaly` event at T inside an active tenant-wide window
When `applyMaintenanceNotificationPolicy` runs
Then the decision is `'suppress'`

### Scenario: a connection-scoped window NEVER suppresses yet

Given an active connection-scoped window and a non-SOC event inside it
When `applyMaintenanceNotificationPolicy` runs
Then the decision is `'notify'` (semantic mapping deviceKind → connection
lives outside this module; until it is wired up, suppression is unsafe)

### Scenario: cancelled window does not suppress

Given a cancelled window covering the event
When `applyMaintenanceNotificationPolicy` runs
Then the decision is `'notify'`

### Scenario: investigation card shows related maintenance as context (5.5)

Given the incident's `observedAt ± 24h` intersects non-cancelled windows
When `GET /api/incidents/:id` runs
Then the response carries `relatedMaintenance: MaintenanceWindow[]`
And the diagnosis engine MUST NOT auto-label any of them as the root cause

### Scenario: reevaluate is OFF by default (5.6 + MUST-10)

Given `MAINTENANCE_REEVAL_ENABLED !== 'true'`
When `POST /api/maintenance-windows/:id/reevaluate` runs
Then the response is 503 with `{error: 'disabled', feature: 'maintenance_reevaluation'}`

### Scenario: reevaluate notifies once per (window, incident) — no aluvión

Given a window ending and 3 open incidents in scope
When `POST /api/maintenance-windows/:id/reevaluate` runs twice
Then the first call writes 3 AgentActionLog rows (`__maintenance_reeval__`)
And the second call returns `skipped: 3, notified: 0`

## Rules (RFC 2119)

- `applyMaintenanceNotificationPolicy` MUST be pure.
- The SOC list is closed; production environments MAY extend it via
  configuration, but the default is the four categories listed
  above. A category outside the list is silenced under the same
  rules as any other event.
- Connection / device-scoped windows MUST NOT silence events until
  the consumer wires up the semantic mapping. The default is
  notify — never suppress by accident.
- The investigation card surfaces related maintenance as context,
  NOT as cause. The diagnosis MUST NOT auto-label a maintenance
  window as the root cause (5.5).
- The reevaluate endpoint is OFF by default. The flag is
  `MAINTENANCE_REEVAL_ENABLED` and MUST be set explicitly to
  `'true'` to enable.
- The "notify once per (window, incident)" rule is enforced by
  dedupe rows in `AgentActionLog`. A second call within the same
  window MUST NOT emit a second notification.

## Out of scope

- Persisting the suppression decisions for audit (5.4: "Registrar
  cada supresión y su motivo"). The audit surface ships in a
  separate change; the policy function emits the decision and the
  consumer is expected to log it.
- The semantic mapping deviceKind → connectionId (lives outside
  this module).
- The investigation-card UI rendering.
