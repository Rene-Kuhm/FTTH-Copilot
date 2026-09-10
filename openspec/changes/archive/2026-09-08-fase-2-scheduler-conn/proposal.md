# Fase 2 PR #3 — Scheduler health per-connection + hung-loop detection

## Why

Roadmap Fase 2 (2.6). The existing scheduler-health module answers
"is the loop alive?" but not "is the loop alive for THIS
connection?". A partial NMS failure currently looks healthy at the
service level.

## What changes

- `apps/web/lib/monitoring/connection-health.ts` (new): per-connection
  registry + pure `evaluateConnectionHealth` classifier.
- `apps/web/lib/monitoring/scheduler-health.ts`: adds
  `detectHangedLoops(snapshot, now, staleAfterMs?)`.
- `apps/web/app/api/health/route.ts`: additive `hungLoops` +
  `connections` fields. Existing shape unchanged.
- Tests: new `apps/web/tests/lib/monitoring/connection-health.test.ts`
  + extensions to `scheduler-health.test.ts` and `health.test.ts`.

## Out of scope

- Wiring `recordConnectionSuccess` / `recordConnectionError` into
  `scheduler.ts` (Fase 3 — when the investigation engine consumes
  per-connection signals).
- UI for the new fields (Fase 3).
