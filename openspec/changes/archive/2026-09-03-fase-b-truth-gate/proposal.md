# Proposal: Fase B — Truth Gate (observation mode)

## Intent

Fase A tags every tool result with `evidence.provenance.v1` but the metadata is unenforced — the LLM consumes stale, low-confidence, or incomplete data without awareness. Fase B introduces a **pure code gate** that classifies each envelope (staleness, confidence, completeness) and records verdicts in observe mode. This gives the agent code-side evidence awareness without breaking current responses, and produces calibration data for Fase C strict enforcement/abstention.

## Scope

### In Scope

- New `@ftth-copilot/evidence` package (`packages/evidence`) — pure TypeScript, no LLM dependency, own vitest + tsconfig
- `TruthGate.classify(envelope)` → verdict: `stale | low_confidence | incomplete | ok`
- `TruthGate.classifyUnwrapped()` → treats missing envelope as `incomplete` (no-evidence path)
- Missing `confidence` field → default to `low_confidence` (unknown is low)
- Same thresholds for demo and live data (no lenient demo mode)
- Turbo task wiring (`packages/evidence` in `turbo.json` pipeline)
- Pre-LLM hook in `runAgent` (`packages/agent-core/src/runtime.ts`) — parse, classify, record
- Observe-mode verdict recording: new `verdicts` field on `AgentResult` (additive, no contract break)
- Unit tests: classification matrix (staleness, confidence, completeness, unwrapped, edge cases)

### Out of Scope

- Dropping or rejecting data (observe mode only — data always passes through)
- Per-tool data-shape validation (`data` field is opaque in Fase B)
- Numeric-claim extraction from free text
- Strict enforcement / LLM prompt abstention (Fase C)
- Dashboard or UI for verdicts

## Capabilities

### New Capabilities

- `truth-gate-classification`: Pure envelope classification logic (staleness, confidence, completeness) with observe-mode verdicts. Lives in `packages/evidence/src/`.

### Modified Capabilities

- `evidence-provenance`: Minor addition — `AgentResult` gains optional `verdicts` array; `runAgent` wires the gate pre-append. No existing requirement changes.

## Approach

1. **New package `packages/evidence`**: Self-contained with `src/truth-gate.ts` (classify function + types), `src/types.ts` (verdict types), own `vitest.config.ts`, `tsconfig.json`.
2. **Gate API**: `classifyEnvelope(parsed: EvidenceProvenance, now?: Date): Verdict` returns `{ code, reason, severity }` where code is one of `stale | low_confidence | incomplete | ok`.
3. **Unwrapped results**: `classifyUnwrapped(): Verdict` returns `{ code: 'incomplete', reason: 'no-envelope' }` for null/error/error-shape results.
4. **runAgent integration**: In `packages/agent-core/src/runtime.ts` (~L83-91), before appending the stringified envelope to `messages`, parse it, call `classifyEnvelope`, push verdict to an accumulator. After all tool calls, attach `verdicts[]` to `AgentResult`.
5. **Observe mode**: Verdicts are recorded but never gate the data flow. The LLM receives all results unchanged. Fase C will flip this to strict mode.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/evidence/` | New | New package — TruthGate module, types, tests |
| `packages/agent-core/src/runtime.ts` | Modified | Pre-LLM gate wiring in `runAgent` |
| `packages/agent-core/package.json` | Modified | Add `@ftth-copilot/evidence` dependency |
| `turbo.json` | Modified | Add `packages/evidence` to pipeline |
| `packages/shared/src/contracts.ts` | Unchanged | Reuse existing `EvidenceProvenance` zod schema |
| `openspec/config.yaml` | Modified | Add `packages/evidence` project entry |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| parse failure on malformed JSON string from `executeToolCall` | Low | Wrap in try/catch → classify as `incomplete` |
| `AgentResult` type drift if verdicts field added carelessly | Low | Additive only — optional `verdicts?: Verdict[]`, no existing fields changed |
| Demo/live threshold divergence creep | Low | Single `classifyEnvelope` — no conditional thresholds by mode |

## Rollback Plan

- Remove `packages/evidence/` directory, revert `runAgent` changes (git revert the integration commit), remove package from `turbo.json`. Fase A continues working independently — the gate is a pure add-on.

## Dependencies

- `evidence-provenance.v1` contract (Fase A, already in `packages/shared/src/contracts.ts`)
- `executeToolCall` enrichment (Fase A, already in `packages/agent-core/src/tools/index.ts`)

## Success Criteria

- [ ] `packages/evidence` builds and passes `vitest run` with all classification scenarios
- [ ] `runAgent` attaches `verdicts[]` to `AgentResult` without changing existing test behavior
- [ ] Stale, low_confidence, incomplete, and unwrapped envelopes all produce correct verdicts
- [ ] Missing `confidence` defaults to `low_confidence` verdict
- [ ] Demo and live paths produce identical classification behavior
- [ ] `turbo run test` passes workspace-wide after integration
