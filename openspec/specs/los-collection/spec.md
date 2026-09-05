# los-collection Specification

## Purpose

Per-ONU LOS monotonic-counter collection/detection. Adds `LOS_SECONDS_TOTAL`; reuses the FEC loop; emits via `optical_degradation`. LOS-less tenants degrade benignly.

## Requirements

### Requirement: LOS MetricKind enum extension

`MetricKind` MUST include `LOS_SECONDS_TOTAL` (via Prisma migration), addressable by `assembleOnuDetailPoints`, `persistSamples`, and `group.ts`.

#### Scenario: Enum value is addressable

- GIVEN the migration applied
- WHEN code references `MetricKind.LOS_SECONDS_TOTAL`
- THEN `metric_samples` MUST accept rows.

### Requirement: OnuSummary field

`OnuSummary`/`OnuDetail` MUST expose `losSecondsTotal?: number` (monotonic seconds since ONU boot); absence MUST mean "no LOS reported".

#### Scenario: Optional field is present

- GIVEN any connector detail
- WHEN inspected
- THEN `losSecondsTotal?: number` MUST appear.

### Requirement: SmartOLT defensive mapping

SmartOLT MUST resolve `losSecondsTotal` from ≥5 candidate names: `los_seconds_total`, `los_seconds`, `losCount`, `los_count`, `loss_of_signal_seconds`, `signal_loss_seconds`; unresolved MUST yield `undefined`.

#### Scenario: Alternative field name is mapped

- GIVEN a SmartOLT payload with `loss_of_signal_seconds`
- WHEN `mapOnuDetail` runs
- THEN `losSecondsTotal` MUST equal the payload value.

#### Scenario: No LOS field yields undefined

- GIVEN a SmartOLT payload with no LOS candidate
- WHEN `mapOnuDetail` runs
- THEN `losSecondsTotal` MUST be `undefined`; no error MUST throw.

### Requirement: Analytics emission

`assembleOnuDetailPoints` MUST emit a `LOS_SECONDS_TOTAL` point on finite `losSecondsTotal`; skip on `undefined`/non-finite.

#### Scenario: SmartOLT emits LOS

- GIVEN a SmartOLT detail with finite `losSecondsTotal`
- WHEN `assembleOnuDetailPoints` runs
- THEN a `LOS_SECONDS_TOTAL` point MUST appear.

#### Scenario: Mikrowisp emits no LOS

- GIVEN a Mikrowisp detail with `losSecondsTotal = undefined`
- WHEN `assembleOnuDetailPoints` runs
- THEN no `LOS_SECONDS_TOTAL` point MUST appear and no throw.

### Requirement: Scheduler reuse

`runScheduledFecCollection` MUST be the single LOS collection point; no new scheduler/`setInterval`/env gate MAY be added; failed `getOnuDetail` MUST NOT abort other ONUs.

#### Scenario: LOS rows persist on the FEC tick

- GIVEN a FEC tick with SmartOLT details carrying finite `losSecondsTotal`
- WHEN the tick finalizes
- THEN LOS rows MUST persist alongside FEC rows.

#### Scenario: Skip or partial failure does not abort

- GIVEN a rate-budget skip OR `getOnuDetail` rejection
- WHEN the tick resolves
- THEN surviving ONUs MUST persist LOS+FEC rows, a `rate_limit` log MUST emit on skip, and the slice MUST NOT abort on failure.

### Requirement: Detector — `detectLosEvents`

System MUST expose `detectLosEvents(deviceKind, deviceId, losSecondsTotal, opts)` returning `Finding` (`optical_degradation`) on a 24 h window (`minSamples = 3`) with counter delta ≥ 1 s (warning) or ≥ 30 s (critical); sub-`minSamples` MUST return `null`.

#### Scenario: Counter-delta severity ladder

- GIVEN ≥3 samples in window
- WHEN the detector runs
- THEN delta ≥ 30 s MUST yield critical; delta in [1 s, 30 s) MUST yield warning; delta < 1 s MUST return `null`.

#### Scenario: Insufficient samples returns null

- GIVEN an empty series OR fewer than 3 samples
- WHEN the detector runs
- THEN it MUST return null.

### Requirement: Alert wiring

`runDetectors` MUST call `detectLosEvents` per series; `group.ts` MUST route `LOS_SECONDS_TOTAL` to `series.losSecondsTotal`; the `MetricKind` union MUST include `LOS_SECONDS_TOTAL` (in analytics and alerts types).

#### Scenario: LOS samples feed detector

- GIVEN a series with `losSecondsTotal` rows
- WHEN `runDetectors` runs
- THEN `detectLosEvents` MUST run on it.

### Requirement: Persistence agnosticity

`persistSamples` MUST stay MetricKind-agnostic; adding `LOS_SECONDS_TOTAL` MUST NOT touch `persistSamples`, `ingest.ts`, or `collect.ts`.

#### Scenario: LOS rows persist unchanged

- GIVEN a batch of `LOS_SECONDS_TOTAL` points
- WHEN `persistSamples` runs
- THEN rows MUST persist; no LOS branch MUST execute.

### Requirement: Rollback — forward-only

Rollback MUST be app-only; PG `MetricKind` MUST NOT lose values (PG forbids `DROP VALUE`); reverting app MUST leave the enum unreferenced.

#### Scenario: App revert with no migration

- GIVEN a deployed `LOS_SECONDS_TOTAL` migration
- WHEN app code is reverted without a migration
- THEN it MUST boot, persist NO new LOS rows; prior rows MUST stay queryable.

## MUST NOT

No new scheduler, env gate, `AlertKind`, Mikrowisp LOS, SNMP/gNMI (P2.4), or NetSense (P2.5); no edits to `runScheduledPoll`/`runScheduledFirmwareAudit`; `TRAFFIC_THROUGHPUT_MBPS` reconciliation is implementation-only.
