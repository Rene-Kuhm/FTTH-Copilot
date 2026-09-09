# Fase 2 PR #3 — Scheduler health per-connection + hung-loop detection (spec delta)

## Why

Roadmap Fase 2 (2.6): verificar salud con casos de recuperación,
ausencia de primera ejecución, ciclo colgado y fallos parciales por
conexión. No asumir que un retorno exitoso del scheduler implica
recolección exitosa de todos los equipos.

The existing `scheduler-health.ts` tracks per-SERVICE state
(polling, firmware, fec, syslog). It answers "is the loop alive?"
but not "is the loop alive for THIS connection?". A partial NMS
failure looks healthy at the service level.

## What changes

- `apps/web/lib/monitoring/connection-health.ts` (new): per-connection
  registry + pure classifier (`fresh | healthy | stale | error |
  recovered`). The five states map the four scenarios the roadmap
  pins plus the recovered transition.
- `apps/web/lib/monitoring/scheduler-health.ts`: adds
  `detectHangedLoops(snapshot, now, staleAfterMs?)` — pure, lists
  expected services whose last successful tick is older than the
  threshold (covers "ciclo colgado" and "ausencia de primera
  ejecución").
- `apps/web/app/api/health/route.ts`: response gains two additive
  fields, `hungLoops: string[]` and `connections: ConnectionHealth[]`.
  The existing `status`, `services`, `healthy` semantics are
  unchanged — additive only.
- Tests: new file `apps/web/tests/lib/monitoring/connection-health.test.ts`
  + an extended `scheduler-health.test.ts` + four new route tests
  in `apps/web/tests/api/health.test.ts`.

## Scenarios (Given/When/Then)

### Scenario: ciclo colgado (last tick too old)

Given a service whose `lastRunAt` is older than `staleAfterMs`
When `detectHangedLoops` runs
Then the service name appears in the returned list

### Scenario: ausencia de primera ejecución (never ran)

Given an expected service with `lastRunAt === null`
When `detectHangedLoops` runs
Then the service name appears in the returned list

### Scenario: fallo parcial por conexión

Given `c-1` succeeded recently and `c-2` errored recently
When `snapshotEvaluatedConnectionHealth` runs
Then `c-1.state === 'healthy'` and `c-2.state === 'error'`
And the service-level snapshot is NOT contaminated — partial
failure stays per-connection (no fabricated service-down claim)

### Scenario: recuperación del recolector (recovered)

Given a connection had a recent error and a more recent success
When `evaluateConnectionHealth` runs
Then the state is `recovered`, not `healthy` (operator can see the
historical error in the snapshot)

### Scenario: never observing a connection (primera ejecución ausente)

Given the per-connection registry has no entry for `c-x`
When `evaluateConnectionHealth` runs on a `fresh` row
Then the state is `fresh`

## Rules (RFC 2119)

- The connection-health module MUST NEVER assert a device-down
  claim. It describes the collector stream per connection; device
  state is a separate concern (2.4).
- The `/api/health` response shape MUST remain additive. Existing
  consumers that read `status`, `services`, `healthy` MUST NOT
  break.
- `evaluateConnectionHealth` MUST be pure (same input → same output,
  no clock reads, no `Date.now()` in the body). Callers pass `now`
  explicitly.

## Out of scope

- Wiring the per-connection recorder into `scheduler.ts` (a separate
  PR in Fase 3, when the investigation engine starts consuming
  per-connection signals). This PR ships the registry and the
  classifier; the polling loop continues to register per-service
  only.
- UI surfaces for the new fields (lives in Fase 3).
- Persistence of per-connection health (process-local, like the
  existing scheduler-health module).
