# Proposal: p2-2-optical-metrics — Loss-of-Signal per ONT

## Intent

P2.1 (`bc58e2d`) persists `BIAS_CURRENT_MA`/`ONT_TEMPERATURE_CELSIUS`; the 15-min poller covers `RX/TX_POWER_DBM`. **Gap: `LOS`** — per-ONU monotonic counter distinguishing "ONU lost optical signal (fiber cut)" from "ONU went offline (link/power down)". Ship `LOS_SECONDS_TOTAL` + `detectLosEvents`, mirroring `detectFecDegradation`, reusing the FEC scheduler fan-out.

## Scope

**In**: `LOS_SECONDS_TOTAL` enum member (Prisma migration); `losSecondsTotal?: number` on `OnuSummary`/`OnuDetail`; SmartOLT `pickNumber` candidates `['los_seconds_total','los_seconds','losCount','los_count','loss_of_signal_seconds','signal_loss_seconds']`; 1-line `assembleOnuDetailPoints` extension; new `detectLosEvents` (~50 LOC + tests); `runDetectors` + `group.ts` arm + `SeriesByDevice.losSecondsTotal`; reconcile `TRAFFIC_THROUGHPUT_MBPS` gap in analytics+alerts; 2–3 SmartOLT fixtures.

**Out**: SNMP/gNMI (P2.4). NetSense (P2.5). Mikrowisp change. New `AlertKind` — reuse `optical_degradation`. Scheduler edits. Dashboard UI.

## Capabilities

**New**: `los-collection` — per-ONU LOS counter collection + detection. Spec at `openspec/changes/p2-2-optical-metrics/specs/los-collection/spec.md`; mirrors `openspec/specs/fec-collection/spec.md`.

**Modified**: None at spec level. `TRAFFIC_THROUGHPUT_MBPS` reconciliation is a TS union fix.

## Approach

Add `LOS_SECONDS_TOTAL` via Prisma migration. `OnuSummary.losSecondsTotal` becomes optional monotonic counter. SmartOLT maps via 6-key `pickNumber`. `assembleOnuDetailPoints` emits as 1-line addition; FEC scheduler fans to `persistSamples` unchanged. `detectLosEvents` mirrors `detectFecDegradation`: window 24 h, `minSamples: 3`, warning at Δ ≥ 1 s, critical at Δ ≥ 30 s. Reuses `optical_degradation` AlertKind. Mikrowisp degrades gracefully. Delivery: `auto-chain` via `stacked-to-main` → PR #1 helpers-slice (~150 LOC), PR #2 detector-slice (~150 LOC).

## Affected Areas

`packages/db/prisma/schema.prisma` + new `migrations/<ts>_add_los_metric_kind/migration.sql`. `packages/connectors/core/src/index.ts`. `packages/connectors/smartolt/src/{client,fixtures}.ts`. `packages/analytics/src/{scheduler-helpers,types}.ts`. `packages/alerts/src/{types,group,runner}.ts`. `packages/detection/src/{los,index}.ts` + new `tests/los.test.ts` (~50 LOC + ≥6 cases). Tests: `packages/{analytics,alerts}/tests/**` + `apps/web/tests/lib/monitoring/fec-scheduler.test.ts`. Docs: `docs/architecture.md`, `docs/roadmap-integraciones-pendientes.md` §P2.2.

## Risks

| Risk | Like | Mitigation |
|------|------|------------|
| SmartOLT field name uncertain | Low | 6-key `pickNumber`; unresolved → undefined → no finding. |
| First `ALTER TYPE MetricKind ADD VALUE` since P2.1; concurrent migrations collide | Low | Helpers-slice PR #1 ships migration first; PG serializes. |
| `detectFlapping` overlap | Low | `correlateAlerts` merges same-device findings. |
| Work unit > 400 LOC | Low | `stacked-to-main` splits helpers-slice + detector-slice (~150 LOC each). |
| Vendor ships LOS as flag not counter | Low | Detector expects monotonic; flag → undefined → no finding. |

## Rollback Plan

1. Revert chained PRs — removes field, assemble extension, detector, alert wiring.
2. Leave Postgres enum value unreferenced (PG can't `DROP VALUE`); optional follow-up new enum + `ALTER COLUMN … TYPE`.
3. If migration never ran on prod, remove the file. Once deployed, keep it (idempotent on `prisma migrate deploy`).
4. Revert fixtures and docs (§P2.2 back to 🔵).

## Success Criteria

`LOS_SECONDS_TOTAL` rows per ONU every FEC tick (8 × 5 = 40). `detectLosEvents` ≥6 RED→GREEN cases (empty, sub-minSamples, Δ-warning, Δ-critical, recent-spike, stable-zero). Mikrowisp graceful-degrade: no rows, no errors, no findings. CI green on all 14 checks for both chained PRs. Eval Gate attack-pass-rate == 100% on SOC harness. No P2.1 regression.
