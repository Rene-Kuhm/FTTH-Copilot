# Delta for evidence-provenance

## ADDED Requirements (Fase F)

### Requirement: Fase F does not modify `evidence.provenance.v1`

Fase F MUST NOT add, remove, or rename any field in the `evidence.provenance.v1` envelope. The Fase F warnings channel (`AgentResult.warnings`) MUST NOT enter the envelope, MUST NOT be threaded through `executeToolCall`, and MUST NOT appear as a key on the parsed envelope. The Fase A golden tests in `packages/shared/tests/contracts.test.ts` MUST continue to pass byte-identically.

#### Scenario: Envelope key count unchanged

- GIVEN a `runAgent` invocation that emits a warn
- WHEN `executeToolCall` returns the envelope JSON
- THEN `Object.keys(parsed).length === 8` AND `warnings` is not a key

#### Scenario: Fase A golden tests still pass

- GIVEN the Fase A golden tests in `packages/shared/tests/contracts.test.ts`
- WHEN the suite runs after Fase F merges
- THEN every test passes unchanged (no skipped, no `xit`, no removed cases)

#### Scenario: Warnings live on AgentResult, not envelope

- GIVEN a warn emit
- WHEN `runAgent` returns
- THEN `result.warnings` is set AND `toolCalls[*].result` envelope bytes are byte-identical to the pre-Fase-F shape
