# Delta for evidence-provenance

## ADDED Requirements (Fase E)

### Requirement: Per-tenant policy integration does not modify `evidence.provenance.v1`

Fase E MUST thread an optional `tenantPolicy?: TenantPolicy` through `RunAgentOptions` and into the `retrievalProvider` closure, but `tenantPolicy` MUST NEVER enter the `evidence.provenance.v1` envelope and MUST NEVER alter any envelope field (`schema`, `source`, `tenantId`, `observedAt`, `ttlMs`, `completeness`, `confidence`, `data`). The 8-field envelope shape and the Fase A golden tests MUST stay byte-identical. `PROVENANCE_TOOL_META` MAY gain rows for the two new topology tools (`get_topology_path`, `get_downstream_clients`) — they are additive and do not change existing rows.

#### Scenario: Envelope shape unchanged when `tenantPolicy` present

- GIVEN a `runAgent` invocation with `tenantPolicy` set
- WHEN `executeToolCall` returns the envelope JSON
- THEN `Object.keys(parsed).length === 8` AND `tenantPolicy` is not a key

#### Scenario: Fase A golden tests still pass

- GIVEN the Fase A `evidence.provenance.v1` golden tests (9 cases in `packages/shared/tests/contracts.test.ts`)
- WHEN the suite runs after Fase E merges
- THEN every test passes unchanged (no skipped, no `xit`, no removed cases)

#### Scenario: Topology tools carry their own meta, not policy-derived fields

- GIVEN `get_topology_path` executed with `tenantPolicy` set
- WHEN `buildProvenanceEnvelope` runs
- THEN `completeness === 'partial'` AND `confidence === 0.9` (from `PROVENANCE_TOOL_META`), not derived from `tenantPolicy`

#### Scenario: `retrievalProvider` sees policy, envelope does not

- GIVEN a `retrievalProvider` closure receives `tenantPolicy` as a function-scoped variable
- WHEN `retrieveRelevantIncidents(args, tenantPolicy)` runs
- THEN `limit`/`sinceDays` may be overridden per tenant, but the `ConfirmedIncident` rows flowing into the system-prompt block are NOT wrapped in `evidence.provenance.v1` and carry no envelope fields

#### Scenario: `RunAgentOptions.tenantPolicy?` is additive

- GIVEN an existing caller that does not pass `tenantPolicy`
- WHEN `runAgent` runs
- THEN behavior is byte-identical to the pre-Fase-E baseline (Fase D regression net holds)