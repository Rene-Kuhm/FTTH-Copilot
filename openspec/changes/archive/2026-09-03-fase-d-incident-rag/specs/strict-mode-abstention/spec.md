# Delta for strict-mode-abstention (Fase D — no-op)

## ADDED Requirements

### Requirement: Fase D does not modify `abstention.v1` or strict-mode override behavior

Fase D MUST NOT change `shouldAbstain`, `buildAbstention`, `abstentionSchema`, the Spanish `nextStep` templates, the `Mode: 'strict' | 'observe'` default, or the `__abstention__` synthetic tool-call row. The `PendingIncidentCandidate` write condition `result.abstained !== true` AND no verdict `code === 'incomplete'` MUST reuse the existing strict-mode verdict set verbatim — Fase D MUST NOT introduce new verdict codes or new abstain triggers. Retrieved incidents MUST NOT influence whether the run abstains.

#### Scenario: Existing abstention scenarios still pass

- GIVEN the Fase C `strict-mode-abstention` regression tests (strict + incomplete → abstain; strict + only stale → preserve text; observe + incomplete → preserve text)
- WHEN the suite runs after Fase D is merged
- THEN every existing scenario passes unchanged

#### Scenario: Retrieved incidents do not trigger abstention

- GIVEN a strict-mode run with retrieved incidents present and all tool verdicts `ok`
- WHEN `runAgent` returns
- THEN `result.abstained === undefined`, `result.abstention === undefined`, and `result.text` is the LLM's text

#### Scenario: Candidate write uses the existing verdict set

- GIVEN the chat route after Fase D is merged
- WHEN the candidate-write gate runs
- THEN it reads `result.verdicts` and checks `code === 'incomplete'` exactly — no new verdict codes are introduced by Fase D