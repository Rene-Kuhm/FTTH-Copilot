# Delta for confirmed-incident-memory

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
