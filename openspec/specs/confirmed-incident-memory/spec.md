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
## ADDED Requirements (Fase E)

### Requirement: Per-tenant `promotionMinAgeMs` and retrieval knobs extend eligibility + retrieval

`packages/evidence/src/pending-incident.ts` MUST extend `eligibleForPromotion(candidate, sourceIncident, now, hasIncomplete, tenantPolicy?)` with a 5th optional argument. `promotionMinAgeMs` MUST resolve as `tenantPolicy.promotionMinAgeMs ?? PROMOTION_MIN_AGE_MS` (24h baseline). `packages/evidence/src/relevant-incidents.ts` MUST extend `retrieveRelevantIncidents(args, tenantPolicy?)` with a 2nd optional argument. `limit` MUST resolve as `args.limit ?? tenantPolicy.retrievalLimit ?? DEFAULT_LIMIT`; `sinceDays` MUST resolve as `args.sinceDays ?? tenantPolicy.retrievalSinceDays ?? DEFAULT_SINCE_DAYS`. Absent `tenantPolicy` → Fase D byte-identical behavior. The `ConfirmedIncident` envelope (`ftth.confirmed-incident.v1`), the `RELEVANT_INCIDENTS_HEADING` Spanish block, the `PendingIncidentCandidate` write gate (`result.abstained !== true` AND no `incomplete` verdict), and the `promotePendingIncidents(now)` helper signature extension MUST remain compatible with the Fase D baseline. Fase D archive forward-note §1 pre-approved this shape.

#### Scenario: Absent `tenantPolicy` = Fase D 24h gate

- GIVEN `tenantPolicy = undefined` AND incident resolved 25h ago AND `hasIncomplete: false`
- WHEN `eligibleForPromotion(c, src, now, false, undefined)` runs
- THEN returns `true` (Fase D byte-identical)

#### Scenario: Tenant-specific 60 000 ms = 1 minute gate

- GIVEN `tenantPolicy.promotionMinAgeMs: 60_000` AND incident resolved 30s ago
- WHEN `eligibleForPromotion(c, src, now, false, policy)` runs
- THEN returns `false`

#### Scenario: Tenant-specific 259 200 000 ms = 72 h gate

- GIVEN `tenantPolicy.promotionMinAgeMs: 259_200_000` AND incident resolved 25h ago
- WHEN `eligibleForPromotion(c, src, now, false, policy)` runs
- THEN returns `false`

#### Scenario: `promotionMinAgeMs = 0` allows immediate

- GIVEN `tenantPolicy.promotionMinAgeMs: 0` AND incident resolved 1s ago
- WHEN `eligibleForPromotion(c, src, now, false, policy)` runs
- THEN returns `true`

#### Scenario: Per-tenant retrieval limit overrides `DEFAULT_LIMIT`

- GIVEN `tenantPolicy.retrievalLimit: 10` AND `args.limit: undefined` AND 12 candidate rows above `MIN_SPARSESCORE`
- WHEN `retrieveRelevantIncidents(args, policy)` runs
- THEN output length `≤ 10` (not 5)

#### Scenario: Per-tenant retrieval window overrides `DEFAULT_SINCE_DAYS`

- GIVEN `tenantPolicy.retrievalSinceDays: 30` AND `args.sinceDays: undefined` AND rows at `now - 60d` and `now - 10d`
- WHEN called
- THEN only the `now - 10d` row is returned (the 60d row is outside the 30d window)

#### Scenario: Args win over tenant policy

- GIVEN `tenantPolicy.retrievalLimit: 10` AND `args.limit: 3` AND 12 candidate rows
- WHEN called
- THEN output length `≤ 3` (caller's arg wins)

#### Scenario: `promotePendingIncidents(now, policyLoader?)` batched load

- GIVEN 10 eligible candidates across 4 tenants
- WHEN `promotePendingIncidents(now)` runs
- THEN at most one `prisma.tenantPolicy.findMany({where: {tenantId: {in: [...]}}})` call fires; per-candidate policy lookup is `O(1)` from the populated `Map<tenantId, TenantPolicy>`

#### Scenario: Pending-candidate write gate stays Fase D

- GIVEN a clean (non-abstained, no `incomplete` verdict) live run
- WHEN the chat route persists
- THEN exactly one `PendingIncidentCandidate` row is written, regardless of `tenantPolicy` presence (the write gate is unaffected by Fase E)

#### Scenario: Confirmed-incident envelope unchanged

- GIVEN an operator confirm or agent promotion
- WHEN the `ConfirmedIncident` row is built
- THEN the envelope matches `ftth.confirmed-incident.v1` byte-identically; `tenantPolicy` is not a field on the envelope

#### Scenario: `RELEVANT_INCIDENTS_HEADING` byte-identical

- GIVEN the Fase D golden snapshot
- WHEN `RELEVANT_INCIDENTS_HEADING` is read after Fase E merges
- THEN bytes match exactly (including the "contexto, no evidencia" marker)
## ADDED Requirements (Fase F)

### Requirement: `verdict_log` Prisma model + zod contract

Prisma MUST define `verdict_log { id, tenantId, messageId, conversationId, toolName, code, severity, observedAt }` with `@@index([tenantId, observedAt])`. `packages/shared` MUST export `verdictLogEntrySchema` (zod) mirroring the columns. The verdict log MUST be the v1 persistence surface for `AgentResult.verdicts`; Fase 2 MAY consolidate into `Message.verdicts Json?` but v1 MUST keep the table separate.

#### Scenario: Schema validation rejects empty tenantId

- GIVEN an entry with `tenantId: ''`
- WHEN `verdictLogEntrySchema.safeParse` runs
- THEN `.success === false`

#### Scenario: Severity follows VerdictSeverity enum

- GIVEN an entry with `severity: 'unknown'`
- WHEN the schema parses
- THEN `.success === false` (severity is `ok | info | warning | critical`)

### Requirement: Verdict log write gate

When `runAgent` returns a result with non-empty `verdicts`, the chat route MUST write one `verdict_log` row per verdict. Each row MUST carry the `tenantId`, `conversationId`, and `messageId` of the persisted assistant message. No `Message` schema change is required: the verdict log is the v1 persistence surface.

#### Scenario: One row per verdict

- GIVEN a run with two tool calls and verdicts `[ok, stale]`
- WHEN the chat route persists
- THEN exactly two `verdict_log` rows exist for that `messageId`

#### Scenario: Correlation keys present

- GIVEN any `verdict_log` row
- WHEN read
- THEN `tenantId`, `messageId`, and `conversationId` are all non-empty

### Requirement: Backfill via recompute (no envelope schema change)

Historical messages MAY be backfilled into `verdict_log` by a recompute job that iterates `Message.toolCalls[*].result` and re-runs `TruthGate.classify` / `classifyUnwrapped` on each entry. The job MUST NOT modify `Message.toolCalls[*].result` bytes; the envelope schema stays byte-identical.

#### Scenario: Recompute fills missing rows

- GIVEN a `Message` whose `toolCalls[*].result` contains an envelope AND no matching `verdict_log` rows
- WHEN the recompute job runs
- THEN `verdict_log` gains one row per tool call AND `Message.toolCalls[*].result` bytes are unchanged

#### Scenario: Recompute is idempotent

- GIVEN `verdict_log` already contains rows for a `messageId`
- WHEN the recompute job runs again
- THEN no new rows are written for that `messageId`
