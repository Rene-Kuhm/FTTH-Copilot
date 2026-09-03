# Delta for strict-mode-abstention

## ADDED Requirements (Fase E)

### Requirement: Per-tenant `abstainOnCodes` knob extends `shouldAbstain` decision set

`packages/evidence/src/abstention-policy.ts` MUST extend `shouldAbstain(verdicts, mode, tenantPolicy?)` with a 3rd optional argument. When `tenantPolicy.abstainOnCodes` is `undefined`, behavior is Fase C byte-identical (strict mode + any `incomplete` → `'abstain'`). When `tenantPolicy.abstainOnCodes` is defined (possibly empty), the decision set becomes that array: any verdict whose `code` is in the array triggers `'abstain'`; no other code does. An empty array `[]` MUST mean "never abstain" (the per-tenant override disables the gate). No other policy field (`retrievalLimit`, `retrievalSinceDays`, `promotionMinAgeMs`, `truthGateMode`) enters `shouldAbstain`. The `abstention.v1` envelope schema, the Spanish `nextStep` templates, the `Mode: 'strict' | 'observe'` default, and the `__abstention__` synthetic tool-call row MUST stay byte-identical to the Fase C baseline.

#### Scenario: `undefined` keeps Fase C behavior

- GIVEN `tenantPolicy = undefined` AND `mode: 'strict'` AND one verdict `{code: 'incomplete'}`
- WHEN `shouldAbstain(verdicts, 'strict', undefined)` runs
- THEN returns `'abstain'` (Fase C byte-identical)

#### Scenario: Empty array disables the gate

- GIVEN `tenantPolicy.abstainOnCodes: []` AND one `incomplete` verdict
- WHEN `shouldAbstain(verdicts, 'strict', policy)` runs
- THEN returns `'allow'` (per-tenant override turns abstention off for this tenant)

#### Scenario: Single-code override triggers on that code only

- GIVEN `tenantPolicy.abstainOnCodes: ['stale']`
- WHEN `shouldAbstain(verdicts, 'strict', policy)` runs with one `stale` AND one `incomplete` verdict
- THEN returns `'abstain'` (because `stale` is in the override set)

#### Scenario: Other codes do not trigger

- GIVEN `tenantPolicy.abstainOnCodes: ['stale']` AND one `low_confidence` verdict (no `stale`, no `incomplete`)
- WHEN `shouldAbstain(verdicts, 'strict', policy)` runs
- THEN returns `'warn'` (per Fase C symmetric policy); the `low_confidence` verdict is not in the override set

#### Scenario: Explicit `incomplete` is the default-allowed scenario

- GIVEN `tenantPolicy.abstainOnCodes: ['incomplete']` (the same set Fase C uses implicitly)
- WHEN `shouldAbstain(verdicts, 'strict', policy)` runs with one `incomplete` verdict
- THEN returns `'abstain'` AND the resulting `abstention.v1` envelope is byte-identical to the Fase C envelope for the same verdict set

#### Scenario: Observe mode ignores the override

- GIVEN `mode: 'observe'` AND `tenantPolicy.abstainOnCodes: ['stale']`
- WHEN `shouldAbstain(verdicts, 'observe', policy)` runs
- THEN returns `'allow'` (Fase B/C observe invariant preserved)

#### Scenario: `abstention.v1` and templates unchanged

- GIVEN a strict-mode run with `tenantPolicy.abstainOnCodes: ['stale']` and one `stale` verdict
- WHEN `buildAbstention` runs and the Spanish `nextStepFor('incomplete', toolsAffected)` is invoked
- THEN the envelope matches the Fase C schema AND the rendered Spanish text uses the same voseo templates (`IDENTIFIER_NEXTSTEP` / `METRICS_NEXTSTEP`)