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
