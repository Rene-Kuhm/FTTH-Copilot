# Tasks: P2.1 FEC Collection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~470 (incl. tests + docs) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes (helpers-slice + scheduler-slice) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |
| Rollback | `FEC_COLLECTION_ENABLED=false` (kill switch) or revert PR |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Orchestrator must prompt the user (ask-on-risk): split into chained PRs OR accept size:exception before launching sdd-apply.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Rollback |
|------|------|-----------|----------------------|----------|
| 1 | Pure helpers + re-export + helper tests | PR 1 | `pnpm --filter @ftth-copilot/analytics test scheduler-helpers` | Revert PR 1; export inert when loop off |
| 2 | Scheduler loop + boot + scheduler tests + docs | PR 2 | `pnpm --filter @ftth-copilot/web test fec-scheduler` | `FEC_COLLECTION_ENABLED=false` |

## Phase 1 — Pure helpers (RED→GREEN→REFACTOR, `packages/analytics`)

- [ ] 1.1 RED: `packages/analytics/tests/scheduler-helpers.test.ts` — slice: empty/`=length`/`0`/`1`, two consecutive disjoint, frozen input unchanged; budget: under/at/over, `perCycle=0`, invalid `intervalMs`; assemble: one point per finite field, Mikrowisp zero points; mapAllSettled: order preserved, rejections swallowed. Tests MUST fail.
- [ ] 1.2 GREEN: `packages/analytics/src/scheduler-helpers.ts` — four pure helpers with JSDoc.
- [ ] 1.3 RE-EXPORT: extend `packages/analytics/src/index.ts` with the four helpers.
- [ ] 1.4 REFACTOR: collapse `assembleOnuDetailPoints` field guards into a table-driven loop; helper tests green.

## Phase 2 — Scheduler loop integration (RED→GREEN→REFACTOR, `apps/web`)

- [ ] 2.1 RED: `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` — env unset no tick; enabled + default emits log shape `{tenantId, connectionId, requested, persisted, skipped, durationMs}`; rate-limit skip emits `reason:'rate_limit'` with zero `getOnuDetail`; connector throw doesn't abort loop; Mikrowisp persists zero rows; `sliceSize>=length` returns full slice.
- [ ] 2.2 GREEN: `apps/web/lib/monitoring/scheduler.ts` — add `runScheduledFecCollection()` (per connection: buildConnector, `listOnus`, slice, `fitsRateBudget`, inline `mapAllSettled` @4, assemble, persistSamples, structured logs) and `startFecCollectionLoop()` mirroring `startFirmwareAuditLoop()`. Existing loops byte-identical.
- [ ] 2.3 BOOT: add `startFecCollectionLoop();` in `apps/web/instrumentation.ts` after `startFirmwareAuditLoop();`.
- [ ] 2.4 REFACTOR: tighten log shapes to REQ-6; no token/cookie/`Authorization` logged; scheduler tests green.

## Phase 3 — Documentation delta

- [ ] 3.1 `docs/roadmap-integraciones-pendientes.md` — flip §P2.1 to ✅ shipped; list `FEC_COLLECTION_ENABLED`, `FEC_COLLECTION_INTERVAL_MS`, `FEC_FAN_OUT_PER_CYCLE`, `FEC_RATE_LIMIT_PER_HOUR` + kill switch.
- [ ] 3.2 (only if 1.4 surfaces follow-up) note FEC wiring in `docs/aiops-roadmap.md`.

## Phase 4 — Verification gate

- [ ] 4.1 `pnpm exec turbo run test` — green.
- [ ] 4.2 `pnpm exec turbo run typecheck` — green.
- [ ] 4.3 `pnpm exec turbo run lint` — green.

## Test Plan Summary

| Scenario | Task |
|---|---|
| REQ-1 default-disabled env produces no loop | 2.1 |
| REQ-1 enabled ⇒ three independent loops | 2.2, 2.3 |
| REQ-2 disjoint slices, no mutation | 1.1, 1.2 |
| REQ-2 slice ≥ input ⇒ full input | 1.1, 1.2 |
| REQ-3 default cadence + slice passes | 1.1, 1.2, 2.1 |
| REQ-3 oversized fan-out skips, one log line | 2.1, 2.2 |
| REQ-4 SmartOLT persists up to four kinds | 1.1, 1.2, 2.1, 2.2 |
| REQ-4 Mikrowisp persists zero rows | 1.1, 1.2, 2.1, 2.2 |
| REQ-4 non-finite skipped; no detector | 1.1, 1.2, 2.2 |
| REQ-5 kill switch leaves in-flight tick alone | 2.1, 2.2 |
| REQ-5 partial failure and thrown tick recover | 2.1, 2.2 |
| REQ-6 normal tick log shape | 2.1, 2.2, 2.4 |
| REQ-6 skipped shape, no secret leakage | 2.1, 2.2, 2.4 |

## Work-unit Commit Plan

- Phase 1: `test(analytics): add failing scheduler-helper tests (RED)` + `feat(analytics): add scheduler-helpers (GREEN)`; optional refactor.
- Phase 2: `test(web): add failing fec-scheduler tests (RED)` + `feat(web): add fec collection loop (GREEN)` + `chore(web): boot fec collection loop (BOOT)`; optional refactor.
- Phase 3: `docs(roadmap): mark P2.1 shipped`.
- Phase 4: verification only — no commits.

## Out-of-scope reminders (do NOT do)

No Prisma migration. No detection logic change. No Mikrowisp FEC. No SNMP/gNMI. No dashboard UI. No edits to `packages/monitoring/src/poll.ts`, `collectSamples`, `CollectOptions`, `runScheduledPoll`, `runScheduledFirmwareAudit`, `packages/analytics/src/collect.ts`, or `packages/analytics/src/types.ts`.
