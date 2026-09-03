# Truth Gate Classification Specification

## Purpose

Pure envelope classification logic for evidence.provenance.v1 tool results. Classifies each envelope by staleness, confidence, and completeness into verdicts (`stale | low_confidence | incomplete | ok`). Observation mode: verdicts are recorded but never gate data flow to the LLM.

## Requirements

### Requirement: Staleness Classification

`TruthGate.classify(envelope)` SHALL evaluate staleness by comparing `now - observedAt` against `ttlMs`. An envelope is `stale` when the elapsed time strictly exceeds `ttlMs` (i.e. `now > observedAt + ttlMs`). Edge equality (`now === observedAt + ttlMs`) is NOT stale. The `now` reference clock MAY be injected for testability.

#### Scenario: Fresh envelope → not stale

- GIVEN envelope with `observedAt` 5 minutes ago, `ttlMs: 900000`
- WHEN classify is called with `now` = 5 minutes after `observedAt`
- THEN verdict code is NOT `stale`

#### Scenario: Stale envelope detected

- GIVEN envelope with `observedAt` 20 minutes ago, `ttlMs: 900000` (15 min)
- WHEN classify is called
- THEN verdict code is `stale` and reason indicates expiration

#### Scenario: Edge equality is not stale

- GIVEN envelope where `now` is exactly `observedAt + ttlMs`
- WHEN classify is called
- THEN verdict code is NOT `stale`

### Requirement: Confidence Classification

`TruthGate.classify(envelope)` SHALL evaluate confidence using fixed thresholds with NO mode-specific behavior. The system SHALL use these ranges: `confidence < 0.3` → `low_confidence`; `confidence >= 0.3` → `ok`. When `confidence` field is absent from the envelope, the system SHALL treat it as `low_confidence`.

#### Scenario: Missing confidence defaults to low_confidence

- GIVEN envelope without `confidence` field (undefined)
- WHEN classify is called
- THEN verdict code is `low_confidence` with reason `missing-confidence`

#### Scenario: Low confidence detected

- GIVEN envelope with `confidence: 0.2`
- WHEN classify is called
- THEN verdict code is `low_confidence`

#### Scenario: Confidence exactly at threshold

- GIVEN envelope with `confidence: 0.3`
- WHEN classify is called
- THEN verdict code is `ok` (threshold is inclusive)

#### Scenario: High confidence passes

- GIVEN envelope with `confidence: 1.0`
- WHEN classify is called
- THEN verdict code is `ok`

### Requirement: Completeness Classification

`TruthGate.classify(envelope)` SHALL evaluate completeness by mapping the `completeness` field: `complete` → `ok`; `partial` and `minimal` → `incomplete`. This mapping is fixed and applies identically in demo and live modes.

#### Scenario: Complete envelope → ok

- GIVEN envelope with `completeness: 'complete'`
- WHEN classify is called
- THEN completeness verdict code is `ok`

#### Scenario: Partial envelope → incomplete

- GIVEN envelope with `completeness: 'partial'`
- WHEN classify is called
- THEN verdict code is `incomplete`

#### Scenario: Minimal envelope → incomplete

- GIVEN envelope with `completeness: 'minimal'`
- WHEN classify is called
- THEN verdict code is `incomplete`

### Requirement: Unwrapped / No-Envelope Path

`TruthGate.classifyUnwrapped()` SHALL return a verdict with code `incomplete` and reason `no-envelope` for results that are not valid envelopes: `null`, `undefined`, error objects, or non-envelope JSON shapes. This covers tool results where `executeToolCall` returned a stringified error instead of an envelope.

#### Scenario: Null result → incomplete

- GIVEN a tool result of `null`
- WHEN classifyUnwrapped is called
- THEN verdict code is `incomplete` with reason `no-envelope`

#### Scenario: Error-shape result → incomplete

- GIVEN a tool result string `{ "error": "..." }`
- WHEN classifyUnwrapped is called
- THEN verdict code is `incomplete`

### Requirement: Verdict Priority

When multiple verdicts apply to a single envelope (e.g. stale AND incomplete), `TruthGate.classify` SHALL return the highest-severity verdict. Severity ordering: `incomplete` > `stale` > `low_confidence` > `ok`. The returned verdict SHALL include `code`, `reason`, and `severity`.

#### Scenario: Stale + incomplete returns incomplete

- GIVEN envelope with `completeness: 'minimal'` and expired TTL
- WHEN classify is called
- THEN verdict code is `incomplete` (higher severity wins)

#### Scenario: Low confidence only

- GIVEN envelope with `confidence: 0.1` and fresh TTL, `completeness: 'complete'`
- WHEN classify is called
- THEN verdict code is `low_confidence`

### Requirement: Observe Mode in runAgent

`runAgent` in `packages/agent-core/src/runtime.ts` SHALL, after executing each tool call, parse the JSON result string and call `TruthGate.classify` (or `classifyUnwrapped` for parse failures). Verdicts SHALL be accumulated per execution. After all tool calls complete, `runAgent` SHALL attach the verdicts array to `AgentResult` via an optional `verdicts` field. The data passed to the LLM SHALL remain unchanged — all tool results reach the model as-is.

#### Scenario: Verdicts recorded without blocking data

- GIVEN a runAgent execution with 3 tool calls
- WHEN all tool calls complete
- THEN `AgentResult.verdicts` contains 3 verdict entries AND `toolCalls` contains all 3 results unchanged

#### Scenario: LLM receives all tool results

- GIVEN a stale envelope returned by a tool
- WHEN runAgent processes the result
- THEN the stale result string is appended to messages for the LLM without modification

### Requirement: Single Classification Path (Demo = Live)

The system SHALL use a single `classifyEnvelope` function with identical thresholds for both demo and live data. There SHALL be no conditional branching on mode for classification logic.

#### Scenario: Demo envelope classified identically

- GIVEN a demo envelope (source ending in `.demo`) with `confidence: 0.5`
- WHEN classify is called
- THEN verdict is `ok` (same result as a live envelope with same fields)

### Requirement: Malformed JSON Graceful Handling

When `runAgent` encounters a tool result string that cannot be parsed as JSON, the system SHALL NOT throw. It SHALL record an `incomplete` verdict with reason `parse-error` and the unparseable string still reaches the LLM.

#### Scenario: Invalid JSON string → incomplete verdict

- GIVEN a tool result that is plain text (not JSON)
- WHEN runAgent attempts classification
- THEN verdict code is `incomplete` with reason `parse-error` AND the text is still passed to the LLM

### Requirement: Turbo Integration

The `packages/evidence` package MUST be registered in `turbo.json` pipeline so that `turbo run test` and `turbo run typecheck` include it workspace-wide.

#### Scenario: Workspace test passes

- GIVEN the workspace with `packages/evidence` added
- WHEN `turbo run test` is executed
- THEN `packages/evidence` tests run and pass alongside all other packages


## ADDED Requirements (Fase C)


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

## Key Learnings

1. The `evidenceProvenanceSchema` makes `confidence` optional, so the gate must handle its absence without throwing.
2. Staleness uses strict-greater-than comparison; edge equality (now === observedAt + ttlMs) means NOT stale.
3. Severity ordering determines which verdict wins when multiple conditions are true simultaneously.
4. Observe mode is additive — the optional `verdicts` field on AgentResult does not break existing consumers.
