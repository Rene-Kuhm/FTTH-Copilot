# Fase 5 PR #1 — Maintenance-window model + API

## Why

Roadmap Fase 5 (5.1 + 5.2). Without a typed window surface the
suppression policy (5.3 + 5.4) has no signal to consume.

## What changes

- Schema aditivo + back-relation Tenant + migración sin backfill.
- `manage_maintenance` permission.
- Pure overlap helpers.
- POST / GET / DELETE routes.
- 16 + 13 tests.

## Out of scope

- Recurring windows.
- Notification policy (PR #2).
- Investigation-card rendering (PR #2).
