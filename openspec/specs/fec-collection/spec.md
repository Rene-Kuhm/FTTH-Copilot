# fec-collection Specification

## Purpose

Opt-in, rate-budgeted FEC / optical telemetry loop. Fans out to a deterministic per-ONU slice on a configurable cadence, persists via `collectSamples` + `persistSamples`, stays within the SmartOLT 15 req/h budget via a pre-flight guard, and degrades to zero rows (no error) when a connector lacks FEC telemetry.

## Requirements

### Requirement: FEC collection loop (independent, opt-in)

The system MUST run a FEC collection loop independent from the metrics poller and the firmware audit. `setInterval` MUST register only when `FEC_COLLECTION_ENABLED=true`. The loop MUST read `FEC_COLLECTION_INTERVAL_MS` (default 3,600,000 ms) and `FEC_FAN_OUT_PER_CYCLE` (default 8) and call `runScheduledFecCollection()` per tick. It MUST NOT spawn a subprocess / worker, change `MetricKind` / `AlertKind`, or modify `runScheduledPoll` / `runScheduledFirmwareAudit`.

#### Scenario: Default-disabled env produces no loop

- GIVEN `FEC_COLLECTION_ENABLED` unset (default `false`)
- WHEN `apps/web/instrumentation.ts` boots
- THEN no FEC `setInterval` MUST register.

#### Scenario: Enabled env ⇒ three independent loops

- GIVEN `FEC_COLLECTION_ENABLED=true`
- WHEN instrumentation boots
- THEN three independent `setInterval`s MUST register; existing two MUST stay byte-identical.

### Requirement: Staggered per-ONU rotation (deterministic, pure)

The system MUST expose `pickFecFanOutSlice(onus, now, sliceSize)` — pure, sorts input, returns `min(sliceSize, onus.length)`. Consecutive calls in the same interval MUST return disjoint slices. When `sliceSize >= onus.length`, the slice MUST equal the full sorted input. Function MUST be `O(n log n)`, MUST NOT mutate `onus`, MUST NOT perform I/O.

#### Scenario: Disjoint slices across ticks, no mutation

- GIVEN `onus.length = 16`, `sliceSize = 8`, two `now` in the same interval
- WHEN the function runs twice
- THEN slices MUST share no `onuId` AND `onus` stays deep-equal.

#### Scenario: Slice ≥ input ⇒ full input

- GIVEN `onus.length = 5`, `sliceSize = 8`
- WHEN the function runs
- THEN slice MUST equal the sorted input of all 5 ONUs.

### Requirement: Pre-flight rate-budget guard (15 req/h)

The system MUST expose `fitsRateBudget(perCycle, intervalMs, limitPerHour)`. The loop MUST call `fitsRateBudget(slice.length, intervalMs, 15)` before each fan-out. On `false`, MUST skip the tick (zero `getOnuDetail`) and emit one structured warning. On `true`, MUST proceed and call `persistSamples`.

#### Scenario: Default cadence + slice passes

- GIVEN `perCycle=8`, `intervalMs=3,600,000`, `limitPerHour=15`
- WHEN the guard runs
- THEN it MUST return `true`.

#### Scenario: Oversized fan-out skips with one log line

- GIVEN `perCycle=32`, `intervalMs=3,600,000`, `limitPerHour=15`
- WHEN the loop schedules the fan-out
- THEN guard MUST return `false`, NO `getOnuDetail` MUST fire, and one log line with `reason: 'rate_limit'` + `requested=32` MUST be emitted.

### Requirement: Persisted samples feed the existing detector

The system MUST reuse `collectSamples(connector, meta, { includeOnuDetail: true })` and persist via `persistSamples` (no new `MetricKind`, no migration). A row persists only when the source field is finite. When the connector returns no `fec*` / `biasCurrent*` / `ontTemperature*` fields, the loop MUST persist zero rows and MUST NOT throw. It MUST NOT call any detector.

#### Scenario: SmartOLT persists up to four kinds per ONU

- GIVEN a SmartOLT detail with finite `fecCorrected`, `fecUncorrected`, `biasCurrentMa`, `ontTemperatureCelsius`
- WHEN the loop processes that ONU
- THEN up to four `metric_samples` rows MUST persist for the four kinds.

#### Scenario: Mikrowisp persists zero rows without throwing

- GIVEN a Mikrowisp detail with no `fec*` / `biasCurrent*` / `ontTemperature*` fields
- WHEN the loop processes the slice
- THEN zero rows MUST persist, no throw, and the slice MUST NOT abort.

#### Scenario: Non-finite skipped; no detector triggered

- GIVEN `fecCorrected = NaN` AND the tick completes
- WHEN the loop finalizes
- THEN no `metric_samples` MUST persist for that field AND `detectFecDegradation` / `runDetection` MUST NOT be called.

### Requirement: Kill switch and idempotence

`FEC_COLLECTION_ENABLED=false` MUST prevent new ticks; in-flight tick work MUST NOT be aborted. A failed `getOnuDetail` MUST NOT abort the rest (`mapAllSettled`). A thrown `runScheduledFecCollection()` MUST NOT detach the loop; the next tick MUST still fire.

#### Scenario: Kill switch leaves in-flight tick alone

- GIVEN a tick in flight and env flipping to `false` mid-tick
- WHEN the tick resolves
- THEN it MUST complete normally and no further tick MUST be scheduled.

#### Scenario: Partial failure and thrown tick both recover

- GIVEN 1 of 8 ONUs rejecting `getOnuDetail` AND a later tick throwing
- WHEN each event resolves
- THEN the 7 surviving ONUs MUST persist rows AND the next `setInterval` tick MUST still fire.

### Requirement: Operational telemetry

Each completed tick MUST emit one structured log line `{ tenantId, connectionId, requested, persisted, skipped, durationMs }`. A skipped tick MUST emit one line with `reason: 'rate_limit'`. Logs MUST NOT contain tokens, cookies, or `Authorization` headers.

#### Scenario: Normal tick log shape

- GIVEN `requested=8`, `persisted=28`, `skipped=0`, `durationMs=412`
- WHEN the tick completes
- THEN one log line MUST be emitted with those values.

#### Scenario: Skipped shape and no secret leakage

- GIVEN a rate-budget skip AND connector config with tokens
- WHEN the tick exits
- THEN one log line MUST be emitted with `reason='rate_limit'` and MUST NOT contain tokens, cookies, or `Authorization` headers.

## MUST NOT

The change MUST NOT add detector logic, Prisma migrations, dashboard UI, Mikrowisp FEC, SNMP/gNMI (P2.3/P2.4), or edits to `runScheduledPoll` / `runScheduledFirmwareAudit`.

## Canonical

Written under `openspec/changes/p2-1-fec-collection/specs/fec-collection/spec.md` only. The prevailing convention reserves `openspec/specs/fec-collection/spec.md` for `sdd-archive` to populate at promotion time.
