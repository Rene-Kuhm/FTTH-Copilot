# Tasks: P2.2 Optical Metrics — LOS Collection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~300 LOC across ~10 files |
| 400-line budget risk | Low |
| Chained PRs recommended | Yes (helpers-slice + detector-slice) |
| Suggested split | PR #1 helpers-slice (Prisma migration + OnuSummary + assemble extension + fixture + analytics/alerts types reconciliation); PR #2 detector-slice (detectLosEvents + alert wiring + tests) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Ship LOS MetricKind + OnuSummary field + assemble + types reconciliation, no detector | PR #1 helpers-slice | `pnpm --filter apps/web test -- fec-scheduler.test.ts` + `pnpm --filter packages/analytics test -- scheduler-helpers.test.ts` | `FEC_COLLECTION_ENABLED=true node apps/web dev` | Revert PR #1, leave no LOS field anywhere |
| 2 | Ship detectLosEvents + alert wiring | PR #2 detector-slice | `pnpm --filter packages/detection test -- los.test.ts` + `pnpm --filter packages/alerts test -- runner.test.ts` | Same as PR #1 (no new env) | Remove detector file, revert `runDetectors` call |

## Phase 1: Foundation (helpers-slice PR #1)

- [x] 1.1 Add `LOS_SECONDS_TOTAL` to `packages/db/prisma/schema.prisma` and create the migration with `pnpm prisma migrate dev --name add_los_metric_kind`.
- [x] 1.2 Add `losSecondsTotal?: number` to `OnuSummary` in `packages/connectors/core/src/index.ts`.
- [x] 1.3 Extend `pickNumber` in `packages/connectors/smartolt/src/client.ts:245-252` with `los_seconds_total`, `los_seconds`, `losCount`, `los_count`, `loss_of_signal_seconds`, and `signal_loss_seconds`.
- [x] 1.4 Extend `assembleOnuDetailPoints` in `packages/analytics/src/scheduler-helpers.ts` with `maybePush('LOS_SECONDS_TOTAL', detail.losSecondsTotal)`.
- [x] 1.5 Reconcile `TRAFFIC_THROUGHPUT_MBPS` in `packages/analytics/src/types.ts` and `packages/alerts/src/types.ts`.
- [x] 1.6 Extend `packages/alerts/src/group.ts` with the `LOS_SECONDS_TOTAL` arm and add `losSecondsTotal: Array<{ t: number; v: number }>` to `SeriesByDevice`.
- [x] 1.7 Update `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` path to assert `persisted === 40` (8 ONUs × 5 kinds) with LOS details.
- [x] 1.8 Update `packages/analytics/tests/scheduler-helpers.test.ts` to assert finite LOS emission and undefined omission.
- [x] 1.9 Extend 2 of 5 `FIXTURE_ONU_DETAILS` in `packages/connectors/smartolt/src/fixtures.ts` with `losSecondsTotal` values.
- [x] 1.10 Update `docs/architecture.md:264` FEC paragraph to mention the fifth kind.

## Phase 2: Detection (detector-slice PR #2)

- [x] 2.1 Create `packages/detection/src/los.ts` with `detectLosEvents`, mirroring `detectFecDegradation`: 24h window, minSamples 3, warning Δ≥1s, critical Δ≥30s.
- [x] 2.2 Re-export `detectLosEvents` from `packages/detection/src/index.ts`.
- [x] 2.3 Create `packages/detection/tests/los.test.ts` with six cases: empty, <minSamples, equal samples, Δ≥1s warning, Δ≥30s critical, and recent spike.
- [x] 2.4 Wire `detectLosEvents` into `packages/alerts/src/runner.ts:35-36` after `detectOpticalDegradation`.
- [x] 2.5 Extend detector matrix in `packages/alerts/tests/runner.test.ts`.

## Phase 3: Verification (PR #2, after merge)

- [ ] 3.1 Run full CI: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.
- [ ] 3.2 Verify Eval Gate attack-pass-rate == 100%.
- [ ] 3.3 Verify Integration Tests (Postgres) pass.

## Phase 4: Archive (post-verify)

- [ ] 4.1 Promote `openspec/changes/p2-2-optical-metrics/specs/los-collection/spec.md` to `openspec/specs/los-collection/spec.md`.
- [ ] 4.2 Mark P2.2 as shipped in `docs/roadmap-integraciones-pendientes.md`.
- [ ] 4.3 Run the `sdd-archive` phase to fold the change into canonical state.
