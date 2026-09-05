# Exploration — p2-2-optical-metrics

> **Roadmap link:** `docs/roadmap-integraciones-pendientes.md` §P2.2 — "Métricas ópticas completas por ONT (bias / temperatura / LOS)". The roadmap hint already maps the gap: `BIAS_CURRENT_MA` and `ONT_TEMPERATURE_CELSIUS` are *already* persisted as side-effect of the P2.1 FEC collection loop, and `RX_POWER_DBM` / `TX_POWER_DBM` flow through the regular 15-min metrics poller. **The missing piece is `LOS` (Loss of Signal)**.
>
> **Scope of this exploration:** (a) confirm what is and isn't wired today, (b) identify whether the SmartOLT and Mikrowisp connectors expose any per-ONU LOS field we can defensively map, (c) decide between reusing the existing FEC scheduler or adding a separate loop, (d) flag the genuine ambiguity around the SmartOLT LOS endpoint so it can be closed before spec work begins. This document does **not** propose implementation; that is `sdd-propose`.

## Current State

### What is already wired (verified)

The P2.1 FEC collection loop shipped at `bc58e2d` (merge PR #83) made the
optical-telemetry side of the metric stack end-to-end live. The "regular
optical metrics flow" the roadmap refers to is the union of:

| Layer | File:lines | Status |
|---|---|---|
| Prisma `MetricKind` enum | `packages/db/prisma/schema.prisma:49-60` | `RX_POWER_DBM`, `TX_POWER_DBM`, `FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, `ONT_TEMPERATURE_CELSIUS` already declared. **No `LOS*` member.** |
| Prisma `AlertKind` enum | `packages/db/prisma/schema.prisma:63-72` | `fec_degradation`, `optical_degradation` already declared. **No `los_events` member.** |
| Connector-core field surface | `packages/connectors/core/src/index.ts:17-43` | `OnuSummary` already has `rxPowerDbm`, `txPowerDbm`, `fecCorrected`, `fecUncorrected`, `biasCurrentMa`, `ontTemperatureCelsius`. **No `losSecondsTotal`, `losCount`, or `signalLoss` member.** |
| SmartOLT bulk/detail mapper | `packages/connectors/smartolt/src/client.ts:230-270` | `mapOnuSummary` / `mapOnuDetail` defensively pick `fec_corrected` / `bias_current` / `ont_temperature` from a candidate list of naming variants (`pickNumber` lines 245-252). **No `los` candidate list.** |
| Mikrowisp mapper | `packages/connectors/mikrowisp/src/client.ts:246-260` | `mapEquipoToOnu` returns no `rxPowerDbm`, no `txPowerDbm`, no `fec*`, no `biasCurrent*`, no `ontTemperature*` — confirmed same shape for any new field. |
| Analytics collect (assemble) | `packages/analytics/src/scheduler-helpers.ts:102-122` | `assembleOnuDetailPoints` already emits `FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, `ONT_TEMPERATURE_CELSIUS` for finite fields; Mikrowisp ⇒ zero rows. **No `LOS*` emission.** |
| Analytics collect (bulk path) | `packages/analytics/src/collect.ts:136-161` | `collectSamples` already emits the same 4 kinds + `STATUS`, `RX_POWER_DBM`, `TX_POWER_DBM`, `UPTIME_SECONDS`. |
| Analytics ingest | `packages/analytics/src/ingest.ts:21-25` | `persistSamples` is `MetricKind`-agnostic — adding a new enum member is a transparent addition at this layer. |
| FEC scheduler tick | `apps/web/lib/monitoring/scheduler.ts:177-255` | `runScheduledFecCollection()` reads `FEC_COLLECTION_ENABLED`, picks the deterministic slice, rate-budgets via `fitsRateBudget`, fans out with `mapAllSettled` @ concurrency 4, assembles via `assembleOnuDetailPoints`, persists via `persistSamples`, emits structured log. **This is the right reuse point for LOS** — the per-ONU `getOnuDetail` fan-out is already there. |
| Boot | `apps/web/instrumentation.ts:9-20` | All three loops register (`startPollingLoop`, `startFirmwareAuditLoop`, `startFecCollectionLoop`). |
| Detection — FEC | `packages/detection/src/fec.ts:38-86` | `detectFecDegradation` — monotonic-counter delta over a 24 h window, threshold 100 corrected / 0 uncorrected. |
| Detection — optical (bias/temp) | `packages/detection/src/optical.ts:35-79` | `detectOpticalDegradation` — bias out-of-band → warning, temp > 70 °C → critical. **Has no LOS branch.** |
| Detection — status flapping | `packages/detection/src/flapping.ts` | `detectFlapping` consumes `STATUS` series. **Not a LOS detector** (online/offline/degraded flapping ≠ LOS events on an otherwise-online ONU). |
| Detection wiring | `packages/alerts/src/runner.ts:35-36` | `runDetectors` calls `detectFecDegradation` and `detectOpticalDegradation` for each device series. |
| Alerts grouping | `packages/alerts/src/group.ts:52-66` | Switch on `FEC_CORRECTED`/`FEC_UNCORRECTED`/`BIAS_CURRENT_MA`/`ONT_TEMPERATURE_CELSIUS` pushes into the per-device series. **No `LOS_*` case.** |
| Alerts types | `packages/alerts/src/types.ts:5-15` | `MetricKind` union is missing `LOS_*` (mirrors `analytics/src/types.ts`). `SeriesByDevice` (`types.ts:29-42`) has no `losSecondsTotal` / `losCount` series. |

### What is **not** wired (the gap)

1. **No `LOS` MetricKind** in `packages/db/prisma/schema.prisma:49-60` —
   adding `LOS_SECONDS_TOTAL` (or similar) **requires a migration**. This is
   the structural blocker; everything downstream is enum-agnostic by design
   (the P2.1 verification report explicitly notes `persistSamples` and the
   detector loop are kind-agnostic).

2. **No `los*` field** on `OnuSummary` / `OnuDetail` in
   `packages/connectors/core/src/index.ts:17-43`. The interface needs an
   optional field (most natural: `losSecondsTotal?: number` — a
   monotonically-incrementing total seconds-without-light since ONU last
   boot, OR `losCount?: number` — a counter of LOS events. **Both are valid
   shapes; the choice depends on what the SmartOLT API actually exposes** —
   see Approach A vs B below).

3. **No LOS detection** in `@ftth-copilot/detection`. `detectFlapping`
   triggers on `STATUS` series online/offline transitions, which is a
   coarser signal than LOS: an ONU can briefly lose downstream light
   without going fully offline. A dedicated `detectLosEvents` (or extending
   `detectOpticalDegradation` with a LOS branch) needs new logic.

4. **No LOS emission** in `assembleOnuDetailPoints`
   (`packages/analytics/src/scheduler-helpers.ts:102-122`) — adding a new
   kind is a 1-line table-driven extension of the existing
   `pointIfFinite` machinery.

5. **No LOS defensive mapping** in `pickNumber` calls in
   `packages/connectors/smartolt/src/client.ts:245-252`. The SmartOLT
   real-API docs comment block (lines 35-50) lists endpoints but does not
   name an LOS field; the actual field name (if any) is **not verified
   from a real NMS in this repo**. The fixtures do not carry an LOS field
   either.

### Connector state (per provider)

| Provider | LOS in bulk? | LOS in detail? | Notes |
|---|---|---|---|
| SmartOLT (`packages/connectors/smartolt/src/client.ts`) | **Unknown** — no LOS candidate mapped today (`mapOnuSummary:230-254`); real-API doc comment at `client.ts:35-50` lists `get_onus_statuses`, `get_outage_pons/{id}` but does not name a per-ONU LOS field. The `get_outage_pons` endpoint is OLT-scoped (returns PON ports with outages), not per-ONU. `get_onus_statuses` is plausibly where `los` would appear; **needs verification with a real SmartOLT tenant or the SmartOLT API docs**. | **Unknown** — same. The per-ONU detail endpoint is the natural place for an LOS counter; whether it carries one is the central technical risk. | **Blocker.** The roadmap's "Falta LOS" wording means "not yet exposed". Whether the underlying NMS exposes it at all (and under which name) must be verified. |
| Mikrowisp (`packages/connectors/mikrowisp/src/client.ts:139-175`) | **No** — `mapEquipoToOnu` returns only `id`, `serial`, `oltId`, `customerName`, `status`. The `/GetMonitoreo` endpoint doesn't appear to expose per-ONU optical telemetry today. | Same — `getOnuDetail` calls `/GetMonitoreo` again. | **No LOS support.** Mikrowisp graceful-degrade is automatic; same pattern as P2.1: undefined ⇒ zero points, no error, detector sees empty series. |
| NetSense | Not implemented (P2.5). | n/a | Out of scope. |

### The genuine ambiguity

**This is the single most important finding of this exploration.** Before
`sdd-spec`, we need to confirm whether the SmartOLT real API (not the mock)
exposes a per-ONU LOS metric. Three possibilities:

1. **SmartOLT exposes `los_seconds` (or `los_count`) on `get_onu_detail/{id}`** →
   the work is mechanical: add a candidate to `pickNumber`, add the field to
   `OnuDetail`, emit from `assembleOnuDetailPoints`, persist, detect.
2. **SmartOLT exposes LOS only on the OLT-scoped `get_outage_pons/{id}`** →
   the work shifts: instead of per-ONU LOS, we'd compute per-ONU LOS via
   cross-referencing outage-PON samples with `oltPort` on each ONU. Adds
   complexity and a different fan-out shape (per-OLT instead of per-ONU).
3. **SmartOLT does not expose LOS at all** →
   LOS coverage requires the SNMP/gNMI collector (P2.4 / future). P2.2
   would then be **scoped down to "confirm BIAS + TEMP coverage"** and the
   LOS portion is deferred to P2.4.

The repository evidence today does not let us rule out (3) without external
verification (a real SmartOLT tenant or the SmartOLT public API docs).

## Affected Areas

### Required code changes (if SmartOLT exposes LOS at the per-ONU detail)

- `packages/db/prisma/schema.prisma:49-60` — **add `LOS_SECONDS_TOTAL` to
  `MetricKind` enum** (or similar; see Approaches). **New Prisma migration
  required**: `prisma migrate dev --name add_los_metric_kind` producing a
  new `migrations/YYYYMMDDHHMMSS_add_los_metric_kind/migration.sql` with
  `ALTER TYPE "MetricKind" ADD VALUE 'LOS_SECONDS_TOTAL'`. This is the
  first migration of its kind since the P2.1 setup migrations
  (`20260830120000_add_fec_optical_metric_kinds` and
  `20260830130000_add_fec_optical_alert_kinds`); the team has the muscle
  memory.

- `packages/db/prisma/migrations/<new>/migration.sql` — the migration file.

- `packages/analytics/src/types.ts:9-18` — extend `MetricKind` union with
  the new member. The pre-existing `TRAFFIC_THROUGHPUT_MBPS` gap
  (P2.1 follow-up) can be reconciled in the same edit since
  the union gets touched anyway.

- `packages/connectors/core/src/index.ts:17-43` — add
  `losSecondsTotal?: number` (or `losCount?: number`) to `OnuSummary`.

- `packages/connectors/smartolt/src/client.ts:245-252` — extend
  `mapOnuSummary` / `mapOnuDetail` with a `pickNumber` candidate list:
  `['los_seconds_total', 'los_seconds', 'losCount', 'los_count', 'loss_of_signal_seconds']`.
  Following the P2.1 naming-churn precedent (three candidates for FEC
  corrected), pre-empt at least 3-4 candidate names.

- `packages/connectors/mikrowisp/src/client.ts:246-260` — **no code
  change**. Graceful-skip is automatic: Mikrowisp returns undefined for
  any new field on `OnuSummary`, and the analytics layer skips undefined
  fields (see `assembleOnuDetailPoints` and `pointIfFinite`).

- `packages/connectors/smartolt/src/fixtures.ts:605-731` — extend at least
  two of the five existing `FIXTURE_ONU_DETAILS` entries to carry a
  realistic `losSecondsTotal` (e.g. the pre-failure `ONU-OLT-Este-01-1/7/4`
  fixture could carry a high `losSecondsTotal`; the degraded
  `ONU-OLT-Este-01-1/8/1` could carry a small one; the healthy
  `ONU-OLT-Norte-01-1/1/1` carries zero).

- `packages/analytics/src/scheduler-helpers.ts:102-122` — extend
  `assembleOnuDetailPoints` with a fifth `maybePush('LOS_SECONDS_TOTAL',
  detail.losSecondsTotal)` call. **One-line change** following the existing
  `pointIfFinite` pattern.

- `packages/analytics/tests/scheduler-helpers.test.ts` — extend the
  `assembleOnuDetailPoints` describe block with a test that asserts the
  new kind is emitted when `losSecondsTotal` is finite, and absent when
  undefined (Mikrowisp).

- `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` — extend the happy
  path test to assert that SmartOLT details with `losSecondsTotal`
  produce a 5th kind and a `persisted` count of 40 instead of 32 (8 ONUs ×
  5 kinds).

- `packages/alerts/src/types.ts:5-15` — extend the `MetricKind` union
  with the new member. Add `losSecondsTotal: Array<{ t: number; v: number }>`
  to `SeriesByDevice`.

- `packages/alerts/src/group.ts:52-66` — add a `case 'LOS_SECONDS_TOTAL'`
  switch arm pushing into `series.losSecondsTotal`.

- `packages/detection/src/los.ts` — new file. **Pure detector**
  `detectLosEvents(deviceKind, deviceId, losSecondsTotal, opts)` that
  returns a `Finding` when the recent window (default 24 h, min 3 samples)
  shows `losSecondsTotal` strictly increasing (a counter-delta signal —
  the LOS is an event, not a level) **OR** when the most-recent sample is
  finite and any prior sample is zero and this one is non-zero
  ("LOS just started"). Severity is `warning` by default; if the
  delta in the window exceeds a threshold (configurable, default e.g. 30
  s) escalate to `critical`. **Pattern follows `detectFecDegradation`'s
  monotonic-counter delta detection** (lines 38-86 of `fec.ts`).

- `packages/detection/src/index.ts` — re-export `detectLosEvents`.

- `packages/detection/tests/los.test.ts` — RED→GREEN unit tests covering:
  empty series → null; one-sample series → null (below `minSamples`); two
  consecutive equal samples → null; counter-delta above threshold →
  warning; counter-delta above `criticalThreshold` → critical; very recent
  spike (counter just incremented) → warning regardless of window total.

- `packages/alerts/src/runner.ts:35-36` — extend `runDetectors` to call
  `detectLosEvents(s.deviceKind, s.deviceId, s.losSecondsTotal, { now })`
  after the existing optical call. **One-line addition** following the
  existing detector loop pattern.

- `packages/alerts/tests/runner.test.ts` — extend the test matrix with
  the new detector's findings.

- `docs/architecture.md:264` — extend the FEC paragraph to mention the
  fifth kind, and update §6.1 detector table to add `detectLosEvents`.

- `docs/roadmap-integraciones-pendientes.md` §P2.2 — flip to ✅ shipped
  once merged (same pattern as P2.1 §3.1 of its tasks.md).

### Files NOT changed (P2.1 precedent preserved)

- `apps/web/lib/monitoring/scheduler.ts` — **no change**. The existing
  `runScheduledFecCollection()` already fans out to `getOnuDetail` per ONU
  with rate-budgeted slice rotation, calls `assembleOnuDetailPoints`,
  persists, and emits structured logs. LOS is one extra kind, emitted by
  the same helper, on the same cadence, with the same kill switch
  (`FEC_COLLECTION_ENABLED`). **This is the core reuse claim of P2.2**:
  zero new scheduler code.
- `apps/web/instrumentation.ts` — no change (the boot line stays).
- `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` — only the
  happy-path assertion is updated; the rest stays byte-identical.
- `packages/analytics/src/collect.ts` — no change.
- `packages/analytics/src/ingest.ts` — no change (MetricKind-agnostic).
- `packages/analytics/src/sla.ts`, `packages/analytics/src/retention.ts` —
  no change.
- `packages/monitoring/src/poll.ts` — no change.
- `packages/soc/src/run.ts` — no change.
- `packages/db/prisma/schema.prisma` — only the `MetricKind` enum grows;
  no model changes.

## Approaches

### Approach A — Single-monotonic-counter field (`losSecondsTotal`)

Treat LOS the same way FEC is treated: a monotonically-increasing total
since ONU last boot. Add `losSecondsTotal?: number` to `OnuSummary`.
Detect via counter-delta (`detectLosEvents` mirrors `detectFecDegradation`).

- **Pros:**
  - **Direct reuse of the FEC pipeline.** `assembleOnuDetailPoints`
    grows by one line; the FEC scheduler already fans out to `getOnuDetail`
    per ONU; the persist + detection + notification pipeline is unchanged.
  - **Counter-delta semantics** fit the existing detector pattern
    (`detectFecDegradation` lines 38-86) — same window, same
    `minSamples`, same severity ladder.
  - **Mikrowisp graceful-degrade** is free (same as P2.1).
  - **No new scheduler, no new env vars.** The single
    `FEC_COLLECTION_ENABLED` flag covers LOS automatically.
- **Cons:**
  - **Requires a Prisma migration** (the first migration of this change
    type since the P2.1 setup). Not a true blocker (the team has muscle
    memory; the migration is `ALTER TYPE MetricKind ADD VALUE` — a few
    lines).
  - **The SmartOLT real-API field name is uncertain.** The candidate
    `pickNumber` list has to cover `los_seconds_total`, `losCount`,
    `los_count`, `loss_of_signal_seconds`, possibly more — a defensive
    multi-key mapping (same as FEC, line 245).
  - **Cannot distinguish short LOS blips from sustained LOS** without
    configuring the window. This is the same trade-off FEC already made
    (`fec.ts:46` defaults to a 24 h window).
- **Effort:** Low–Medium.

### Approach B — Per-tick status / event counter (`losCount`)

Treat LOS as an **event counter** that increments on each LOS event the
ONU reports (rather than a cumulative-seconds counter). Detector looks for
"≥ N LOS events in last window" — closer to a rate detector than a
counter-delta detector.

- **Pros:**
  - **Cleaner detection semantics** for transient LOS blips that don't
    last long enough to register as seconds.
  - **Fits some operator mental models** better ("how many times did the
    ONU lose signal?").
- **Cons:**
  - **Requires the SmartOLT API to expose an event counter**, not a
    seconds counter. Whether that field exists is just as unknown as for
    Approach A.
  - **Different detection shape** from `detectFecDegradation` — needs new
    detector logic (counter of events within window, not delta of
    monotonic counter). Slightly more code.
- **Effort:** Medium. Same migration + connector + scheduler reuse, but
  the detector is non-trivial.

### Approach C — Derive LOS implicitly from `STATUS` series (no new metric)

Detect "loss of signal" as the duration the ONU spent in `offline` /
`degraded` status between two samples, computed by `detectFlapping` or
the existing `STATUS` series. No new `MetricKind`, no new connector
field, no migration.

- **Pros:**
  - **Zero schema or connector work.**
  - **Reuses `STATUS` data the bulk poller already collects** — no rate
    budget impact.
  - **Simple: any operator seeing offline/degraded already knows.**
- **Cons:**
  - **STATUS is the 15-min bulk series**; it loses resolution to LOS
    events that occur and recover within one poll interval (≤ 15 min).
  - **No semantic distinction** between "ONU went offline" (link down,
    power unplugged) and "ONU lost optical signal" (fiber cut, splitter
    failure). Operators need to distinguish.
  - **Already exists** as `detectFlapping`; the user explicitly wants
    "LOS" as a first-class signal, not a side-effect of `STATUS`.
- **Effort:** Low — but **doesn't satisfy the user request.** Approach C
  is the *do-nothing* option and is here only to be explicit that we
  considered and rejected it.

### Approach D — Defer LOS to P2.4 (SNMP/gNMI collector)

If SmartOLT does not expose per-ONU LOS at all (and the public SmartOLT
docs we have don't confirm it), the right move is to defer the LOS
portion of §P2.2 to the SNMP/gNMI phase (P2.4) and only ship the bias /
temperature coverage confirmation now.

- **Pros:**
  - **Honest scope.** Ship what we can verify; defer what we can't.
  - **Aligns with the roadmap's own P2.4 escape hatch** ("si no [hay
    FEC], sale por SNMP/gNMI").
- **Cons:**
  - **Leaves §P2.2 partially open** — the roadmap marks the whole item
    as "🔵 PENDIENTE (próximo)"; splitting it requires editing the
    roadmap.
  - **No new collector yet** — P2.4 is itself a future phase.
- **Effort:** Low today, but **doesn't actually close §P2.2**.

### Approach E — Two new loops (FEC + LOS separate)

Add a third scheduler loop `runScheduledLosCollection()` parallel to
`runScheduledFecCollection()`, with its own cadence and env gate
(`LOS_COLLECTION_ENABLED`). Mirrors the FEC-vs-firmware-audit split.

- **Pros:**
  - Decouples LOS rate budget from FEC.
- **Cons:**
  - **Unnecessary.** LOS lives on the same `getOnuDetail` endpoint as
    FEC; splitting the loop means two `getOnuDetail` calls per ONU per
    cycle — pure duplication.
  - **Operator cognitive load** — yet another `*_COLLECTION_ENABLED`
    knob for no benefit.
- **Effort:** Medium. **Reject.** P2.1 already established the
  "single loop covers what the same endpoint returns" pattern.

## Recommendation

**Approach A — single-monotonic-counter (`losSecondsTotal`), reusing the
existing P2.1 FEC collection loop.**

Justification:

1. **Direct reuse of the P2.1 pipeline.** `runScheduledFecCollection()`
   already fans out to `getOnuDetail` per ONU; `assembleOnuDetailPoints`
   already emits up to 4 kinds per ONU; `persistSamples` is
   `MetricKind`-agnostic; the existing detection pipeline already groups
   by `MetricKind` and calls detectors per series. Adding LOS is one
   `maybePush` line in `assembleOnuDetailPoints`, one `pickNumber`
   candidate list extension in SmartOLT, one new detector file, and one
   Prisma migration for the new enum member. **Zero scheduler work,
   zero new env vars, zero new test infrastructure.**

2. **The P2.1 architectural claim already commits to this.** The
   P2.1 `design.md` AD-2 reads: *"Single `includeOnuDetail: true`
   covers FEC + optical"*. The "optical" half was bias + temp at the
   time; this change adds LOS to that same umbrella.

3. **Counter-delta detection is the right shape.** A monotonically
   increasing total (since ONU last boot) maps cleanly to the
   `detectFecDegradation` pattern: a 24 h window, `minSamples: 3`,
   warning on small delta, critical on threshold breach. The detector
   is a small file (~50 LOC) plus tests.

4. **Mikrowisp graceful-degrade is automatic** by the same P2.1
   mechanism: undefined `losSecondsTotal` → no point persisted → detector
   sees empty series → returns null. **No Mikrowisp code change.**

5. **Review budget is small.** Estimated ~300 LOC across ~10 files
   (one migration ~10 LOC, one new detector ~50 LOC + ~80 LOC tests,
   one `assembleOnuDetailPoints` extension ~3 LOC, connector field
   + `pickNumber` candidate ~5 LOC, helper test extension ~10 LOC,
   scheduler test extension ~10 LOC, alert wiring 2 lines, docs ~30
   LOC, fixture extensions ~10 LOC). **Under the 400-line authored
   budget, single PR feasible** if we tighten the test coverage; with
   `chain_strategy: stacked-to-main` from the session preflight,
   splitting into a helpers-slice and a detector-slice is the safer
   call.

6. **The single genuine risk is the SmartOLT field name.** If the
   SmartOLT real API does not expose any `los*` field on
   `get_onu_detail/{id}`, Approach A collapses to Approach D (defer to
   P2.4) or to a downgraded P2.2 that ships only "BIAS + TEMP coverage
   confirmation" with the existing detector. **This must be verified
   before spec work begins** (see Open Question below).

### Sub-decision: shape of the new detector (`detectLosEvents`)

| Aspect | Decision |
|---|---|
| Input | `losSecondsTotal: NumericSample[]` (monotonic counter) |
| Window | Default 24 h (matches `detectFecDegradation`) |
| `minSamples` | 3 |
| Warning trigger | counter delta ≥ 1 over the window |
| Critical trigger | counter delta ≥ 30 over the window (configurable) |
| Severity title | `"Pérdida de señal (LOS) en ${deviceId}"` |
| Description | `"LOS acumulado ${delta}s en ventana de ${windowMs/3.6e6}h"` |
| `FindingKind` | **Reuse `optical_degradation`** — semantically correct (it's an optical-health degradation finding), no new `AlertKind`, no second migration. **Title/description disambiguates** between LOS / bias / temp. |

This avoids the second `ALTER TYPE AlertKind ADD VALUE` migration.

### Open question worth surfacing to the user before `sdd-propose`

- **Confirm the SmartOLT per-ONU LOS field name with a real tenant or
  the SmartOLT public API docs.** Plausible candidates:
  `los_seconds_total`, `los_seconds`, `losCount`, `los_count`,
  `loss_of_signal_seconds`, `signal_loss_seconds`. If the field is
  not exposed on `get_onu_detail/{id}` at all, the work changes
  shape (Approach D) and P2.2 should split into "BIAS + TEMP coverage
  confirmation" (ship now) + "LOS via SNMP/gNMI" (defer to P2.4).

- **Default cadence and severity thresholds** for the new detector:
  the proposal can pick safe defaults (24 h window, 1 s delta for
  warning, 30 s for critical), but if the operator has a strong
  preference this is the right moment to surface it.

## Risks

- **SmartOLT may not expose per-ONU LOS at all.** This is the
  central risk. Mitigations: (a) verify with a real tenant or public
  SmartOLT API docs before spec work; (b) the defensive `pickNumber`
  candidate list covers 4-5 plausible names, but a "not exposed"
  finding simply means `losSecondsTotal` stays undefined and the
  detector never fires — same graceful-degrade shape as Mikrowisp; (c)
  if no LOS field exists, the change collapses to Approach D
  (defer) and the proposal can be rewritten without code review
  waste.

- **A Prisma migration is reintroduced.** P2.1 went to lengths to
  avoid migrations; P2.2 cannot (we genuinely need a new `MetricKind`).
  The team has muscle memory from `20260830120000` and
  `20260830130000`; the migration is straightforward. **Risk:** a
  second concurrent migration racing on the same Postgres enum is
  not possible (Postgres serializes enum value additions), but two
  feature branches both touching `MetricKind` at the same time will
  conflict. **Mitigation:** ship the migration as a separate PR
  (helpers-slice chained PR #1) before the detector wiring
  (chained PR #2).

- **LOS counter semantics are vendor-specific.** SmartOLT may
  report seconds of LOS, an event count, or a flag (boolean). If
  the field is actually a flag ("currently in LOS"), the
  counter-delta detector logic is wrong. **Mitigation:** the
  detector should accept both shapes — counter-delta when the
  field is monotonically non-decreasing (delta semantics), recent
  spike when it's a level — but the proposal should decide which
  shape to commit to. **Default:** counter-delta (Approach A).

- **LOS detector may fire alongside `detectFlapping` on the same
  device.** Two separate findings on one ONU is acceptable
  (correlate into one incident via `correlateAlerts`), but the
  operator should be aware that LOS + flapping is one root cause.
  **Mitigation:** verify `packages/alerts/src/correlate.ts`
  handles two `optical_degradation` findings with different
  titles on the same device; if it doesn't, the proposal should
  note this as a follow-up.

- **Test fixture drift.** SmartOLT fixtures need at least 2-3 ONUs
  to carry realistic `losSecondsTotal` values. Without this, the
  scenario harness (`packages/analytics/src/scenario.ts`) and the
  `seed-scenario.ts` regression suite cannot exercise the new
  detector end-to-end. **Mitigation:** extend the existing
  `FIXTURE_ONU_DETAILS` entries (the same ones already used for the
  bias/temp scenarios) rather than adding new ONUs.

- **Reuse of `optical_degradation` AlertKind.** Some operators may
  want a distinct `los_events` AlertKind for triage. **Risk:** low
  (title/description already distinguishes); **mitigation:** easy
  to split later in a follow-up. Not a P2.2 blocker.

- **`packages/analytics/src/types.ts` `MetricKind` union pre-existing
  gap on `TRAFFIC_THROUGHPUT_MBPS`.** The P2.1 follow-up is now
  actionable in the same edit (we touch this file to add
  `LOS_SECONDS_TOTAL`). **Mitigation:** reconcile the union in the
  same PR — adding one missing member while we're adding a new one
  is the lowest-cost moment.

- **`packages/alerts/src/types.ts:5-15` mirrors the union** with
  the same gap; same edit can reconcile both.

- **The SmartOLT real-API `get_onus_statuses` endpoint is documented
  but unused.** If it carries the LOS field, we'd need a new code
  path (bulk endpoint → fan-out by id); if it carries per-ONU status
  only, it's irrelevant for LOS. **Mitigation:** verify before
  spec.

## Ready for Proposal

**Conditional Yes** — recommend `/sdd-propose` next, **gated on closing
the SmartOLT LOS field-name ambiguity**.

The orchestrator should surface one question to the user before launching
`sdd-propose`:

> **Q for the user:** "Do we have access to a real SmartOLT tenant (or
> the SmartOLT public API docs) that can confirm whether
> `get_onu_detail/{id}` exposes a per-ONU `los_seconds_total` /
> `los_count` / similar field? Three answer paths:
> (a) **Yes, the field exists** — proposal proceeds as Approach A.
> (b) **No, but a different SmartOLT endpoint carries it**
> (e.g. `get_outage_pons/{id}`) — proposal will pick a different
> data path; I'll re-explore.
> (c) **No / unknown** — proposal will split P2.2: ship BIAS + TEMP
> coverage confirmation now, defer LOS to P2.4 (SNMP/gNMI collector).
> All other design decisions (Approach A, reuse of FEC loop, counter-delta
> detection, reuse of `optical_degradation` AlertKind) are confirmed by
> this exploration."

**Recommended proposal inputs (assuming answer (a)):**
- **Approach:** A (single-monotonic-counter, reuse FEC loop).
- **New MetricKind:** `LOS_SECONDS_TOTAL` (numeric, monotonic counter
  in seconds since ONU last boot).
- **New field:** `losSecondsTotal?: number` on `OnuSummary` /
  `OnuDetail`.
- **New detector:** `detectLosEvents` (mirrors `detectFecDegradation`).
  Defaults: window 24 h, `minSamples: 3`, warning at Δ ≥ 1 s, critical
  at Δ ≥ 30 s.
- **Finding kind:** reuse `optical_degradation` (no second migration).
- **Connector:** SmartOLT `pickNumber` candidates
  `['los_seconds_total', 'los_seconds', 'losCount', 'los_count',
  'loss_of_signal_seconds']`.
- **Migration:** new `ALTER TYPE MetricKind ADD VALUE
  'LOS_SECONDS_TOTAL'` migration (chain helpers-slice → detector-slice
  PR split to keep each PR under 400 LOC).
- **Mikrowisp:** no change (graceful no-op).
- **Test surface:**
  `packages/detection/tests/los.test.ts` (~80 LOC),
  `packages/analytics/tests/scheduler-helpers.test.ts` extension
  (~10 LOC),
  `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` extension
  (~10 LOC),
  `packages/alerts/tests/runner.test.ts` extension (~10 LOC),
  `packages/connectors/smartolt/src/fixtures.ts` extension (~10 LOC),
  `packages/connectors/smartolt/tests/real-client.test.ts` extension
  (~15 LOC).
- **Review budget:** ~300 LOC across ~10 files; chain via
  `stacked-to-main` into 2 PRs (helpers-slice + detector-slice) per
  the session preflight `chain_strategy: stacked-to-main` and
  `review_budget: 400 lines`. PR 1 = migration + connector field +
  `assembleOnuDetailPoints` extension + helper tests. PR 2 = new
  detector + alert wiring + scheduler test extension + docs.
- **Delivery strategy:** `auto-chain` (per preflight).
- **Docs:** update `docs/architecture.md:264`, §6.1 detector table, and
  flip `docs/roadmap-integraciones-pendientes.md` §P2.2 to ✅ shipped.

**Baseline verified before this exploration:**
- `packages/analytics/tests/scheduler-helpers.test.ts` — 29/29 green
  (P2.1 helpers-slice shipped).
- `apps/web/tests/lib/monitoring/fec-scheduler.test.ts` — 11/11 green
  (P2.1 scheduler-slice shipped).
- `packages/detection/tests/fec.test.ts` — 5/5 green.
- `packages/detection/tests/optical.test.ts` — 5/5 green (the bias/temp
  detector we'll mirror).
- `packages/analytics/tests/collect.test.ts` — fan-out covered (4 tests).
- `packages/analytics/tests/scenario.test.ts` — end-to-end FEC/optical
  scenario 5/5 green.
- `packages/alerts/tests/runner.test.ts` — FEC + optical detectors
  covered.
- `packages/alerts/tests/group.test.ts` — `BIAS_CURRENT_MA` /
  `ONT_TEMPERATURE_CELSIUS` / `FEC_*` switch arms covered.
- Full monorepo `turbo run test`, `typecheck`, `lint`, `build` all green
  at `bc58e2d` (per P2.1 verify-report and `bc58e2d` commit message).

No baseline regression risk identified by this exploration.

### Out-of-scope follow-ups (do NOT do in P2.2)

- No SNMP/gNMI collector (P2.4 future).
- No NetSense connector (P2.5 future).
- No dashboard UI changes — the existing `optical_degradation` alert
  surfaces in the existing dashboard.
- No Mikrowisp changes — graceful no-op is the contract.
- No new `AlertKind` — reuse `optical_degradation` with disambiguating
  title/description.
- No edits to `apps/web/lib/monitoring/scheduler.ts` — the FEC loop is
  the reuse point.
- No edits to `runScheduledPoll`, `runScheduledFirmwareAudit`.
- No `TRAFFIC_THROUGHPUT_MBPS` plumbing (still no throughput data on
  either connector); but the analytics `MetricKind` union and alerts
  union should be reconciled while we're editing them.