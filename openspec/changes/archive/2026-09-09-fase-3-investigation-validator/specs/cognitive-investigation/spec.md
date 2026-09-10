# Spec Delta: Server-Side Investigation Reference & Temporal Validator (Fase 3.4)

## Scenarios (Given/When/Then)

### Scenario: Validate compliant investigation result

Given a valid `InvestigationResult` with evidence references belonging to `tenant-acme`
  and timestamps inside `[windowStart, windowEnd]`
When `validateInvestigationResult` is executed
Then `isValid` is true, `issues` is empty, and `sanitizedResult` preserves all hypotheses and refs.

### Scenario: Detect and prune cross-tenant evidence references

Given an `InvestigationResult` containing an evidence reference tagged with another tenant
When `validateInvestigationResult` is executed
Then `isValid` is false, an issue of type `cross_tenant_evidence` is recorded,
  the foreign reference is removed from `evidenceRefs` and hypothesis citation lists,
  and a missing observation is added to `sanitizedResult`.

### Scenario: Detect and prune out-of-window timestamps

Given an evidence reference with `observedAt` outside the investigation window `[windowStart, windowEnd]`
When `validateInvestigationResult` is executed
Then an issue of type `out_of_window_evidence` is recorded,
  the reference is purged from citations, and `sufficiency` is adjusted to `provisional`.

### Scenario: Detect hallucinated citations in hypotheses

Given a hypothesis citing a `forRefIds` or `againstRefIds` that does not exist in `evidenceRefs`
When `validateInvestigationResult` runs
Then an issue of type `hallucinated_reference` is recorded, the reference is dropped from citations,
  and recorded in `contradictions` or `missing`.

### Scenario: Detect structured numerical contradictions

Given an optical metric reference with `rx_power: -18.0 dBm` (healthy) but a hypothesis claiming
  `Rx: -32.0 dBm` (critical) citing that reference
When `validateInvestigationResult` executes
Then an issue of type `numerical_contradiction` is logged, and a contradiction entry is
  attached to the sanitized result noting the mismatch.

### Scenario: Generate safe fallback envelope on invalid JSON or corrupt structure

Given an unparseable or severely damaged raw object
When `buildSafeFallbackResult` is invoked with context
Then it returns a valid `ftth.investigation-result.v1` envelope with `sufficiency: 'insufficient'`,
  documenting the validation failure in `missing` observations.
