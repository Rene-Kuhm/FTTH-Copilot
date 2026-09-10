# Fase 2 PR #2 — Quality → TruthGate bridge

## Why

Roadmap Fase 2 (2.5). The existing TruthGate classifies tool
envelopes; the quality primitives (PR #1) classify telemetry
series. The bridge projects a series onto the existing Verdict
shape so the agent's verdict accumulator can carry both kinds of
signal without schema change.

## What changes

- `packages/agent-core/src/quality-bridge.ts` (new): a single
  public function, `qualityVerdictFromToolSamples`, that takes a
  tool name + samples + policy + optional synthetic clock and
  returns `{ verdict, result }`. Pure and idempotent.
- `packages/agent-core/src/index.ts`: re-exports.
- `packages/agent-core/tests/quality-bridge.test.ts` (new): 7 tests
  pinning the bridge's behaviour and shape parity with
  `classifyEnvelope`.

## Out of scope

- `runAgent` integration (Fase 2 PR #3).
- UI surfaces (Fase 3).
- Persistence on MetricSample rows (Fase 3).
