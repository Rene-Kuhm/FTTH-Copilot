# Fase 2 PR #1 — Evidence quality primitives (spec delta)

## Why

Roadmap Fase 2 (2.1 + 2.2 + 2.3 + 2.4 + 2.5) requires that every
diagnostic distinguish vigente, insuficiente y vencida. The
primitives below are the deterministic core the agent / scheduler /
investigation uses to make that distinction without fabricating
device assertions from missing samples.

## What changes

- `packages/evidence/src/evidence-quality.ts` (new): pure functions
  for telemetry freshness, coverage and counter sanity, plus a
  `toQualityVerdict` bridge that re-uses the existing TruthGate
  `Verdict` shape (no schema change).
- `packages/evidence/src/index.ts`: re-exports the new surface.
- `packages/evidence/tests/evidence-quality.test.ts` (new): pins the
  required test matrix from roadmap Fase 2 — cero/una muestra;
  hueco interno; eventos fuera de orden o en el futuro; contador
  reiniciado; campo no soportado; reloj controlado; datos antiguos;
  recuperación del recolector sin fabricar mediciones.

## Source policies (2.1, documented configuration)

The defaults below are documentation-first; environments MUST
calibrate them (roadmap 2.1: "los umbrales son configuración
documentada y requieren calibración por entorno").

| Source | Cadence | TTL | Max gap | Min samples |
|---|---|---|---|---|
| `smartolt.poll` | 60 s | 5 min | 3 min | 3 |
| `fec` | 60 s | 5 min | 3 min | 3 |
| `syslog` | event-driven | n/a | n/a | 0 |

## Scenarios (Given/When/Then)

### Scenario: collector is silent — quality says unknown, not device-down

Given the series has zero samples in the configured window
When `assessFreshness` runs
Then the level is `unknown` with reason `stale-no-sample`
And the caller MUST NOT conclude the device is offline (2.4)

### Scenario: a hole inside the window makes the span unknown

Given the series has samples at both ends of the window but a gap
larger than `maxGapMs` inside
When `assessFreshness` runs
Then the level is `unknown` with reason `unknown-gap`
And the bridge emits a `critical/incomplete` Verdict

### Scenario: a future sample is rejected

Given one sample has `sampledAt > now + 60 s`
When `assessFreshness` runs
Then the level is `error` with reason `future-sample`

### Scenario: counter reset is flagged, not clamped

Given UPTIME_SECONDS jumps from 120 → 80 mid-window
When `detectCounterReset` runs
Then it returns the index of the first backwards jump
And the agent sees both samples (no silent clamping)

### Scenario: TruthGate accumulates quality signals

Given a `fresh` quality result
When `toQualityVerdict` runs
Then the emitted Verdict is `{code: 'ok', severity: 'ok', reason: 'fresh'}`
And it appends to the existing `AgentResult.verdicts` shape unchanged

## Rules (RFC 2119)

- A quality verdict MUST NOT encode a device-down claim. The
  collector stream is the only subject of the assessment.
- `assessFreshness` MUST treat a prolonged hole inside the window
  as `unknown`, regardless of the values at either end.
- The default policy table is documentation-only; calibration by
  environment MUST NOT be required to ship this PR (the table is
  already calibrated for the test fixtures).
- The Verdict schema is unchanged; the bridge re-uses the four
  existing codes plus severity.

## Out of scope

- TruthGate integration in `agent-core` (PR #2 of Fase 2).
- Scheduler health checks (PR #3 of Fase 2).
- Persistence of quality results on MetricSample rows (lives in
  Fase 3; this PR ships the primitives only).
