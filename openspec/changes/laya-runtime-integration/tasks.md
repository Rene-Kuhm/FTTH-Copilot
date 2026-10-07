# Laya Runtime Integration — Tasks

**Change**: `laya-runtime-integration`
**Date**: 2026-10-07
**Strict TDD**: true

Each task is sized to close in one session and MUST land as a work-unit commit with its tests.
Evidence for a closed task is a command whose output is not a Turbo cache `HIT`.

---

## Phase 1 — Single configuration truth (R1) — DONE

- [x] **1.1** Add one exported resolver for `LAYA_ENABLED` / `LAYA_MODE` / `LAYA_FAIL_OPEN` in
  `packages/shared/src/laya-shadow.ts`, applying AD-2: `enabled = LAYA_ENABLED === 'true'`,
  `mode = LAYA_MODE ?? 'shadow'`, `failOpen = LAYA_FAIL_OPEN !== 'false'`.
  → `resolveLayaEnv()` added.
- [x] **1.2** Make `getLayaConfig()` (`laya-shadow.ts:184-200`) and
  `loadLayaConfigFromEnv()` (`laya-client.ts:45-60`) delegate to the single resolver; remove both
  local defaulting expressions. → verified no import cycle: `laya-expert-system ← laya-shadow ←
  laya-client` is a strict DAG.
- [x] **1.3** RED→GREEN: test asserting both loaders resolve identically for the same environment,
  and that an empty environment resolves to `enabled=false`.
  → `packages/shared/tests/laya-config.test.ts` (10 tests).
- [x] **1.4** Verify `packages/shared` tests pass; run
  `pnpm --filter @ftth-copilot/shared test --force`-equivalent through Turbo.
  → `11 test files, 308 passed`, `Cached: 0 cached, 1 total`.

## Phase 2 — Close the circuit (R2, R3) — DONE (the user-visible fix)

- [x] **2.1** RED: test in `packages/agent-core/tests/` asserting that routing a query while Laya
  is enabled records exactly one decision into `layaMetrics`, and that `planRoute` alone records
  nothing. This test MUST fail before 2.2.
  → RED observed: `AssertionError: expected +0 to be 1`, `expected +0 to be 2`,
  `expected 0 to be greater than 0`.
- [x] **2.2** GREEN: record at the `planRoute` call site in
  `packages/agent-core/src/runtime.ts:317`, gated on the Phase 1 resolver. Do NOT touch
  `planRoute` (AD-1). Record `mode` as the resolved Laya mode (R2.4).
- [x] **2.3** Record `result='error'` when `route.eventClass === undefined` (AD-4).
- [x] **2.4** Add a guard test proving exactly-once recording per `runAgent` call (design's
  double-count trap). → `calling runAgent twice records exactly two decisions`.
- [x] **2.5** Verify end-to-end that `GET /api/metrics` emits at least one
  `ftth_laya_requests_total{...}` sample line with `LAYA_ENABLED=true`, and none with it unset.
  → Verified at the format layer (`toPrometheusFormat()`), NOT against a live Next.js server:
  5 real sample lines emitted. A live `GET /api/metrics` was NOT exercised (no server/Docker);
  `prometheus.ts:313` calls the identical function, but this is an inference, not a measurement.
- [x] **2.6** Confirm the existing dashboard parser (`LayaMetricsPanel.tsx:39`) matches the emitted
  samples unchanged. → The parser matched NOTHING before this change (see 2.7).

### Tasks that emerged during Phase 2

- [x] **2.7** Fix the label-key mismatch that would have made the dashboard show `unknown` for
  every row. `recordDecision` stored camelCase keys (`eventClass`) and `toPrometheusFormat()`
  emitted them verbatim, while `LayaMetricsPanel.tsx:46` parses `/event_class="([^"]+)"/`
  (snake_case) and its comment at `:37` documents snake_case. The file's own `confidence` family
  already hardcoded `event_class`, so only `requests` was wrong. Emitter now emits
  `event_class` / `suggested_route`; internal `getSummary()` keys unchanged.
  Evidence: `ftth_laya_requests_total{event_class="OPTICAL_FAULT",mode="shadow",result="success"} 1`
- [x] **2.8** Repair `packages/shared/tests/laya-client.test.ts`, which still asserted the
  pre-AD-2 default `mode === 'disabled'` and left `packages/shared` RED.
  → assertion updated to the designed contract (`mode === 'shadow'`).

### Verification defects caught during review

- [x] **2.9 (open)** A test was initially written as a tautology: it called
  `layaMetrics.recordDecision('UNKNOWN', 0, 'shadow', 'error')` by hand and then asserted that
  `result='error'` was stored, while its comment claimed the runtime wiring was covered
  elsewhere. It was replaced by `packages/agent-core/tests/laya-classifier-failure.test.ts`,
  which drives the failure through the real `runAgent` and includes a negative check proving the
  mock is effective. Proof the replacement can fail: `expected undefined to be 'SOME_CLASS'`.
  **Process note**: the first writer edited `packages/shared/tests/laya-shadow.test.ts`, which was
  outside its declared surfaces. The edit was substantively correct, but the surface breach is
  recorded here so the next delegation widens surfaces for the test files it will disturb.

## Phase 3 — Exports and the blocking collision (R5) — DONE

- [x] **3.1** Rename the colliding `recordLayaDecision` in
  `packages/shared/src/laya-client.ts:240` to a distinct identifier and update its call sites
  (`:468`, `:485`, `:521`, `:537`, `:560`) and `packages/shared/tests/laya-client.test.ts`.
  Required before 3.2: two `export *` of the same name is an ambiguity error.
  → renamed to `recordLayaCallOutcome`.
- [x] **3.2** Export the Laya client and integration modules from
  `packages/shared/src/index.ts`. → two `export *` added (not a narrowed list).
- [x] **3.3** Verify `tsc --noEmit` passes across `packages/shared` and every consumer, proving no
  ambiguous re-export. → 17/17, `0 cached`.
- [x] **3.4** Extend the existing export-surface test to pin the newly public Laya symbols.
  → 10 assertions added to `index-exports.test.ts`.

**Collision audit result**: only ONE real collision existed, not the several predicted.
`laya-integration.ts` declared a `LayaDecision` interface identical to the one in `laya-shadow.ts`
that it already imported, so the duplicate was removed rather than renamed. `LayaMetrics` did not
collide. Verified independently that `index.ts` gained star exports and no previously public
symbol lost its name.

## Phase 4 — Make the modes real (R4) — DONE

- [x] **4.1** Wire `getLayaIntegration()` / `mergeRoutingDecision` at the orchestration call site,
  gated by the resolved mode. → signal is passed INTO `planRoute`, not applied post-hoc (AD-6).
- [x] **4.2** Implement the mode matrix of AD-3: `disabled` bypass, `shadow` record-only,
  `assisted` threshold-gated influence, `automatic` direct influence.
- [x] **4.3** Implement fail-open and fail-closed behavior per `failOpen` (R4.5, R4.6).
- [x] **4.4** RED→GREEN tests for all four modes, including unreachable-service degradation.
  → `packages/agent-core/tests/laya-modes.test.ts`, 23 tests; agent-core now 16 files / 293 tests.

### Design decision added during Phase 4

- Design AD-6 and AD-7 were added to `design.md` before implementation. **AD-6** is the reason the
  signal became an input: overriding `route.mode` after `planRoute` returns leaves `tools` and
  `maxIterations` derived from the previous mode, so a route promoted to `investigation` keeps
  `maxIterations: 0` and the cognitive loop never runs. The test file asserts the final mode's
  `tools`/`maxIterations` are consistent, and includes a demonstration that the post-hoc variant
  produces the stale values.

### Review note (checked and dismissed)

I suspected the `assisted` path was inconsistent: it calls `mergeRoutingDecision` to respect the
thresholds, then re-calls `planRoute({ layaSignal })` which applies the signal's raw
`suggestedRoute`, apparently ignoring those thresholds. Reading `mergeRoutingDecision` settles it:
its only non-adaptive returns are `'direct'` when `suggestedRoute === 'DIRECT'` and
`'investigation'` when `suggestedRoute === 'INVESTIGATION'`, so whenever it decides to differ, the
raw mapping produces exactly the same mode. Self-consistent, not a defect. Recorded so nobody
re-derives it.

## Phase 5 — Observability and cache correctness (R6)

- [x] **5.1** Consume the boolean returned by `circuitBreaker.recordFailure()` at
  `laya-client.ts:502`, `:533`, `:582`; emit a log and/or metric when the breaker transitions to
  open.
- [x] **5.2** Validate inbound Laya responses with `layaDecisionSchema`; on failure follow
  `failOpen` instead of returning a synthesized `UNKNOWN` decision (AD-5).
- [x] **5.3** Declare every `LAYA_*` variable in `turbo.json` `globalEnv`.
- [x] **5.4** Resolve the unused-import lint warnings this leaves behind in the touched files.
- [x] **5.5** Remove the duplicated confidence-threshold defaulting found during the Phase 4
  review. `packages/shared/src/laya-client.ts:57-60` and
  `packages/agent-core/src/runtime.ts:388-389` each resolve `LAYA_CONFIDENCE_THRESHOLD_HIGH` and
  `LAY_CONFIDENCE_THRESHOLD_LOW` with identical `0.95`/`0.75` fallbacks. This is the same class of
  defect as D1 (two truths for one configuration) that Phase 1 eliminated; the values agree today,
  so it is a divergence risk rather than a live bug. Expose the resolved thresholds from the
  single config resolver and have the runtime consume them.

## Phase 6 — Deployment surfaces and documentation truth (R7)

- [x] **6.1** Add the `laya` service to `docker-compose.demo.yml` and
  `docker-compose.prod.yml`, and pass the `LAYA_*` variables to the application service.
- [x] **6.2** De-duplicate `.env.example`'s two Laya blocks (currently `:196-242` and `:244-282`)
  and correct the `LAYA_URL` example port from `8000` to `8080`.
- [x] **6.3** Update `docs/engineering/ADR-042-laya-decision-layer.md` and the README's Laya claims
  to the state verification actually established — including removing the stray `满意` in
  `README.md:453`.
- [x] **6.4** Record the final evidence in `odd/tasks/laya-runtime-integration.md`.

## Phase 7 — Gates

- [x] **7.1** `pnpm exec turbo run typecheck --force` → 17/17, `0 cached`.
- [x] **7.2** `pnpm exec turbo run lint --force` → 17/17, `0 cached`.
- [x] **7.3** `pnpm exec turbo run test --force` → 17/17, `0 cached`.
- [x] **7.4** `pnpm exec turbo run build --force` → web build produces a fresh `BUILD_ID`.
- [x] **7.5** `pnpm check:sources` and `pnpm check:contribution` pass.
- [x] **7.6** Confirm CI's `test:e2e` and `test-integration` jobs are unaffected by the changed
  surfaces, or state explicitly that they were not run locally.
