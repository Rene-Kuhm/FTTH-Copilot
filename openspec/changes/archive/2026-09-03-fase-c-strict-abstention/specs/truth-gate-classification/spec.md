# Delta for truth-gate-classification

## ADDED Requirements

### Requirement: Mode enforcement on runAgent

`runAgent` in `packages/agent-core/src/runtime.ts` MUST accept `mode?: 'strict' | 'observe'` on `RunAgentOptions` (default `'strict'`). The single classification path MUST remain identical: `TruthGate.classify` / `classifyUnwrapped` continues to produce verdicts with no mode-conditional thresholds. Behavior branches as follows:

- When `mode === 'observe'`: behavior is identical to Fase B — no override; verdicts accumulate on `AgentResult.verdicts`; data reaches the LLM unchanged.
- When `mode === 'strict'` AND any verdict has `code === 'incomplete'`: `runAgent` MUST replace `result.text` with an `abstention.v1` payload (see `strict-mode-abstention`), set `result.abstained = true`, and attach `result.abstention`. The `verdicts` audit trail remains attached.
- When `mode === 'strict'` AND verdicts include `stale` / `low_confidence` only (no `incomplete`): the LLM's text is preserved unchanged; `verdicts` are still attached so the operator sees the warnings.

The single classification path invariant (demo = live) MUST be preserved: no `source`-conditional branching in the abstention policy.

#### Scenario: Observe mode preserves Fase B behavior

- GIVEN `mode: 'observe'`, verdicts including `incomplete`
- WHEN `runAgent` returns
- THEN `result.abstained === undefined`, `result.text` is the LLM's text, `result.verdicts` contains every verdict

#### Scenario: Strict mode abstains on incomplete

- GIVEN `mode: 'strict'`, verdicts include `incomplete`
- WHEN `runAgent` returns
- THEN `result.abstained === true`, `result.abstention` defined, `result.text` matches Spanish template (no LLM text)

#### Scenario: Strict mode allows on stale only

- GIVEN `mode: 'strict'`, verdicts include only `stale`
- WHEN `runAgent` returns
- THEN `result.abstained === undefined`, `result.text` is the LLM's text, `result.verdicts` contains the warnings

#### Scenario: Strict mode allows on low_confidence only

- GIVEN `mode: 'strict'`, verdicts include only `low_confidence`
- WHEN `runAgent` returns
- THEN `result.abstained === undefined`, `result.text` is the LLM's text, `result.verdicts` contains the warnings

#### Scenario: Default mode is strict

- GIVEN `RunAgentOptions` without `mode`
- WHEN `runAgent` runs
- THEN effective mode is `'strict'`

#### Scenario: Single classification path preserved

- GIVEN a demo envelope (source `*.demo`) and a live envelope (source `*.poll`) with identical fields producing `incomplete`
- WHEN `runAgent` runs both with `mode: 'strict'`
- THEN both produce `result.abstained === true` (no source-conditional branch)