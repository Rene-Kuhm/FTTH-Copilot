# Design: P2.2 LOS Optical Metrics

## Technical Approach

P2.2 closes the per-ONU LOS gap by reusing P2.1's `runScheduledFecCollection` fan-out. SmartOLT's `getOnuDetail` already returns FEC/bias/temp; we extend `pickNumber` with a 6-key LOS candidate list, add `losSecondsTotal?: number` to `OnuSummary`, emit a fifth `LOS_SECONDS_TOTAL` `MetricPoint` per detail, and run a new `detectLosEvents` reusing `optical_degradation`. **Zero new scheduler code, zero new env vars, one Prisma migration.** Mikrowisp degrades benignly (undefined → no point → empty series → `null`). Side-fix: reconcile `TRAFFIC_THROUGHPUT_MBPS` in analytics + alerts TS unions (types only). Implements `specs/los-collection/spec.md`.

## Architecture Decisions

### AD-1 — Single `LOS_SECONDS_TOTAL` enum member
**Choice**: One `MetricKind` value. **Alternative**: split `LOS_EVENTS_TOTAL` + `LOS_SECONDS_TOTAL`. **Rationale**: FEC precedent uses one member per monotonic counter; splitting multiplies migration + test surface for no detector benefit.

### AD-2 — Reuse `runScheduledFecCollection`
**Choice**: Extend existing loop; no new `setInterval`. **Alternative**: `runScheduledLosCollection` + `LOS_COLLECTION_ENABLED`. **Rationale**: LOS lives on the same `getOnuDetail` endpoint; a second loop doubles per-ONU calls. P2.1 established "single endpoint → single loop".

### AD-3 — Defensive `pickNumber` with 6 candidates
**Choice**: `['los_seconds_total','los_seconds','losCount','los_count','loss_of_signal_seconds','signal_loss_seconds']`. **Alternative**: hardcoded single field. **Rationale**: SmartOLT ships FEC corrected/uncorrected each under 3 names. Unresolved → undefined → `pointIfFinite` skips → empty series.

### AD-4 — New `detectLosEvents` (not extending `detectOpticalDegradation`)
**Choice**: New `packages/detection/src/los.ts` mirroring `detectFecDegradation`: counter-delta over 24 h, `minSamples: 3`, warning Δ ≥ 1 s, critical Δ ≥ 30 s. **Alternative**: LOS branch inside `detectOpticalDegradation`. **Rationale**: that detector consumes bias/temp *levels*; LOS is an *event counter*. Combining couples unrelated thresholds.

### AD-5 — Reuse `optical_degradation` AlertKind
**Choice**: `kind: 'optical_degradation'`. **Alternative**: new `los_events` `AlertKind` (second `ALTER TYPE AlertKind ADD VALUE`). **Rationale**: One migration is enough; title/description disambiguates; `correlateAlerts` collapses per-device findings.

### AD-6 — Reconcile `TRAFFIC_THROUGHPUT_MBPS` in same PR (TS only)
**Choice**: Add to `analytics/src/types.ts` and `alerts/src/types.ts` `MetricKind` unions while editing them. **Alternative**: separate PR. **Rationale**: ~3 LOC while the union is touched.

### AD-7 — `stacked-to-main` chain: helpers-slice + detector-slice
**Choice**: PR #1 helpers-slice (~150 LOC) = migration + `OnuSummary` field + connector `pickNumber` + fixtures + `assembleOnuDetailPoints` extension + types + `group.ts` arm + `SeriesByDevice.losSecondsTotal` + helper tests. PR #2 detector-slice (~150 LOC) = `detectLosEvents` + `runDetectors` call + index re-export + scheduler happy-path + unit tests + docs. Both under 400-line cap. **Alternative**: single PR. **Rationale**: Migration serializes enum-value change before detector wiring consumes it.

## Data Flow

```
startFecCollectionLoop → runScheduledFecCollection
  → pickFecFanOutSlice → fitsRateBudget
  → mapAllSettled(getOnuDetail, 4)
    → pickNumber(LOS_CANDIDATES) → losSecondsTotal
  → assembleOnuDetailPoints (5 kinds):
    LOS_SECONDS_TOTAL | FEC_CORRECTED | FEC_UNCORRECTED
    | BIAS_CURRENT_MA | ONT_TEMPERATURE_CELSIUS
  → persistSamples (unchanged)
  → runDetectors
    detectOpticalDegradation (existing)
    detectLosEvents          (NEW)
  → correlateAlerts → notifications
```
Mikrowisp: `losSecondsTotal = undefined` ⇒ `pointIfFinite` skips ⇒ empty series → `null`.

## File Changes

| File | Action |
|---|---|
| `packages/db/prisma/schema.prisma` | Modify |
| `packages/db/prisma/migrations/<ts>_add_los_metric_kind/migration.sql` | Create |
| `packages/connectors/core/src/index.ts` | Modify |
| `packages/connectors/smartolt/src/client.ts` | Modify |
| `packages/connectors/smartolt/src/fixtures.ts` | Modify |
| `packages/analytics/src/scheduler-helpers.ts` | Modify |
| `packages/analytics/src/types.ts` | Modify |
| `packages/alerts/src/types.ts` | Modify |
| `packages/alerts/src/group.ts` | Modify |
| `packages/alerts/src/runner.ts` | Modify |
| `packages/detection/src/los.ts` | Create |
| `packages/detection/src/index.ts` | Modify |
| `packages/detection/tests/los.test.ts` | Create |
| `packages/analytics/tests/scheduler-helpers.test.ts` | Modify |
| `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` | Modify |
| `docs/architecture.md`, `docs/roadmap-integraciones-pendientes.md` | Modify |

Descriptions: enum extension + `ALTER TYPE` migration; `OnuSummary` field + 6-key `pickNumber`; ≥3 fixtures carry `losSecondsTotal`; one-line `maybePush` extension; union additions + `TRAFFIC_THROUGHPUT_MBPS` reconcile; `group.ts` switch arm + `SeriesByDevice.losSecondsTotal`; `runDetectors` call + index re-export; `detectLosEvents` ~50 LOC; ≥6 unit cases; 5th-kind test assertions; `persisted === 40` for 8 × 5; detector table + §P2.2 ✅ shipped.

## Interfaces / Contracts

```ts
// connectors/core/src/index.ts — additive
export interface OnuSummary {
  /** Per-ONU LOS monotonic counter (seconds since ONU last boot).
   *  Absence = "no LOS reported by the NMS". */
  losSecondsTotal?: number;
}

// analytics/src/types.ts + alerts/src/types.ts
export type MetricKind =
  | 'RX_POWER_DBM' | 'TX_POWER_DBM' | 'TEMPERATURE_CELSIUS'
  | 'UPTIME_SECONDS' | 'STATUS' | 'FEC_CORRECTED' | 'FEC_UNCORRECTED'
  | 'BIAS_CURRENT_MA' | 'ONT_TEMPERATURE_CELSIUS'
  | 'LOS_SECONDS_TOTAL'        // NEW
  | 'TRAFFIC_THROUGHPUT_MBPS'; // reconciled P2.1 follow-up

// connectors/smartolt/src/client.ts
const LOS_CANDIDATES = [
  'los_seconds_total', 'los_seconds', 'losCount',
  'los_count', 'loss_of_signal_seconds', 'signal_loss_seconds',
] as const;

// detection/src/los.ts — NEW
export interface LosOptions {
  now?: number; windowMs?: number;        // default 24 h
  minSamples?: number;                    // default 3
  warningDelta?: number; criticalDelta?: number; // 1s / 30s
}
export function detectLosEvents(
  deviceKind: DeviceKind, deviceId: string,
  losSecondsTotal: NumericSample[], opts?: LosOptions,
): Finding | null;
// Returns { kind: 'optical_degradation', severity: 'warning'|'critical',
//   title: `Pérdida de señal (LOS) en ${deviceId}`,
//   description: `LOS acumulado ${delta}s en ventana de ${windowMs/3.6e6}h` }
//   or null.
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | `detectLosEvents` | `packages/detection/tests/los.test.ts` — ≥6 cases: empty → `null`; 1 sample (< `minSamples`) → `null`; 2 equal → `null`; Δ ≥ `warningDelta` → warning; Δ ≥ `criticalDelta` → critical; recent spike (last > 0, prior = 0) → warning. |
| Unit | `assembleOnuDetailPoints` | `packages/analytics/tests/scheduler-helpers.test.ts` — 5th kind emitted on finite; absent on undefined. |
| Integration | FEC scheduler happy path | `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` — `persisted === 40` for 8 × 5; rest byte-identical. |
| Integration | `group.ts` switch arm | `packages/alerts/tests/group.test.ts` — `losSecondsTotal` lands in `SeriesByDevice.losSecondsTotal`. |
| E2E | none new | P2.1 E2E covers the loop; LOS is one more kind. |
| Eval gate | unchanged | No new attack surface; attack-pass-rate stays at 100%. |

## Threat Matrix

`N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary changed. Existing `mapAllSettled` + `fitsRateBudget` + `pickNumber` patterns remain; `detectLosEvents` is pure.`

## Migration / Rollout

One Prisma migration: `ALTER TYPE "MetricKind" ADD VALUE 'LOS_SECONDS_TOTAL'`. **No backfill** — historical data has no LOS rows; counter starts fresh. Feature gate: `FEC_COLLECTION_ENABLED` covers LOS. **No phased rollout.** Rollback app-only (PG forbids `DROP VALUE`; revert leaves enum unreferenced per spec REQ-9).

## Open Questions

None. SmartOLT field-name ambiguity closed by AD-3's 6-key `pickNumber` list (candidates from `exploration.md`); Approach A confirmed; detector thresholds (24 h, `minSamples: 3`, warning Δ ≥ 1 s, critical Δ ≥ 30 s) locked in the proposal.