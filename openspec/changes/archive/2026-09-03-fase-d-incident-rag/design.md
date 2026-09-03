# Design: Fase D — Confirmed Incident Memory + Hybrid RAG (sparse-first)

## Technical Approach

Additive retrieval layer that augments the LLM system prompt with prior confirmed incidents as **background context (NOT evidence)**. Two confirmation paths (operator + agent) write to a new `ConfirmedIncident` table; sparse BM25 over pre-computed `searchTokens` ranks top-5 within a 90-day window, scoped per tenant. RRF plumbing (`RRF_K = 60`) is in place for Phase 2 dense merge without schema change. Truth Gate (`evidence.provenance.v1`, `shouldAbstain`) untouched — retrieved items flow through a separate `ftth.confirmed-incident.v1` envelope and an explicit "contexto, no evidencia" system-prompt block.

## Architecture Decisions

| # | Choice | Alternative considered | Rationale |
|---|--------|------------------------|-----------|
| 1 | Sparse-first BM25 (no pgvector in v1) | Dense embeddings via pgvector | Defer paid/managed deps; `searchTokens` + BM25 hits the spec's stated quality bar with zero infra cost. RRF plumbing keeps Phase 2 additive. |
| 2 | `retrievalProvider?: (args) => Promise<RelevantIncidentResult[]>` injected by the route | Direct DB call inside `runAgent` | Keeps `@ftth-copilot/agent-core` DB-free; tests inject a stub; route owns tenant scoping and connector readiness. Matches the existing `predictionProvider` precedent (`runtime.ts:34`). |
| 3 | Heading + block concatenated after `sourcePrompt`, never inside the tool loop | Augment `result.text` post-loop | Pre-LLM injection only — retrieved items cannot be confused with tool-call outputs, so the Truth Gate's data path is byte-identical. |
| 4 | Operator confirm requires `view_network`; admin promotion requires OWNER role (admin-only) | New `confirm_incident` permission | No role/permission-table churn for Phase D; OWNER/ADMIN already have the blast radius for a destructive write. Add `confirm_incident` in Fase E if non-admins need it. |
| 5 | `searchTokens` pre-computed at write time (not on read) | Tokenize on read | Read latency budget is small (top-5); write path has the human-readable fields anyway. Locks the tokenizer + stop-word list at write, so later BM25 parameter changes don't retroactively re-rank history. |
| 6 | `PendingIncidentCandidate` written by the route, promoted by an admin route | Cron / background worker | No scheduler exists in this repo today; admin-triggered promotion is the smallest surface that proves the gate, and the spec keeps "nightly" as a follow-up. |
| 7 | `RELEVANT_INCIDENTS_HEADING` + line format exported as constants, snapshot-locked | Build the string inline | Same template-locking pattern as `formatAbstentionText` (`runtime.ts:73`) and `formatIdentifierNextStep` (`abstention-policy.ts:36`). Byte-identical snapshots are the regression net. |

## Data Flow

```
 user message
     │
     ▼
 POST /api/chat (route.ts)
     │
     ├── getCurrentUser  → hasPermission('chat')
     ├── resolveTenantConnector  → { dataSource.mode: 'live' | 'demo' }
     ├── retrieveRelevantIncidents({ tenantId, query, deviceHint?, limit=5, sinceDays=90, mode })
     │      │
     │      ├── Prisma ConfirmedIncident.findMany
     │      │      where: tenantId = ?, resolvedAt >= now - 90d
     │      ├── tokenize(query) ∩ tokenize(searchTokens[i]) → BM25 score
     │      ├── deviceHint boost  → rrfScore *= (1 + 0.25) when match
     │      ├── cap at limit, drop rows with rrfScore < MIN_SPARSESCORE
     │      └── return RelevantIncidentResult[] (or [] when mode === 'demo')
     │
     ├── runAgent({ ..., retrievalProvider: () => results })
     │      │
     │      ├── if mode === 'live' AND retrievalProvider AND results.length > 0:
     │      │      system = SYSTEM_PROMPT + sourcePrompt + RELEVANT_INCIDENTS_HEADING
     │      │             + formatRelevantIncidentsBlock(results)
     │      ├── (else: system unchanged)
     │      ├── llm.createMessage → loop over toolCalls → finalize(verdicts, mode)
     │      └── return AgentResult (verdicts/toolCalls contain NO retrieved rows)
     │
     ├── if result.abstained !== true AND !verdicts.some(v => v.code === 'incomplete'):
     │      prisma.pendingIncidentCandidate.create({ tenantId, runSessionId, ... })
     │
     └── 200 { reply, toolsUsed, conversationId, dataSource, abstention }
```

Operator flow (independent):

```
 OPERATOR clicks "Marcar como confirmado" (IncidentsPanel)
     │
     ▼
 POST /api/incidents/:id/confirm { rootCause, fix, summary }
     │
     ├── hasPermission('view_network')  → 403 otherwise
     ├── zod(body)                       → 400 otherwise
     ├── prisma.incident.findFirst({ id, tenantId, status: 'resolved' })
     │      → 404 if missing, 409 if status !== 'resolved'
     ├── prisma.confirmedIncident.findFirst({ sourceIncidentId })  → idempotent return
     └── prisma.confirmedIncident.create({ confirmedBy: 'operator', confirmedByUserId })
            + prisma.agentActionLog.create({ toolName: '__operator_confirm__' })
```

Admin promotion:

```
 ADMIN POST /api/pending-incidents/promote
     │
     ├── role === 'OWNER'  → 403 otherwise
     ├── promotePendingIncidents(now):
     │      candidates = pending where Incident.status='resolved'
     │                    AND Incident.resolvedAt <= now - 24h
     │                    AND toolCallsJson has no 'incomplete' verdict
     │      for each: ConfirmedIncident.create({ confirmedBy: 'agent' })
     │                 + AgentActionLog.create({ toolName: '__agent_promote__' })
     └── 200 { promoted: number }
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/evidence/src/bm25-lite.ts` | Create | Pure-TS BM25 scorer; exports `scoreBM25`, `BM25_STOPWORDS`, `TOKEN_REGEX`, `tokenize(text)`. k1=1.5, b=0.75. |
| `packages/evidence/src/relevant-incidents.ts` | Create | `retrieveRelevantIncidents`, `formatRelevantIncidentsBlock`, `RELEVANT_INCIDENTS_HEADING`, `MissingTenantError`, `RRF_K = 60`, `MIN_SPARSESCORE`. |
| `packages/evidence/src/pending-incident.ts` | Create | `buildPendingIncidentCandidate(args)` helper — pure constructor; DB write happens in the route. |
| `packages/evidence/src/index.ts` | Modify | Re-export `bm25-lite`, `relevant-incidents`, `pending-incident`; add `MissingTenantError` to the public surface. |
| `packages/evidence/tests/bm25-lite.test.ts` | Create | Stop-word drop; empty intersection → 0; golden 4-doc corpus ranking. |
| `packages/evidence/tests/relevant-incidents.test.ts` | Create | Refusal, demo short-circuit, 90-day window, limit/threshold, deviceHint boost, cross-tenant isolation, cold start. |
| `packages/evidence/tests/pending-incident.test.ts` | Create | Constructor shape + status default. |
| `packages/evidence/README.md` | Modify | Fase D section. |
| `packages/shared/src/contracts.ts` | Modify | Add `CONFIRMED_INCIDENT_SCHEMA = 'ftth.confirmed-incident.v1'`, `confirmedIncidentSchema`, `pendingIncidentCandidateSchema`. |
| `packages/shared/src/index.ts` | Modify | Re-export new schemas + types. |
| `packages/db/prisma/schema.prisma` | Modify | Add `ConfirmedIncident`, `PendingIncidentCandidate`, `ConfirmedBy` enum, indexes `(tenantId, deviceKind, deviceId)`, `(tenantId, resolvedAt)`, `(tenantId, connectionId)`. |
| `packages/db/prisma/migrations/<ts>_confirmed_incidents/migration.sql` | Create | Manual `CREATE TABLE` + `CREATE INDEX` (same style as `20260821080000_add_incidents/migration.sql`). |
| `packages/agent-core/src/runtime.ts` | Modify | Add `retrievalProvider?: (args) => Promise<RelevantIncidentResult[]>` to `RunAgentOptions`; between `sourcePrompt` construction (L173) and the LLM loop (L179), if `mode==='live'` AND `retrievalProvider` AND results.length>0, append heading + block. New `RelevantIncidentResult` import from `@ftth-copilot/shared`. |
| `packages/agent-core/src/agent-core.test.ts` | Modify | Prompt contains heading iff conditions; Truth-Gate untouched; demo skips. |
| `apps/web/app/api/chat/route.ts` | Modify | After `resolveTenantConnector` (L116), call `retrieveRelevantIncidents` (gated on `mode==='live'`), pass as `opts.retrievalProvider = () => Promise.resolve(results)` to `runAgent`; after the assistant message is persisted, when `result.abstained !== true` AND no verdict `code==='incomplete'`, write one `PendingIncidentCandidate`. |
| `apps/web/tests/api/chat-rag.test.ts` | Create | Retrieval call wired; candidate write gate (clean/abstained/incomplete/demo); system prompt is forwarded verbatim into `runAgent`. |
| `apps/web/app/api/incidents/[id]/confirm/route.ts` | Create | POST handler. Zod body; `view_network` gate; status=resolved check; idempotent on `sourceIncidentId`; writes ConfirmedIncident + AgentActionLog (`__operator_confirm__`). |
| `apps/web/app/api/pending-incidents/promote/route.ts` | Create | POST handler. OWNER-only; calls `promotePendingIncidents`. |
| `apps/web/tests/api/incidents-confirm.test.ts` | Create | 403/400/404/409/success/idempotency. |
| `apps/web/tests/api/pending-incidents-promote.test.ts` | Create | Success promotes; rejects still-open Incident. |
| `apps/web/components/IncidentsPanel.tsx` | Modify | "Marcar como confirmado" button + modal (rootCause, fix, summary) gated on `view_network` AND `incident.status === 'resolved'`. |
| `apps/web/e2e/incidents-confirm.spec.ts` | Create | Playwright flow: open resolved incident → modal → submit → row visible. |
| `apps/web/lib/auth/permissions.ts` | Modify | Document that `OWNER` is the only admin promoter (no new permission in this phase). |

## Interfaces / Contracts

```ts
// packages/shared/src/contracts.ts
export const CONFIRMED_INCIDENT_SCHEMA = 'ftth.confirmed-incident.v1' as const;
export const confirmedIncidentSchema = z.object({
  schema: z.literal(CONFIRMED_INCIDENT_SCHEMA),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  deviceKind: z.enum(['OLT', 'ONU']),
  deviceId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
  sourceIncidentId: z.string().min(1).optional(),
  sourceTool: z.string().min(1),
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  fix: z.string().min(1),
  symptoms: z.unknown(),
  observedAt: z.string().datetime(),
  resolvedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  confirmedBy: z.enum(['operator', 'agent', 'system']),
  confirmedByUserId: z.string().min(1).optional(),
  searchTokens: z.array(z.string().min(1)).min(1),
  score: z.number().min(0).max(1).optional(), // retrieval-only
}).strict();
export type ConfirmedIncident = z.infer<typeof confirmedIncidentSchema>;

export const pendingIncidentCandidateSchema = z.object({
  schema: z.literal('ftth.pending-incident-candidate.v1'),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  sourceIncidentId: z.string().min(1).optional(),
  runSessionId: z.string().min(1).optional(),
  summary: z.string().min(1),
  toolCallsJson: z.unknown(),
  proposedConfirmedAt: z.string().datetime(),
  status: z.enum(['pending', 'promoted', 'rejected']),
}).strict();
export type PendingIncidentCandidate = z.infer<typeof pendingIncidentCandidateSchema>;

export type RelevantIncidentResult = ConfirmedIncident & { score: number };
```

```ts
// packages/evidence/src/relevant-incidents.ts
export const RRF_K = 60 as const;
export const MIN_SPARSESCORE = 0.05;
export const DEFAULT_LIMIT = 5;
export const DEFAULT_SINCE_DAYS = 90;
export class MissingTenantError extends Error {}

export const RELEVANT_INCIDENTS_HEADING =
  '## Incidentes previos relevantes (contexto, no evidencia)\n\n' +
  '(Estos son contexto de la historia del ISP; no los cites como evidencia de la medición actual.)\n\n';

export function retrieveRelevantIncidents(args: {
  tenantId: string;
  query: string;
  deviceHint?: { deviceKind: 'OLT' | 'ONU'; deviceId: string };
  limit?: number;
  sinceDays?: number;
  mode?: 'live' | 'demo';
  now?: Date;
}): Promise<RelevantIncidentResult[]>;

export function formatRelevantIncidentsBlock(incidents: RelevantIncidentResult[]): string;
// line: "[N] YYYY-MM-DD — {deviceId} {summary}. Causa raíz: {rootCause}. Fix: {fix}. Score: {score.toFixed(2)}\n"
```

```ts
// packages/agent-core/src/runtime.ts (additive)
export interface RunAgentOptions {
  // … existing fields …
  retrievalProvider?: (args: {
    tenantId: string;
    query: string;
  }) => Promise<RelevantIncidentResult[]>;
}
```

## Spanish templates (snapshot-locked at design time)

| Constant | Value (bytes) |
|----------|---------------|
| `RELEVANT_INCIDENTS_HEADING` | `"## Incidentes previos relevantes (contexto, no evidencia)\n\n(Estos son contexto de la historia del ISP; no los cites como evidencia de la medición actual.)\n\n"` |
| `formatRelevantIncidentsBlock` line | `"[N] YYYY-MM-DD — {deviceId} {summary}. Causa raíz: {rootCause}. Fix: {fix}. Score: {score.toFixed(2)}\n"` (N is 1-indexed) |

**Locked Spanish stop-word list (`BM25_STOPWORDS`, ~30 words actually appearing in operator chat text):**
`a, al, algo, ante, antes, como, con, contra, de, del, desde, donde, durante, el, en, entre, es, esa, ese, esta, este, fue, ha, hasta, la, las, le, les, lo, los, más, me, mi, mis, mucho, muy, nada, ni, no, nos, nuestra, nuestras, nuestro, nuestros, o, os, otra, otro, otros, para, pero, poco, por, porque, que, quien, se, sea, ser, si, sido, sin, sobre, son, su, sus, también, tanto, te, tu, tus, un, una, unas, unos, vosotras, vosotros, vuestro, y, ya, yo`.

**Trimmed ~30-word core used by `scoreBM25` (others remain available for the future Phase 2 tokenizer swap):**
`a, al, con, de, del, el, en, es, la, las, lo, los, más, me, mi, mis, no, nos, o, para, pero, por, que, se, sin, sobre, su, un, una, y`. The full list above is exported as `BM25_STOPWORDS_FULL` for Phase 2 to extend without lock churn; `BM25_STOPWORDS` (the trimmed set) is what `tokenize()` drops today.

**Tokenizer regex:** `/^[a-záéíóúñ0-9]+$/` (lowercased input). Multi-character runs split on whitespace + Unicode punctuation.

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit (`packages/evidence`) | BM25Lite golden ranking + stop-word drop + empty intersection | `tests/bm25-lite.test.ts` — 4-doc corpus golden file committed at `tests/fixtures/bm25-golden.json` |
| Unit | `retrieveRelevantIncidents` — refusal, demo, window, cap, threshold, deviceHint, cross-tenant | `tests/relevant-incidents.test.ts` — Prisma stub via `vi.mock('@ftth-copilot/db')` (same pattern as `apps/web/tests/api/chat-abstention.test.ts`) |
| Unit | `pendingIncidentCandidate` shape | `tests/pending-incident.test.ts` |
| Unit | `formatRelevantIncidentsBlock` + heading | Snapshot equality vs inline literal (matches `abstention-policy.test.ts:295-305` pattern) |
| Integration (`packages/agent-core`) | `runAgent` injects heading iff conditions; Truth Gate untouched | Inject `retrievalProvider` returning 2 rows; assert `system` field passed to `llm.createMessage` contains heading + 2 lines; assert `result.toolCalls` contains no retrieved rows; assert `result.verdicts.length === toolCalls.length` |
| Integration (`apps/web/tests/api`) | Chat route wires retrieval; candidate-write gate | `tests/api/chat-rag.test.ts` — mock `runAgent` + Prisma, assert `runAgent` was called with `retrievalProvider`, assert candidate created only on clean+live |
| Integration | `/api/incidents/:id/confirm` — 403/400/404/409/success/idempotent | `tests/api/incidents-confirm.test.ts` |
| Integration | `/api/pending-incidents/promote` — success + still-open rejection | `tests/api/pending-incidents-promote.test.ts` |
| E2E | Operator confirm flow | `apps/web/e2e/incidents-confirm.spec.ts` — Playwright: open resolved incident → click "Marcar como confirmado" → submit → row visible |
| Regression | Fase A/B/C golden tests untouched | Run `turbo run test typecheck` workspace-wide after merge |

## Threat Matrix

`N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Fase D is in-process TypeScript additions, HTTP route additions, and Prisma DDL. Auth is enforced via the existing `hasPermission` + `getCurrentUser` helpers (same trust boundary as Fase C).`

## Migration / Rollout

**Schema migration:** `packages/db/prisma/migrations/<ts>_confirmed_incidents/migration.sql` (manual, like every prior migration). Adds two tables + one enum + three composite indexes. **Additive — no destructive change.** Down migration: `DROP TABLE pending_incident_candidates; DROP TABLE confirmed_incidents; DROP TYPE "ConfirmedBy";`.

**Feature rollout:**
1. Migration applied at deploy time. No backfill (`ConfirmedIncident` starts empty; cold-start returns `[]`).
2. `runAgent` `retrievalProvider` is **optional** — until the route wires it, the augmentation is a no-op. Existing callers (tests, dashboards) unaffected.
3. UI button is feature-flagged: if `/api/incidents/:id/confirm` returns 404 (e.g. route not deployed), the button's `fetch` fails silently and the modal does not appear.

**Rollback:** drop both tables via down migration; remove `retrievalProvider` call sites in route + tests; revert the `runtime.ts` block. Retrieval is opt-in; no Fase A/B/C behavior changes.

## Open Questions

- [ ] None. All Phase D decisions confirmed in the prompt.
