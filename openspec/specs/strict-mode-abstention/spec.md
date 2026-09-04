# Strict Mode Abstention Specification

## Purpose

Asymmetric enforcement on top of Fase B: when evidence is `incomplete`, `runAgent` MUST replace the LLM's text with a structured `abstention.v1` payload. `stale`/`low_confidence` stay warnings. `strict` is default; `observe` is reachable.

## Requirements

### Requirement: Abstention v1 contract

`packages/shared/src/contracts.ts` MUST define `ABSTENTION_SCHEMA = 'ftth.abstention.v1'` and zod `abstentionSchema`: literal `schema`, `reason: VerdictCode`, `severity: VerdictSeverity`, optional `claim`, `missing: string[]`, `available: string[]`, non-empty `nextStep: string`, `toolsAffected: string[]`. Export `Abstention`.

#### Scenario: Valid + invalid coverage

- GIVEN a valid payload AND mutations: wrong `schema` literal, empty `nextStep`, bad `reason`, non-array `missing`
- WHEN `safeParse` runs per case
- THEN valid → `.success === true`; each mutation → `.success === false`; payload without `claim` → accepted

### Requirement: Asymmetric policy map

`packages/evidence/src/abstention-policy.ts` MUST export `shouldAbstain(verdicts, mode): 'abstain' | 'warn' | 'allow'`. Strict: any `incomplete` → `'abstain'`; else any `stale`/`low_confidence` → `'warn'`; else `'allow'`. Observe: always `'allow'`. No source branching.

#### Scenario: Policy table coverage

- GIVEN strict pairs `(incomplete, abstain)`, `(stale, warn)`, `(low_confidence, warn)`, `(ok, allow)` AND observe with any verdict set
- WHEN `shouldAbstain` runs per case
- THEN strict matches each pair; observe returns `'allow'` always

### Requirement: `buildAbstention` derivation

`buildAbstention(verdicts, claim?): Abstention` MUST derive `missing` from distinct `toolName` of incompletes, `available` from distinct `toolName` of `ok`s, `toolsAffected` from distinct `toolName` of non-`ok`s. `reason === 'incomplete'`; `severity` is max across incompletes; `nextStep` from template keyed on dominant `incomplete.reason`.

#### Scenario: Mixed derivation

- GIVEN `[incomplete/get_onu_detail, ok/list_onus]`
- WHEN `buildAbstention` runs
- THEN `missing === ['get_onu_detail']`, `available === ['list_onus']`, `toolsAffected === ['get_onu_detail']`, `reason === 'incomplete'`

#### Scenario: All incompletes

- GIVEN two `incomplete` verdicts (no `ok`)
- WHEN `buildAbstention` runs
- THEN `available === []` and `missing.length === 2`

### Requirement: Spanish `nextStep` templates

`nextStepFor(reason, toolsAffected): string` MUST return deterministic Argentine Rioplatense Spanish (voseo, matching `prompts/system.ts:1-52`). Two templates: `no-envelope`/`parse-error` ("Re-colectá las métricas de {tool} y volvé a consultar."), `partial-completeness`/`minimal-completeness` ("Verificá el identificador de la ONU y solicitá un reintento del NMS."). Snapshot-tested.

#### Scenario: Voseo + tool reference + determinism

- GIVEN `reason: 'no-envelope'`, `toolsAffected: ['get_onu_detail']` invoked twice
- WHEN `nextStepFor` runs
- THEN both outputs are byte-identical, contain a voseo verb, and reference `get_onu_detail`

### Requirement: Strict-mode override in `runAgent`

`RunAgentOptions` MUST accept `mode?: 'strict' | 'observe'` (default `'strict'`). At BOTH return paths, if `mode === 'strict'` AND any verdict has `code === 'incomplete'`, `runAgent` MUST call `buildAbstention`, set `result.abstained = true`, attach `result.abstention`, and replace `result.text` with a Spanish rendering (heading + `missing` bullets + `nextStep`). Otherwise both MUST stay undefined.

#### Scenario: Strict + incomplete replaces text

- GIVEN `mode: 'strict'` (default), verdicts include `incomplete` (any source)
- WHEN `runAgent` returns
- THEN `result.abstained === true`, `result.abstention` defined, `result.text` matches Spanish template (no LLM text)

#### Scenario: Non-abstain paths preserve LLM text

- GIVEN three runs: strict + only `stale`; observe + `incomplete`; observe + mixed verdicts
- WHEN `runAgent` returns
- THEN `result.abstained === undefined`, `result.text` is the LLM's text, `result.verdicts.length` matches the tool-call count

### Requirement: Additive contract fields

`AgentResult` MUST gain (additive) `abstention?: Abstention` and `abstained?: boolean`. `ChatResponse` MUST gain `abstention?: Abstention`. All optional. No existing field renamed or removed.

#### Scenario: Abstention forwarded

- GIVEN strict-mode run with incompletes
- WHEN `runAgent` returns and the route builds `ChatResponse`
- THEN `result.abstained === true`, `result.abstention` valid, `ChatResponse.abstention === result.abstention`

### Requirement: Route persistence of abstention

`apps/web/app/api/chat/route.ts` MUST pass `mode` (default `'strict'`) to `runAgent`. When `result.abstained === true`, persist rendered Spanish text into `Message.content` and append `{ name: '__abstention__', arguments: {}, result: result.abstention }` into `Message.toolCalls` JSON. No Prisma migration.

#### Scenario: Strict persists synthetic row, observe does not

- GIVEN strict + incomplete run AND observe-mode run with incompletes
- WHEN the route persists each assistant message
- THEN strict → `Message.content === result.text` AND `Message.toolCalls` contains `__abstention__` row; observe → `Message.toolCalls` contains NO `__abstention__` row
## ADDED Requirements (Fase D)

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
