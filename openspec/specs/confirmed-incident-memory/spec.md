# Confirmed Incident Memory Specification

## Purpose

Phase D of the Evidence-First roadmap. Recall prior confirmed incidents as background context (NOT evidence) when the agent responds to new questions. Two confirmation paths (operator + agent) feed a `ConfirmedIncident` knowledge base; `retrieveRelevantIncidents` augments the system prompt pre-LLM via a sparse-first BM25 scorer with RRF plumbing ready for the Phase 2 dense merge. Retrieved items MUST never enter the Truth Gate data path — `evidence.provenance.v1`, `shouldAbstain`, and `abstention.v1` are unchanged.

## Requirements

### Requirement: ConfirmedIncident envelope (`ftth.confirmed-incident.v1`)

`packages/shared` MUST export `CONFIRMED_INCIDENT_SCHEMA = 'ftth.confirmed-incident.v1'` and zod `confirmedIncidentSchema`:

| Field | Type | Validation |
|---|---|---|
| `schema` | literal | `'ftth.confirmed-incident.v1'` |
| `id`, `tenantId`, `deviceId`, `summary`, `rootCause`, `fix`, `sourceTool` | string | non-empty |
| `deviceKind` | enum | `'OLT' \| 'ONU'` |
| `connectionId`, `confirmedByUserId` | string? | optional |
| `score` | number? | `0..1` when present (retrieval-only) |
| `symptoms` | unknown | free JSON |
| `observedAt`, `resolvedAt`, `createdAt`, `updatedAt` | ISO datetime | `z.string().datetime()` |
| `confirmedBy` | enum | `'operator' \| 'agent' \| 'system'` |
| `searchTokens` | string[] | non-empty, lowercased |

A deterministic Spanish `RELEVANT_INCIDENTS_HEADING` constant MUST contain the literal marker "contexto, no evidencia" and the per-incident line format `<YYYY-MM-DD> <deviceKind>/<deviceId> — causa: <rootCause>; fix: <fix> (score: <n.nn>)`. Both MUST be snapshot-tested byte-identically.

#### Scenario: Schema literal rejects v2

- GIVEN a payload with `schema: 'ftth.confirmed-incident.v2'`
- WHEN `confirmedIncidentSchema.safeParse` runs
- THEN `.success === false`

#### Scenario: `score` outside [0,1] rejected

- GIVEN a valid envelope with `score: 1.5`
- WHEN `safeParse` runs
- THEN `.success === false`

#### Scenario: Heading byte-identical

- GIVEN the golden snapshot
- WHEN `RELEVANT_INCIDENTS_HEADING` is compared
- THEN bytes match exactly (including the "contexto, no evidencia" marker)

### Requirement: BM25Lite scorer

`packages/evidence` MUST export `scoreBM25(queryTokens, docTokens, k1=1.5, b=0.75): number`. Tokenization MUST lowercase and match `^[a-záéíóúñ0-9]+$`; MUST drop a locked Spanish stop-word list (≥25 words: `de`, `la`, `el`, `y`, `o`, `en`, `a`, `un`, `una`, `que`, `se`, `no`, `es`, `por`, `con`, `para`, `su`, `del`, `al`, `lo`, `le`, `las`, `los`, `les`, `nos`). MUST return `0` for empty token intersection.

#### Scenario: Stop words dropped

- GIVEN query `["la", "onu", "caída"]`
- WHEN tokenizing
- THEN effective tokens are `["onu", "caída"]` and `score` ignores `la`

#### Scenario: Golden ranking

- GIVEN a fixed 4-document corpus
- WHEN scoring query `["rx", "bajo"]`
- THEN the returned rank order matches the stored golden file

### Requirement: `retrieveRelevantIncidents` pure-TS contract

`packages/evidence` MUST export `retrieveRelevantIncidents({tenantId, query, deviceHint?, limit=5, sinceDays=90, mode='live'})`. The function MUST:

- refuse (throw `MissingTenantError`) when `tenantId` is empty/undefined;
- short-circuit to `[]` when `mode !== 'live'`;
- filter rows where `resolvedAt < now - sinceDays`;
- apply a multiplier `≥1.0` to `rrfScore` when `deviceHint` matches `deviceKind/deviceId`;
- cap output at `limit`;
- drop rows where `rrfScore < MIN_SPARSESCORE`;
- compute `rrfScore = Σ 1 / (RRF_K + rank_i)` with `RRF_K = 60` (plumbing ready for Phase 2 dense list merge).

#### Scenario: Refusal without tenantId

- GIVEN `tenantId: ''`
- WHEN called
- THEN it throws `MissingTenantError`

#### Scenario: Demo short-circuits

- GIVEN 3 matching rows and `mode: 'demo'`
- WHEN called
- THEN result is `[]`

#### Scenario: 90-day window excludes older

- GIVEN rows at `now - 100d` and `now - 30d`
- WHEN called with `sinceDays: 90`
- THEN only the 30d row is returned

#### Scenario: Limit cap and threshold

- GIVEN 10 rows spanning the threshold
- WHEN called with `limit: 5`
- THEN ≤5 rows return and every returned row has `rrfScore ≥ MIN_SPARSESCORE`

#### Scenario: Device hint boost

- GIVEN two rows with identical BM25, one matching `deviceHint`
- WHEN called
- THEN the matching row ranks higher

### Requirement: `PendingIncidentCandidate` persistence

Prisma MUST define `PendingIncidentCandidate { id, tenantId, sourceIncidentId?, summary, toolCallsJson, runSessionId?, proposedConfirmedAt, status: 'pending'|'promoted'|'rejected' }`. The chat route MUST write exactly one row per assistant message when `result.abstained !== true` AND no verdict in `result.verdicts` has `code === 'incomplete'`. MUST write zero rows when `dataSource.mode === 'demo'`.

#### Scenario: Clean run writes one

- GIVEN all verdicts `ok` and `mode: 'live'`
- WHEN the route persists
- THEN one `PendingIncidentCandidate` exists with `status: 'pending'`

#### Scenario: Abstained or incomplete writes zero

- GIVEN `result.abstained === true` OR any verdict `code === 'incomplete'`
- WHEN the route persists
- THEN zero rows are written

#### Scenario: Demo writes zero

- GIVEN `dataSource.mode: 'demo'`
- WHEN the route persists
- THEN zero rows

### Requirement: Pre-LLM system-prompt injection

`RunAgentOptions` MUST add optional `retrievalProvider?: (args) => Promise<RelevantIncident[]>`. When provided AND `dataSource.mode === 'live'`, `runAgent` MUST call it once before the loop and append `RELEVANT_INCIDENTS_HEADING + formatted lines` after `sourcePrompt`. When `mode !== 'live'` OR `retrievalProvider` is undefined OR returns `[]`, the heading MUST NOT appear. Retrieved items MUST never enter the Truth Gate data path: `result.verdicts` and `Message.toolCalls` MUST contain only tool-call rows (plus `__abstention__` when applicable).

#### Scenario: Live injects heading

- GIVEN `mode: 'live'` and provider returns 2 incidents
- WHEN `runAgent` runs
- THEN the system prompt contains `RELEVANT_INCIDENTS_HEADING` + 2 formatted lines

#### Scenario: Demo / empty / missing provider all skip

- GIVEN any of `mode: 'demo'`, provider returns `[]`, or `retrievalProvider: undefined`
- WHEN `runAgent` runs
- THEN the system prompt contains no heading

#### Scenario: Truth Gate untouched

- GIVEN 2 retrieved incidents + 2 tool calls
- WHEN the loop completes
- THEN `result.verdicts.length === 2` AND `Message.toolCalls` contains no retrieved-incident rows

### Requirement: Operator confirmation flow

`POST /api/incidents/[id]/confirm` MUST accept zod body `{rootCause: string.min(1), fix: string.min(1), summary: string.min(1)}`. MUST return `403` when `!hasPermission(user.role, 'view_network')`; `400` on zod failure; `404` when `Incident` not found for `user.tenantId`; `409` when `Incident.status !== 'resolved'`. On `200` MUST write one `ConfirmedIncident` with `confirmedBy: 'operator'`, `confirmedByUserId: user.id` AND one `AgentActionLog` (`toolName: '__operator_confirm__'`). MUST be idempotent: an existing `ConfirmedIncident` for the source `Incident` returns `200` with that row and zero new writes.

#### Scenario: Permission denial

- GIVEN user without `view_network`
- WHEN `POST /confirm` runs
- THEN `403` and zero DB writes

#### Scenario: Zod rejection

- GIVEN body `{rootCause: ''}`
- WHEN `POST /confirm` runs
- THEN `400`

#### Scenario: Happy path writes both rows

- GIVEN a `resolved` Incident, valid body, `view_network` permission
- WHEN `POST /confirm` runs
- THEN one `ConfirmedIncident` AND one `AgentActionLog` (`__operator_confirm__`) exist

#### Scenario: Idempotent re-confirm

- GIVEN an existing `ConfirmedIncident` for the incident
- WHEN `POST /confirm` runs again
- THEN `200` with the existing row; no new row; no new `AgentActionLog`

### Requirement: Agent confirmation flow and promotion

`packages/evidence` MUST export `promotePendingIncidents(now: Date): Promise<{promoted: number}>` that selects candidates whose `Incident.status === 'resolved'` for ≥24h AND whose originating run had no incomplete verdict, then for each writes one `ConfirmedIncident` with `confirmedBy: 'agent'` AND one `AgentActionLog` (`toolName: '__agent_promote__'`). `POST /api/pending-incidents/promote` MUST expose this, requiring `admin` permission.

#### Scenario: 24h gate blocks early promotion

- GIVEN a candidate whose `Incident` resolved 12h ago
- WHEN `promotePendingIncidents` runs
- THEN zero promotions

#### Scenario: Eligible candidate promoted

- GIVEN a candidate whose `Incident` resolved 25h ago with no incomplete verdict
- WHEN `promotePendingIncidents` runs
- THEN one `ConfirmedIncident` (`confirmedBy: 'agent'`) AND one `AgentActionLog` (`__agent_promote__`) exist

### Requirement: Multi-tenant safety

Every code path touching `ConfirmedIncident` MUST take a non-empty `tenantId` and MUST scope every Prisma query by `tenantId`. A refusal-path test MUST assert that empty `tenantId` throws `MissingTenantError` and that cross-tenant reads return `[]`.

#### Scenario: Cross-tenant isolation

- GIVEN rows for `tenantId: 't1'`
- WHEN `retrieveRelevantIncidents` runs with `tenantId: 't2'`
- THEN result is `[]`