# Delta for strict-mode-abstention

## ADDED Requirements (Fase F)

### Requirement: `finalize` consumes `warn` tier via flag-and-log

When `shouldAbstain(verdicts, mode, tenantPolicy?)` returns `'warn'`, `finalize` in `packages/agent-core/src/runtime.ts` MUST emit the flag-and-log observability path: `result.text` stays byte-identical to the LLM text, `result.warnings: VerdictCode[]` is populated from the warn verdicts, exactly one `AgentActionLog` row is written with `toolName === '__injection_suspicion__'` carrying `result.warnings`, and an `injection_suspicion_total` counter for the tenant is incremented by 1. No `abstention.v1` envelope is built and `result.abstained` stays undefined.

#### Scenario: Warn preserves LLM text and writes log

- GIVEN strict mode and verdicts `[stale]`
- WHEN `finalize` runs
- THEN `result.text` equals the LLM text byte-identically, `result.warnings === ['stale']`, AND exactly one `AgentActionLog` row exists with `toolName === '__injection_suspicion__'`

#### Scenario: Warn does not build abstention

- GIVEN strict mode and verdicts `[low_confidence]`
- WHEN `finalize` runs
- THEN `result.abstained === undefined`, `result.abstention === undefined`, AND `buildAbstention` is NOT called

#### Scenario: Default behavior stays byte-identical for `'abstain'`

- GIVEN strict mode and verdicts `[incomplete]`
- WHEN `finalize` runs
- THEN the Fase C path fires unchanged (text replaced, `abstained === true`)

### Requirement: `AgentResult.warnings?: VerdictCode[]`

`AgentResult` and `ChatResponse` MUST gain (additive) optional `warnings?: VerdictCode[]`. No existing field is renamed or removed. `runAgent` MUST populate `warnings` only on the `'warn'` finalize path.

#### Scenario: Warnings present on warn path

- GIVEN strict mode and verdicts `[stale, low_confidence]`
- WHEN `runAgent` returns
- THEN `result.warnings` includes `'stale'` AND `'low_confidence'`

#### Scenario: Warnings absent on allow path

- GIVEN strict mode and verdicts `[ok]`
- WHEN `runAgent` returns
- THEN `result.warnings === undefined`

#### Scenario: Backward compatibility

- GIVEN a pre-Fase-F consumer that does not read `warnings`
- WHEN `runAgent` returns
- THEN existing fields (`text`, `toolCalls`, `verdicts`, `abstention`, `abstained`) stay byte-identical

### Requirement: `AgentActionLog.__injection_suspicion__` row contract

When `finalize` consumes the `warn` tier, the chat route MUST write exactly one `AgentActionLog` row with `toolName === '__injection_suspicion__'` and `result.warnings: VerdictCode[]`. `tenantId`, `conversationId`, `parameters`, `durationMs`, and `createdAt` follow the existing `AgentActionLog` schema.

#### Scenario: Single row per warn

- GIVEN a strict-mode run with verdicts `[stale]`
- WHEN the chat route persists
- THEN exactly one `AgentActionLog` row exists with `toolName === '__injection_suspicion__'` AND `result.warnings === ['stale']`

#### Scenario: Other toolName values unaffected

- GIVEN a strict-mode run with one regular tool call AND verdicts `[stale]`
- WHEN the chat route persists
- THEN the regular tool's `AgentActionLog` row is unchanged AND a separate `__injection_suspicion__` row is appended
