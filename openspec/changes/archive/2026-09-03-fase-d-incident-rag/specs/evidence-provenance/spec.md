# Delta for evidence-provenance (Fase D — no-op)

## ADDED Requirements

### Requirement: Fase D does not modify `evidence.provenance.v1`

Fase D (confirmed-incident-memory) MUST NOT add, remove, or rename any field in the `evidence.provenance.v1` envelope or in any consumer contract (`ToolCallRecord`, `AgentResult`, `ChatResponse`). Retrieved incidents are emitted through a separate `ftth.confirmed-incident.v1` contract and a separate `RELEVANT_INCIDENTS_HEADING` system-prompt block; they MUST NOT flow through `executeToolCall` or carry provenance metadata. The existing Fase A golden tests MUST continue to pass without modification.

#### Scenario: Golden tests still pass

- GIVEN the Fase A `evidence.provenance.v1` golden tests
- WHEN the suite runs after Fase D is merged
- THEN every existing test passes unchanged (no skipped, no `xit`, no removed cases)

#### Scenario: Tool-result envelopes unchanged

- GIVEN a tool call after Fase D is merged
- WHEN `executeToolCall` returns
- THEN the returned JSON `safeParse`s against `evidenceProvenanceSchema` and contains no fields derived from retrieved incidents

#### Scenario: Confirmed-incident contract is separate

- GIVEN a payload built by `retrieveRelevantIncidents`
- WHEN `evidenceProvenanceSchema.safeParse` runs
- THEN `.success === false` (the contracts are distinct; retrieved incidents are not provenance-tagged)