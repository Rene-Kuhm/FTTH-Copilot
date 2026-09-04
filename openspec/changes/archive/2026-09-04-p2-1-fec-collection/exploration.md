# Exploration — p2-1-fec-collection

> **Roadmap link:** `docs/roadmap-integraciones-pendientes.md` §P2.1 —
> "Recolectar FEC errors (BIP-8) — capturar codewords FEC corregidos/no
> corregidos por ONT" (the best early indicator of a degrading optical
> fiber). The roadmap notes the dependency: "confirmar que SmartOLT/Mikrowisp
> expongan los contadores FEC. Si no, sale por SNMP/gNMI".
>
> **Scope of this exploration:** verify the current end-to-end FEC data path,
> confirm the rate-limit / cadence problem the orchestrator flagged, validate
> the gap on the Mikrowisp connector, and propose design options for the
> cadence of FEC+optical collection. This document does **not** propose
> implementation; that is `sdd-propose`.

## Current State

### What is already wired (verified)

The FEC pipeline is **structurally complete** end-to-end, but **runtime
inactive** at the SmartOLT metrics-poll layer. Every other piece is in
place: schema enum, ingestion points, group/detector wiring, alert
upsert/dedup/notify.

| Layer | File:lines | Status |
|---|---|---|
| Prisma `MetricKind` enum | `packages/db/prisma/schema.prisma:49–60` | ✅ `FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, `ONT_TEMPERATURE_CELSIUS` already declared. |
| Prisma `AlertKind` enum | `packages/db/prisma/schema.prisma:63–72` | ✅ `fec_degradation`, `optical_degradation` already declared. |
| Migration for new MetricKinds | `packages/db/prisma/migrations/20260830120000_add_fec_optical_metric_kinds/migration.sql` | ✅ Applied (4 `ALTER TYPE ... ADD VALUE`). |
| Migration for new AlertKinds | `packages/db/prisma/migrations/20260830130000_add_fec_optical_alert_kinds/migration.sql` | ✅ Applied (2 `ALTER TYPE ... ADD VALUE`). |
| Connector-core field surface | `packages/connectors/core/src/index.ts:28–31` | ✅ `OnuSummary.fecCorrected/fecUncorrected/biasCurrentMa/ontTemperatureCelsius` already optional. |
| SmartOLT bulk mapper | `packages/connectors/smartolt/src/client.ts:245–252` | ✅ `mapOnuSummary` already picks `fec_corrected`/`fec_uncorrected`/`bias_current`/`ont_temperature` from any of three naming variants — defensive against SmartOLT's history of field-name churn. |
| SmartOLT detail mapper | `packages/connectors/smartolt/src/client.ts:256–270` | ✅ `mapOnuDetail` overlays firmware + inherits the optical fields from the summary mapper. |
| SmartOLT fixtures (mock) | `packages/connectors/smartolt/src/fixtures.ts:605–731` | ✅ Five `FIXTURE_ONU_DETAILS` already carry realistic `fecCorrected`/`fecUncorrected`/`biasCurrentMa`/`ontTemperatureCelsius` — `Diego Sanchez (1/7/4)` carries a pre-failure state (`fecCorrected: 4820`, `fecUncorrected: 17`), `Martin Alvarez (1/8/1)` carries the warning state (980/2) used to test `detectFecDegradation` in scenario tests. |
| Analytics collect (writes MetricPoints) | `packages/analytics/src/collect.ts:149–160` | ✅ When `mergedOnus` has `fecCorrected/fecUncorrected/biasCurrentMa/ontTemperatureCelsius`, it emits `FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, `ONT_TEMPERATURE_CELSIUS` points. |
| Analytics collect (fan-out) | `packages/analytics/src/collect.ts:121–134` | ✅ `mapAllSettled` does a bounded-concurrency (4) fan-out to `getOnuDetail`, swallows per-ONU failures, falls back to summary values, and merges detail over summary via `mergeOnuDetail` (lines 22–31). |
| Analytics persist | `packages/analytics/src/ingest.ts:21–25` | ✅ `persistSamples` is `MetricKind`-agnostic — anything the collector emits is written via a `createMany`. No migration / no schema change needed for new MetricKinds. |
| Detection — FEC | `packages/detection/src/fec.ts:38–86` | ✅ `detectFecDegradation(deviceKind, deviceId, corrected, uncorrected, opts)`. Monotonic-counter delta over a window (default 24 h, `correctedDeltaThreshold=100`, `minSamples=3`); any uncorrected delta above 0 is **critical**; corrected delta above the threshold with ≥ 3 samples is **warning**. Counter reset → 0 delta. |
| Detection — optical | `packages/detection/src/optical.ts` (referenced from `packages/alerts/src/runner.ts:36`) | ✅ Companion to FEC, same pipeline. Out-of-scope for this change but useful to keep in mind. |
| Detection wiring | `packages/alerts/src/runner.ts:35` | ✅ `runDetectors` already calls `detectFecDegradation(s.deviceKind, s.deviceId, s.fecCorrected, s.fecUncorrected, …)`. |
| Alerts grouping | `packages/alerts/src/group.ts:52–66` | ✅ Switch case for `FEC_CORRECTED` / `FEC_UNCORRECTED` / `BIAS_CURRENT_MA` / `ONT_TEMPERATURE_CELSIUS` writes into the `SeriesByDevice` shape consumed by the detector. |
| Alerts detect → persist → notify → correlate | `packages/alerts/src/manager.ts:176–297` | ✅ `runDetection` reads `metricSample` rows from the last `lookbackMs` (default 14 days), groups, runs detectors, reconciles, upserts `detected_alert`, notifies via webhook/Telegram, and correlates into `Incident`. No change needed. |
| Scenario harness | `packages/analytics/src/scenario.ts:44–58` | ✅ `buildNocDegradationScenario` synthesizes a 12-point degradation scenario including FEC corrected (0 → 300) and uncorrected > 0 in the last third. Scenario test (`packages/analytics/tests/scenario.test.ts:66–72`) asserts the detectors fire `['fec_degradation', 'optical_degradation', 'predicted_low_signal']` end-to-end. |

### What is **not** wired (the gap)

1. **The runtime metrics poller does not pass `includeOnuDetail: true`.**
   `apps/web/lib/monitoring/scheduler.ts:56–64` calls `pollConnections` with
   `includeOltDetail: process.env['METRICS_SAMPLE_OLT_DETAIL'] === 'true'`
   only. `pollConnections → runPollCycle` (`packages/monitoring/src/poll.ts:56–59`)
   forwards `includeOltDetail` but **does not** forward an `includeOnuDetail`
   flag (it doesn't exist on `PollCycleOptions`). So at runtime
   `collectSamples` never enters the `getOnuDetail` fan-out branch
   (`packages/analytics/src/collect.ts:121`), and **no FEC/optical points are
   ever persisted** in a deployed environment. The detector runs over an
   empty `fecCorrected`/`fecUncorrected` series and always returns `null`.

2. **`PollCycleOptions` lacks an `includeOnuDetail` field.**
   `packages/monitoring/src/poll.ts:15–27` declares `includeOltDetail` and
   other detection knobs but no FEC toggle. Adding the field is the smallest
   structural change that would unlock FEC collection from the existing
   poller.

3. **The scheduler does not expose a separate, slower FEC-cadence knob.**
   `apps/web/lib/monitoring/scheduler.ts:107–121` runs a single
   `METRICS_POLL_INTERVAL_MS` loop (default 15 min). The firmware audit
   loop (`scheduler.ts:128–145`) is the precedent for a second, slower loop
   (`FIRMWARE_AUDIT_INTERVAL_MS`, default 24 h) — but there is no equivalent
   for FEC today.

4. **The architecture doc overstates the wiring.** `docs/architecture.md:264`
   says FEC/optical "ya no son demo", but the runtime poller never invokes
   the fan-out. The docs and the runtime are out of sync.

5. **`@ftth-copilot/analytics` `MetricKind` union is missing
   `TRAFFIC_THROUGHPUT_MBPS`.** `packages/analytics/src/types.ts:9–18`
   lists 8 of the 9 `Prisma.MetricKind` values. This is a pre-existing gap
   unrelated to FEC but worth noting because the FEC change is in the same
   file — touching `types.ts` to add an `includeOnuDetail?: boolean`
   addition to `CollectOptions` should also reconcile this (either by
   adding the missing enum member, or by leaving a `// see TRAFFIC_* on
   alerts/types.ts` cross-reference so the next AIOps phase doesn't trip
   on it). **Not a blocker for this change**, but a low-risk cleanup while
   the file is open.

### Connector state (per provider)

| Provider | Bulk exposes FEC? | Detail exposes FEC? | Notes |
|---|---|---|---|
| SmartOLT (`packages/connectors/smartolt/src/client.ts`) | Tries `fec_corrected` / `fecCorrected` / `corrected_fec` etc. defensively (`pickNumber`, line 245). Returns `undefined` if absent. | Same field mapper inherited via `mapOnuDetail` (line 256). Per-device endpoint expected to return these per the SmartOLT API doc comment at line 42. | Real SmartOLT bulk rarely carries FEC; the detail endpoint is the authoritative source. |
| Mikrowisp (`packages/connectors/mikrowisp/src/client.ts:246–260`) | `mapEquipoToOnu` returns **no** `rxPowerDbm`, **no** `txPowerDbm`, **no** `fec*`, **no** `biasCurrent*`, **no** `ontTemperature*`. Only `id`, `serial`, `oltId`, `customerName`, `status`. | Same — `getOnuDetail` calls `/GetMonitoreo` again and returns `mapEquipoToOnu`. No detail endpoint exposes optical telemetry in Mikrowisp's API as currently consumed. | **No FEC support today**. The collector's existing graceful-skip on `undefined` (`collect.ts:149–160` — only emits points when the field is non-undefined) means Mikrowisp simply produces no FEC points; the detector sees an empty series. No error, no crash. The roadmap explicitly notes that if Mikrowisp/SmartOLT don't expose FEC, "sale por SNMP/gNMI" — that is a separate work item (P2.4). |
| NetSense | Not implemented yet. Provider is in the enum (`packages/db/prisma/schema.prisma:24–28`) but no connector package exists (P2.5 in the roadmap). | n/a | Out of scope. |

## The rate-limit problem

**Constraint (verified):** SmartOLT is capped at **15 requests/hour** per
account (`packages/connectors/smartolt/src/client.ts:26`,
`SMARTOLT_RATE_LIMIT_PER_HOUR = 15`). This is a **per-account** quota, not
per-endpoint.

**Current per-cycle request count for SmartOLT:**
- `runScheduledPoll` calls `pollConnections → runPollCycle → collectSamples`.
- `collectSamples` (`packages/analytics/src/collect.ts:85–88`) calls
  `listOlts()` (1 req) + `listOnus()` (1 req) in parallel — these are the
  **only** mandatory requests per cycle.
- **With `includeOltDetail: true`** (off by default; opt-in via
  `METRICS_SAMPLE_OLT_DETAIL=true`): one additional `getOltDetail()` per OLT.
  With 5 OLTs → +5 req/cycle.
- **With `includeOnuDetail: true`** (currently never passed from the runtime
  scheduler): one additional `getOnuDetail()` per ONU. With 42 ONUs (mock
  fixture scale) → +42 req/cycle.

**At 15-minute cadence (the default), the per-ONU fan-out is impossible:**

| Fan-out | Req per cycle | Cycles per hour | Req per hour | Headroom vs 15 req/h |
|---|---|---|---|---|
| None (today) | 2 | 4 | 8 | OK |
| `includeOltDetail` only | 2 + 5 = 7 | 4 | 28 | **Already over budget** (this is why it's off by default) |
| `includeOnuDetail` only | 2 + 42 = 44 | 4 | 176 | **11.7× over budget** |
| Both | 2 + 5 + 42 = 49 | 4 | 196 | **13× over budget** |

So **the 15-minute cadence is fundamentally incompatible with per-ONU
fan-out**. This is the central design tension.

**Existing precedent: the firmware audit loop.** `apps/web/lib/monitoring/scheduler.ts:73–101`
runs `runFirmwareAudit` on a **24-hour cadence** (default), explicitly with
`includeOnuDetail: true` (line 90). The audit is a separate concern from
the metrics poller and tolerates the request cost because firmware changes
infrequently — once-a-day is fine. The SOC module reuses the same
fan-out primitive (`packages/soc/src/run.ts:187–204` — `mapWithConcurrency`,
fallback to serial, swallow errors).

**The FEC problem is different.** FEC counters are **monotonically
increasing** — they only matter as **deltas over a window**. The detector
uses a 24 h window (`packages/detection/src/fec.ts:46`). That means a 24 h
cadence would technically satisfy the detector, but a daily sample makes
"the corrected delta over the window" degenerate to "the counter advanced
in 24 h" — which still works, but **loses resolution**. Operators typically
want 1–6 h cadence so they can spot a slope change early.

**Constraint summary:** SmartOLT rate limit + monotonic-counter telemetry →
FEC collection needs its own cadence knob, decoupled from the 15-min
metrics poller. The firmware audit (24 h) is the wrong precedent for the
**cadence** (right for rate budget, wrong for detector resolution); the
right cadence is **between 1 h and 6 h**, which means the rate budget is
the binding constraint (1 cycle/h × 1 OLT fan-out + bulk ≈ 7 req/cycle,
× 1 = 7 req/h — leaves 8 req/h headroom for the metrics poller and other
operational traffic).

## Affected Areas

- `packages/analytics/src/types.ts` — `CollectOptions` to expose
  `includeOnuDetail` (already in types, but only consumed by `collect.ts`).
  Consider also fixing the pre-existing `TRAFFIC_THROUGHPUT_MBPS` omission
  in the union (see Current State §5).
- `packages/analytics/src/collect.ts` — no behavior change; already
  handles `includeOnuDetail: true` and the `mergeOnuDetail` overlay (lines
  22–31, 121–134, 149–160).
- `packages/monitoring/src/poll.ts` — add `includeOnuDetail?: boolean` to
  `PollCycleOptions` (line 15–27) and forward it into `collectSamples`
  (line 56–59). Minimal structural change.
- `apps/web/lib/monitoring/scheduler.ts` — three sub-decisions:
  1. Add a `startFecCollectionLoop()` (parallel to
     `startFirmwareAuditLoop()`, line 128–145) so FEC has its own cadence
     knob (`FEC_INTERVAL_MS` / `FEC_AUDIT_INTERVAL_MS`, default e.g. 1 h
     or 6 h), its own `FEC_COLLECTION_ENABLED` env gate, and its own
     `includeOnuDetail: true` flag (hardcoded for that loop). Reasoning:
     a separate loop keeps the metrics poller's existing budget
     unchanged (a backward-compatible default), and isolates FEC's
     rate-budget cost on its own knob.
  2. Boot the new loop in `apps/web/instrumentation.ts` (line 10–14,
     alongside `startPollingLoop()` and `startFirmwareAuditLoop()`).
  3. Decide whether to **also** wire a (default-off) `METRICS_SAMPLE_ONU_DETAIL`
     knob that forces the main poller to fan out, for environments with
     a higher rate limit. Not required by P2.1; nice to have if a
     deployment can afford it.
- `apps/web/lib/monitoring/scheduler.ts` — also touch the existing
  architecture-doc inconsistency by either adding the FEC loop comment in
  the same shape as the firmware audit comment (lines 122–127), or
  leaving a TODO cross-reference.
- `docs/architecture.md:264` — **no change required for the change itself**;
  the statement that FEC "ya no son demo" will become accurate once the
  FEC loop ships. Worth noting as a follow-up doc touch-up.
- `docs/architecture.md:256` (gap #1) — currently lists "Tráfico
  (throughput) sin datos" as a runtime gap; FEC is the parallel gap.
  Optional: add a §13 "Gaps still open after P2.1" line for any remaining
  items, or update this gap list to remove FEC once shipped.
- `packages/connectors/mikrowisp/src/client.ts:246–260` — **no change
  required**. The collector's existing graceful skip on undefined
  (`collect.ts:149–160`) means Mikrowisp connections simply produce no
  FEC points; the detector sees an empty series and returns `null`. **This
  is the correct degraded behavior** — it must NOT throw, because that
  would block detection on the connections that *do* have FEC data.
- `packages/db/prisma/migrations/` — **no new migration**. Enum values
  already migrated on `20260830120000` and `20260830130000`.
- `packages/db/prisma/schema.prisma` — **no schema change**.
- `packages/analytics/tests/collect.test.ts` — **existing tests already
  cover** the fan-out path (line 224 `fans out to getOnuDetail when
  includeOnuDetail is true, overlaying FEC/óptica`). New tests may want
  to add: (a) FEC points are **absent** for a Mikrowisp-style connector
  that returns no `fec*` fields (graceful-skip contract).
- `packages/monitoring/tests/poll.test.ts` — needs at least one new test:
  `runPollCycle` forwards `includeOnuDetail: true` from
  `PollCycleOptions` to `collectSamples`. This is the only test that
  gates the wiring in `poll.ts`.
- `apps/web` — no new test infrastructure needed unless the
  scheduler-level integration test exists; the package's `apps/web/tests/`
  directory doesn't appear to cover `scheduler.ts` today (it tests API
  routes). **Optional**: add a scheduler-level test that verifies the
  FEC loop boots when `FEC_COLLECTION_ENABLED=true` and skips otherwise.

## Approaches

### Approach A — Separate FEC collection loop (recommended)

Add a third scheduler loop `startFecCollectionLoop()` that runs on its own
cadence (e.g. `FEC_INTERVAL_MS`, default **1 h**), hardcodes
`includeOnuDetail: true`, and runs the same `pollConnections →
runPollCycle → collectSamples → persistSamples → runDetection` pipeline
that the metrics poller runs today. Boot it from `instrumentation.ts`.
Operators opt in with `FEC_COLLECTION_ENABLED=true`.

- **Pros:**
  - **Decouples FEC rate-budget from the 15-min metrics poller.** The
    metrics poller's existing budget stays intact; no risk of breaking
    other deployments.
  - **Mirrors the firmware audit pattern** (separate loop, separate env
    gate, separate cadence). Cognitive load is low for the operator —
    three knobs (`METRICS_POLL_*`, `FIRMWARE_AUDIT_*`, `FEC_*`).
  - **Cadence is right-sized for the detector.** A 1-h cadence gives the
    detector up to 24 samples per 24-h window (well above the
    `minSamples: 3` floor in `fec.ts:47`); a 6-h cadence still gives 4
    samples — enough for the warning path.
  - **No new connector code.** The plumbing already exists; the change
    is a 30-line scheduler addition plus the env wiring.
  - **Mikrowisp graceful-degrade is automatic** (no `fec*` fields →
    collector skips the points → detector sees empty series → no alert).
- **Cons:**
  - **Three loops is more operator surface area.** Mitigated by the
    `*_ENABLED=false` default.
  - **Adds a third cadence knob.** Acceptable; the firmware audit
    precedent already shows the pattern.
  - **Cadence / rate-budget interaction needs care.** Even at 1 h the
    per-cycle fan-out is ~44 req (1 listOlts + 1 listOnus + 42 getOnuDetail
    on the mock scale); at 1 cycle/h that's 44 req/h, **3× over** the
    15 req/h budget. So the **default cadence must be either ≥ 4 h** for
    a 42-ONU deployment, **or** the fan-out must be staggered (see
    Approach A.1 below).
- **Effort:** Low–Medium. Mostly scheduler glue + tests.

#### Approach A.1 — Staggered fan-out within the loop

Within a single FEC loop iteration, only fan out to **N ONUs per cycle**
(rotated deterministically by device-id hash) so the per-cycle request
count stays bounded. Over time, every ONU is visited; the per-ONU cadence
becomes `ONU_count / fan_out_per_cycle × loop_interval`, which for a
42-ONU tenant at 8 ONUs/cycle and 1-h loop = 5.25 h per ONU. Detector
window (24 h) still has ≥ 4 samples per ONU.

- **Pros:** Keeps the 15 req/h budget intact even on 42+ ONU tenants at
  1-h loop cadence. Detection still works.
- **Cons:** A little more code (rotation hash + slice), and per-ONU
  cadence is `ONU_count / fan_out_per_cycle × loop_interval` — slightly
  irregular but acceptable for a counter-delta detector.
- **Effort:** Medium.

### Approach B — Run-once-per-hour enrichment inside the main poller

When `METRICS_SAMPLE_ONU_DETAIL=true`, the existing 15-min metrics
poller fans out to **only N ONUs per cycle** (staggered rotation), so
over the hour every ONU is visited. `includeOltDetail`/`includeOnuDetail`
become a single knob with a sub-strategy. No new scheduler loop.

- **Pros:** One loop, one cadence knob. Fewer env variables.
- **Cons:** **Breaks the principle "frequent polls stay cheap"** that
  the current `METRICS_SAMPLE_OLT_DETAIL` knob preserves. The rate-limit
  math now lives inside the poller and couples two concerns (signal
  sampling + FEC enrichment). Operators lose the ability to scale the
  FEC cadence independently of the signal cadence.
- **Effort:** Medium–High (more invasive than Approach A).

### Approach C — Cache the detail payload in DB, refresh on a separate cadence

`getOnuDetail` results get cached in a new table (`OnuDetailCache`,
TTL-driven) and the collector reads from the cache during the 15-min
poller. A separate slower loop refreshes the cache. The 15-min poller
stays bulk-only at the network layer.

- **Pros:** Decouples **NMS request rate** from **metrics sample rate**
  cleanly. Even more future-proof (could later add traffic or other
  per-ONU fields without re-plumbing).
- **Cons:** New table, new migration, new lifecycle (TTL, refresh
  failure handling). More code than the problem requires at this stage.
- **Effort:** High. **Out of proportion to a P2.1 deliverable.**

### Approach D — Make the rate limit itself the constraint; sample one OLT per cycle

Each 15-min cycle, fan out to ONUs belonging to **only one OLT** (round
robin). 5 OLTs × 15 min = 75 min per OLT, which is still tight for the
24-h detector window but acceptable.

- **Pros:** No new loop; rate-budget-aware.
- **Cons:** Couples FEC cadence to OLT count in a way that's surprising
  for operators. At 5 OLTs, FEC samples arrive every 75 min — barely
  enough for the detector's `minSamples: 3` in a 24-h window (≈ 19
  samples/24h per ONU, fine).
- **Effort:** Medium. Hidden complexity in "which OLT this cycle?".

## Recommendation

**Approach A.1 — separate FEC collection loop with staggered fan-out.**

Justification:

1. **Right cadence for the detector.** With a 1-h loop and an 8-ONU
   rotation slice on a 42-ONU tenant, each ONU is sampled every ~5.25 h,
   giving the 24-h detector window 4–5 samples — comfortably above
   `minSamples: 3` and well below the 15 req/h SmartOLT budget (44 req/5.25 h
   ≈ 8.4 req/h).

2. **Decoupled ops knob.** Operators can disable FEC collection
   independently (`FEC_COLLECTION_ENABLED=false`) without affecting
   the metrics poller, the firmware audit, the SOC pipeline, or any
   other consumer.

3. **Mirrors the firmware audit pattern.** Same shape as
   `startFirmwareAuditLoop()` (`apps/web/lib/monitoring/scheduler.ts:128–145`)
   — same env-var convention, same boot point in `instrumentation.ts`,
   same default-disabled behavior. Cognitive load is one more knob, not
   a new concept.

4. **No new schema work.** Prisma already has the `MetricKind` values
   (`FEC_CORRECTED`, `FEC_UNCORRECTED`, etc.) — the migration has been
   applied since 2026-08-30. `persistSamples` is enum-agnostic.

5. **Mikrowisp graceful-degrade is free.** `collectSamples` already
   skips points when fields are `undefined` (`collect.ts:149–160`).
   Mikrowisp connections will simply produce no FEC samples; the
   detector returns `null`; no alert; no error. This matches the
   roadmap's "Si no [hay FEC], sale por SNMP/gNMI" — we don't fail
   loudly, we just don't have FEC for that NMS until a future phase
   brings SNMP/gNMI.

6. **Lowest review budget.** The change is approximately:
   - 1 new function `startFecCollectionLoop()` (~25 lines, sibling of
     `startFirmwareAuditLoop`).
   - 1 `FEC_COLLECTION_ENABLED` + `FEC_INTERVAL_MS` + `FEC_FAN_OUT_PER_CYCLE`
     triplet in env / `positiveInt` calls.
   - 1 line in `instrumentation.ts` to boot it.
   - 1 forwarding field on `PollCycleOptions` (`includeOnuDetail`).
   - **Total: well under the 400-line review budget** (`review_budget_lines
     = 400`, `delivery_strategy = ask-on-risk` per session preflight).

7. **Single chained-PR slice is feasible.** No need to slice further; one
   end-to-end PR covers connector-agnostic ingest + scheduler wiring +
   tests. The work fits comfortably in `ask-on-risk` delivery strategy.

### Open question worth surfacing to the user before `sdd-propose`

- **Default cadence.** 1 h vs 6 h vs 24 h. Recommendation: **1 h** with
  a stagger of 8 ONUs per cycle. This gives the best detector resolution
  while keeping the SmartOLT budget intact. Operators can override
  `FEC_INTERVAL_MS` upward for tight rate-limit environments. This is
  the only `delivery_strategy: ask-on-risk` item — everything else is
  mechanical.

## Risks

- **Operator forgets to set `FEC_COLLECTION_ENABLED=true` in production.**
  Default is off (matches firmware audit convention). Document loudly in
  the README and the architecture doc. Mitigation: add a startup log
  warning when `FEC_COLLECTION_ENABLED` is unset on a tenant that has
  SmartOLT connections, similar to the firmware audit's `runScheduledFirmwareAudit` log shape.

- **Mikrowisp connections emit no FEC samples.** This is **expected and
  intentional**, not a bug — the roadmap explicitly contemplates
  SNMP/gNMI as a future escape hatch (P2.4). However, the operator-facing
  dashboard must not signal "broken" when Mikrowisp connections are
  present. Mitigation: confirm the dashboard surfaces "no FEC telemetry
  available" rather than "FEC pipeline broken" for Mikrowisp tenants.
  This is a **docs / UI follow-up**, not a code follow-up.

- **Staggered fan-out drift.** If `FEC_FAN_OUT_PER_CYCLE` is set so high
  that one cycle exceeds the rate budget, **the cycle itself may be
  rate-limited by SmartOLT mid-flight** and partially fail. The
  `getOnuDetail` fan-out already swallows individual failures
  (`packages/analytics/src/collect.ts:122–129`), so the worst case is
  "this cycle's FEC samples for some ONUs are skipped". Mitigation: a
  pre-flight budget check — if `ONUs_total / fan_out_per_cycle` ×
  `requests_per_fan_out` exceeds `SMARTOLT_RATE_LIMIT_PER_HOUR × loop_hours`,
  log a warning and reduce `fan_out_per_cycle`. Low effort, high value.

- **`OnuSummary.fecCorrected`/`fecUncorrected` field-name variants.**
  SmartOLT has shipped `fec_corrected` / `fecCorrected` / `corrected_fec`
  (see `pickNumber` candidate list at
  `packages/connectors/smartolt/src/client.ts:245–246`). The current
  defensive mapping covers the three observed variants. **Risk:** SmartOLT
  introduces a fourth naming convention and the field silently maps to
  `undefined`, which is non-erroring but produces an empty series —
  exactly the same shape as the Mikrowisp graceful-degrade. Operator
  observability (a "FEC telemetry absent" log line at connector level)
  would help differentiate the two failure modes. Low priority.

- **`@ftth-copilot/analytics` `MetricKind` union missing
  `TRAFFIC_THROUGHPUT_MBPS`.** Not introduced by this change, but if
  `analytics/types.ts` is touched to add an `includeOnuDetail` knob on
  `CollectOptions` (it isn't — the knob already exists), this gap
  reopens. **No action needed for P2.1**, but worth filing a follow-up
  to reconcile the union with the Prisma enum and with
  `packages/alerts/src/types.ts` (which already has it).

- **Working tree is currently clean on `main` at `ba489bd`.** The change
  requires a feature branch + PR (no direct commits to `main`). This is
  the standard flow; `sdd-tasks` will surface the branch/PR split if
  needed.

- **The detection window assumption.** `detectFecDegradation` defaults
  to a 24-h window with `correctedDeltaThreshold = 100` and `uncorrected
  threshold = 0` (`packages/detection/src/fec.ts:46–49`). With a 1-h
  cadence the detector has ~24 samples per window — fine. With a 6-h
  cadence the detector has 4 samples per window — still above
  `minSamples: 3` but with less resolution on slope estimation. **Risk:**
  if a deployment sets `FEC_INTERVAL_MS` above 8 h, the warning path
  becomes data-poor. The detector returns `null` (no false positive),
  but real degradation may slip past. Mitigation: document the
  recommended cadence range in the new `startFecCollectionLoop` doc
  comment and in the env.example table.

## Ready for Proposal

**Yes** — recommend `/sdd-propose` next.

**Recommended proposal inputs:**
- **Approach:** Approach A.1 (separate FEC collection loop with staggered fan-out).
- **Default cadence:** `FEC_INTERVAL_MS = 3600000` (1 h).
- **Default fan-out slice:** `FEC_FAN_OUT_PER_CYCLE = 8` ONUs.
- **Env gate:** `FEC_COLLECTION_ENABLED=false` by default.
- **Mikrowisp behavior:** graceful no-op (no FEC points, no error).
- **Migration:** none (enum values already migrated).
- **Test surface:** 1 new `runPollCycle` forwarding test
  (`packages/monitoring/tests/poll.test.ts`); 1 new Mikrowisp-degrade
  test (`packages/analytics/tests/collect.test.ts`); 1 new scheduler
  test for the loop boot/skip behavior
  (`apps/web/tests/` or a new `scheduler.test.ts`).
- **Review budget:** ~150 LOC (well under 400).
- **Delivery strategy:** single PR; no chained slices needed.
- **Documentation follow-up:** update `docs/architecture.md:264` to say
  "FEC opt-in via FEC_COLLECTION_ENABLED, default 1-h cadence with
  staggered fan-out" once shipped.

**Baseline verified before this exploration:**
- `packages/detection/tests/fec.test.ts` — 5/5 green.
- `packages/analytics/tests/scenario.test.ts` — FEC/óptica end-to-end
  contract: 5/5 green (asserts `['fec_degradation', 'optical_degradation',
  'predicted_low_signal']` is what detectors produce from the scenario).
- `packages/alerts/tests/runner.test.ts` — FEC detection: 1/1 green.
- `packages/analytics/tests/collect.test.ts` — `includeOnuDetail` fan-out:
  4/4 green (fan-out enabled, fan-out disabled, partial failure, serial
  fallback).
- `packages/monitoring/tests/poll.test.ts` — `runPollCycle`: 7/7 green.
- `packages/soc/tests/run.test.ts` — `runFirmwareAudit` fan-out pattern
  reference: 5/5 green.

No baseline regression risk identified by this exploration.
