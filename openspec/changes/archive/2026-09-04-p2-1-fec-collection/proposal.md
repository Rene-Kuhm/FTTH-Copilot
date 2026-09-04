# Proposal: P2.1 FEC Collection

## Intent

FEC_BIP8 corrected and uncorrected counters are an early signal of fiber degradation, often before RX crosses the offline threshold. P2.1 closes the runtime gap: schema, connector mapping, analytics emission, and detection exist, but the scheduler never activates ONU-detail collection, so no FEC samples reach detection.

This adds opt-in, rate-budgeted collection without coupling per-ONU requests to the frequent metrics poll. SmartOLT receives counter deltas; providers without FEC telemetry safely produce no samples.

## Scope

### In Scope
- Third scheduler loop with `FEC_COLLECTION_ENABLED=false`.
- Configurable `FEC_COLLECTION_INTERVAL_MS=3600000` (1 h) and `FEC_FAN_OUT_PER_CYCLE=8`.
- Deterministic 8-ONU rotation, pre-flight SmartOLT 15 req/h budget guard, tests, and docs delta.

### Out of Scope
- Prisma migration; SNMP/gNMI collector (P2.3/P2.4); Mikrowisp fix.
- New detector or dashboard UI.

## Capabilities

### New Capabilities
- `fec-collection`: Opt-in scheduled FEC/optical telemetry with bounded, rotating ONU fan-out.

### Modified Capabilities
- None; ingestion and detection are activated by runtime wiring only.

## Approach

Use Approach A.1. Add `runScheduledFecCollection()` and `startFecCollectionLoop()` in `apps/web/lib/monitoring/scheduler.ts`, analogous to `startFirmwareAuditLoop()`, and boot it from `apps/web/instrumentation.ts`. Reuse `collectSamples(connector, meta, { includeOnuDetail: true })` from `@ftth-copilot/analytics`; add minimal monitoring option forwarding. Implement `pickFecFanOutSlice(onus, now, sliceSize)` for rotation and `fitsRateBudget(perCycle, intervalMs, limitPerHour)` before each fan-out. Metrics polling, firmware audit, and FEC collection remain independent loops.

## Goals & Non-goals

- **Goals:** collect SmartOLT FEC deltas safely; preserve existing cadence/defaults; degrade cleanly for Mikrowisp; stay near ~150 LOC, below the 400-line review budget.
- **Non-goals:** broaden provider telemetry, alter thresholds, add persistence models, or surface UI.

## Affected Areas

- `apps/web/lib/monitoring/scheduler.ts`, `apps/web/instrumentation.ts`: loop, rotation, guard, env wiring.
- `packages/monitoring/src/poll.ts`: forward ONU-detail option.
- Monitoring, analytics, and web tests: failing-first coverage.
- `docs/architecture.md` and env docs: operator guidance.

## Risks

- Flag left off: document and log startup state.
- Bad fan-out/cadence exceeds quota: guard skips or reduces unsafe work and logs.
- Mikrowisp has no FEC: intentional no samples; detection returns `null` without error.
- Provider field-name drift silently removes telemetry: retain defensive mapping/observability.
- Cadence above 8 h makes the 24 h detector window data-poor.

## Rollback Plan

Set `FEC_COLLECTION_ENABLED=false` to stop the loop (the kill switch), or revert the PR. No schema or destructive changes are introduced.

## Open Questions

Default cadence=1h and fan-out slice=8 are confirmed per pre-proposal handoff; spec must not re-litigate them.

## Out-of-Scope Follow-ups

- `TRAFFIC_THROUGHPUT_MBPS` analytics type union gap.
- Mikrowisp FEC through its provider/SNMP path.
- Dashboard surfacing for unavailable FEC telemetry.

## Success Criteria

- [ ] Enabled loop persists FEC samples while all three loops coexist.
- [ ] Rotation and budget tests prove unsafe fan-out is not attempted.
- [ ] Undefined Mikrowisp FEC fields produce no samples and no error.
