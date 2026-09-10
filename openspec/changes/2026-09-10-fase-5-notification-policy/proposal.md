# Fase 5 PR #2 — Notification policy + investigation-card surface + reevaluate

## Why

Roadmap Fase 5 (5.3 + 5.4 + 5.5 + 5.6). The model from PR #1 is in
place; without these four surfaces the model has no consumers.

## What changes

- Pure policy helper.
- `GET /api/incidents/:id` with `relatedMaintenance`.
- `POST /api/maintenance-windows/:id/reevaluate` (OFF by default).
- 12 pure tests.

## Out of scope

- Suppression audit log (separate change).
- Semantic mapping deviceKind → connectionId.
- UI rendering.
