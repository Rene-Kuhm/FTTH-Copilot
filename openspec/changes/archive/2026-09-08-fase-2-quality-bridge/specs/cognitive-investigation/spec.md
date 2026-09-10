# Fase 2 PR #2 — Quality → TruthGate bridge (spec delta)

## Why

Roadmap Fase 2 (2.5): integrate evidence quality with TruthGate
through a compatible extension and surface motivo + última
observación on the investigation card. The bridge re-uses the
existing Verdict shape — no schema change — so the existing
`AgentResult.verdicts` accumulator carries quality signals without
breaking any consumer.

The integration is OPT-IN and OFF by default (roadmap MUST-10):
no caller is required to use it, no existing run is affected, and
disabling it requires no code changes.

## What changes

- `packages/agent-core/src/quality-bridge.ts` (new): the public
  function `qualityVerdictFromToolSamples` projects a sample series
  + SourcePolicy onto a TruthGate-compatible Verdict (closed
  `code` / `severity` enums, plus the verbatim QualityReason as
  `reason`).
- `packages/agent-core/src/index.ts`: re-exports the bridge.
- `packages/agent-core/tests/quality-bridge.test.ts` (new): 7 tests
  covering fresh / stale / unknown-gap / future-sample / zero-samples
  / idempotence / shape parity with classifyEnvelope.

## Scenarios (Given/When/Then)

### Scenario: a healthy series appends a fresh verdict

Given the series has 3 fresh samples inside TTL
When the bridge runs with that series and `POLL` policy
Then the emitted Verdict is `{code: 'ok', severity: 'ok', reason: 'fresh'}`
And it appends to `AgentResult.verdicts` without shape mismatch

### Scenario: a collector hole appends an incomplete/critical verdict

Given the series has a gap > `maxGapMs`
When the bridge runs
Then the emitted Verdict is `{code: 'incomplete', severity: 'critical', reason: 'unknown-gap'}`
And the investigation UI displays "evidencia desconocida: hueco interno"

### Scenario: zero samples — the bridge says unknown, never device-down

Given the series is empty
When the bridge runs
Then the Verdict reason is `stale-no-sample` (collector down)
And the caller MUST NOT conclude the device is offline

## Rules (RFC 2119)

- The bridge MUST NOT touch `runAgent`. Integration at the runtime
  level is a separate PR.
- The Verdict shape MUST remain compatible with `classifyEnvelope`:
  four fields (`code`, `reason`, `severity`, `toolName`), closed
  string-union values.
- The Verdict's `reason` MUST carry the QualityReason verbatim, so
  the UI can render it without parsing the message text.

## Out of scope

- Wiring the bridge into `runAgent` (Fase 2 PR #3).
- UI surfaces (Fase 3 investigation card).
- Persistence of quality results on MetricSample rows (Fase 3).
