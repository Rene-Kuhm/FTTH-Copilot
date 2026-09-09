# Spec Delta: Cognitive Investigation Engine & Deterministic Facts (Fase 3.3)

## Scenarios (Given/When/Then)

### Scenario: Compute deterministic facts from evidence references

Given an array of `InvestigationEvidenceRef` containing optical metrics, events, and topology
When `computeInvestigationFacts` is executed
Then it returns structured facts with optical power min/max/delta, event counts (dying-gasp, LOS),
  and topology common elements, without invoking an LLM.

### Scenario: Identify optical degradation deterministically

Given optical metric references showing Rx optical power drop from -19.0 dBm to -28.5 dBm
When `computeInvestigationFacts` is executed
Then `facts.optical` flags critical attenuation (< -27 dBm) and records a delta > 9 dBm.

### Scenario: LLM returns hypotheses with valid citations

Given a list of collected evidence refs and a functional `LlmClient`
When `investigateIncident` executes
Then the resulting `InvestigationResult` contains hypotheses whose `forRefIds` and `againstRefIds`
  point exclusively to provided `evidenceRefId`s, and matches `ftth.investigation-result.v1`.

### Scenario: Hallucinated evidence citations are safely pruned

Given an LLM response referencing an `evidenceRefId` not present in the input evidence
When `investigateIncident` sanitizes the response
Then the non-existent reference is removed from `forRefIds`/`againstRefIds`,
  and recorded in `contradictions` or `missing` rather than crashing the envelope.

### Scenario: Unallowed check kinds (e.g. reboot/provision) are rejected or coerced

Given an LLM response suggesting a check with `kind: 'reboot'` or `kind: 'provision'`
When `investigateIncident` parses and coerces the checks
Then forbidden kinds are sanitized or mapped to safe read-only kinds (`observe_only`),
  maintaining compliance with Roadmap Regla 8.

### Scenario: LLM failure or malformed JSON falls back to deterministic provisional envelope

Given an `LlmClient` that throws a network error or returns non-JSON text
When `investigateIncident` executes
Then it returns a valid `InvestigationResult` with `sufficiency: 'provisional'` or `'insufficient'`,
  documenting the LLM failure in `missing` observations without throwing unhandled exceptions.

### Scenario: Window boundary validation

Given `windowEnd` earlier than `windowStart` or `windowDays` exceeding 30 days
When `investigateIncident` is invoked
Then it throws an explicit validation error before executing facts or LLM calls.
