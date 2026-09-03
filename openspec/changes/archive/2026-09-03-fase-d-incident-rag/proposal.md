# Proposal: Fase D — Confirmed Incident Memory + Hybrid RAG (sparse-first)

## Intent

Enable the agent to recall prior confirmed incidents as background context (NOT evidence) when responding to new questions. Ship a sparse-first hybrid RAG over a new `ConfirmedIncident` knowledge base; lay the data foundation for Fase E (per-tenant policy) and Fase F (eval corpus) without widening scope. Retrieved incidents augment the system prompt pre-LLM and MUST NOT enter the evidence Truth-Gate path.

## Scope

### In Scope
- `ConfirmedIncident` + `PendingIncidentCandidate` Prisma models + `ConfirmedBy` enum + composite indexes `(tenantId, deviceKind, deviceId)`, `(tenantId, resolvedAt)`, `(tenantId, connectionId)`; manual migration
- `ftth.confirmed-incident.v1` zod contract (retrieval-result shape) in `packages/shared`
- Pure-TS `BM25Lite` + `retrieveRelevantIncidents({tenantId, query, deviceHint, limit})` (sparse-only v1; RRF `k=60` plumbing ready for Phase 2 dense merge)
- Pre-LLM augmentation in `runAgent` via `RunAgentOptions.retrievalProvider?`; Spanish `## Incidentes previos relevantes (contexto, no evidencia)` block; demo parity (`dataSource.mode === 'live'` only)
- Operator confirm: `POST /api/incidents/:id/confirm` with `view_network` gate; zod-validated `{rootCause, fix, summary}`; writes `ConfirmedIncident` + `AgentActionLog` row (`toolName: '__operator_confirm__'`)
- Agent candidate flow: chat route writes `PendingIncidentCandidate` when non-abstained AND no `incomplete` verdict; nightly/admin promotion → `ConfirmedIncident` after `Incident.status === 'resolved' for ≥ 24h`
- `IncidentsPanel` UI action "Marcar como confirmado" for `resolved` incidents
- Tests: BM25 golden ranking, tenant-isolation refusal, 90-day window, demo parity, permission denial, zod rejection, audit-row creation

### Out of Scope
- pgvector / dense embeddings (Fase D Phase 2)
- Per-tenant thresholds, topology graph, role-aware presentation (Fase E)
- Prompt-injection defense, eval harness, abstention telemetry (Fase F)
- Fase B threshold re-tuning; new `nextStep` templates; demo/live branching in new code

## Capabilities

### New Capabilities
- `incident-confirmed-rag`: ConfirmedIncident + PendingIncidentCandidate models, BM25Lite + retrieveRelevantIncidents, operator confirm route + UI, agent candidate flow + nightly promotion, system-prompt augmentation block, permission + tenant gating

### Modified Capabilities
- None — augmentation is additive in the system prompt; Truth Gate data path unchanged

## Approach

Two confirmation paths, one retrieval path:

| Path | Trigger | Writes | Audit |
|------|---------|--------|-------|
| Operator | `POST /api/incidents/:id/confirm` (resolved, view_network) | `ConfirmedIncident` | `AgentActionLog` `__operator_confirm__` |
| Agent | non-abstained run + no `incomplete` verdict | `PendingIncidentCandidate` → nightly promote after ≥24h resolved | `runSessionId` link |

Retrieval runs after `resolveTenantConnector`, before `runAgent`. Top-K=5, window=90d, sparse BM25 over pre-computed `searchTokens`. Retrieval REQUIRES `tenantId` and refuses otherwise. Block carries explicit "contexto, no evidencia" header marking retrieved items as background context; snapshot-locked for golden tests.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/db/prisma/schema.prisma` | New | ConfirmedIncident + PendingIncidentCandidate + ConfirmedBy + indexes |
| `packages/db/prisma/migrations/<ts>_confirmed_incidents/` | New | Manual migration |
| `packages/shared/src/contracts.ts` | Modified | `CONFIRMED_INCIDENT_SCHEMA` + zod |
| `packages/evidence/src/{bm25-lite,relevant-incidents,pending-incident,index}.ts` | New | Scorer + retrieval + candidate builder + re-exports |
| `packages/evidence/tests/{bm25-lite,relevant-incidents}.test.ts` | New | Ranking, tenant refusal, 90-day window, demo parity |
| `packages/agent-core/src/runtime.ts` + tests | Modified | `RunAgentOptions.retrievalProvider?`; inject block at ~L178 |
| `apps/web/app/api/chat/route.ts` | Modified | Call retrieveRelevantIncidents; write PendingIncidentCandidate |
| `apps/web/app/api/incidents/[id]/confirm/route.ts` | New | POST + permission + zod + audit |
| `apps/web/components/IncidentsPanel.tsx` | Modified | "Marcar como confirmado" action |
| `apps/web/tests/api/{chat-rag,incidents-confirm}.test.ts` + `apps/web/e2e/incidents-confirm.spec.ts` | New | Persistence, permission, audit, Playwright flow |
| `packages/evidence/README.md` | Modified | Fase D section |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Retrieved context leaks into evidence path | Med | Header `contexto, no evidencia`; retrieval pre-LLM only; Truth Gate unchanged; tests assert augmentation vs envelope separation |
| Multi-tenant leak via missing tenantId | Low | Signature requires `tenantId`; explicit refusal-path test; route injects from `user.tenantId` |
| Over-eager agent confirmation promotes bad rows | Low | Gate: non-abstained + no `incomplete` + ≥24h resolved; nightly idempotent; manual admin route |
| Spanish template drift across phases | Low | Reuse voseo from `prompts/system.ts:1-52`; snapshot tests |

## Rollback Plan

Drop the two new tables via down migration; remove `retrievalProvider` call sites (route + tests); revert `runtime.ts` augmentation block. `ConfirmedBy` enum + indexes are additive (no destructive schema change). UI button is feature-flagged: confirm route 404 → button hides. Pre-Fase-D consumers unaffected; confirmed memory is opt-in via retrieval.

## Dependencies

- Fase A `evidence.provenance.v1` envelope — augmented, not changed
- Fase B `Verdict`, severity ordering — reused for candidate gating
- Fase C `shouldAbstain` (default `'strict'`) — candidate write runs only when NOT abstained
- Existing `AgentActionLog` (audit reuse)
- Postgres 16 service container in CI; **no paid deps, no LLM API keys, no pgvector**

## Success Criteria

- [ ] Retrieval returns top-5; tenant-isolation test refuses cross-tenant query; 90-day window excludes older rows
- [ ] System-prompt augmentation block appears iff `dataSource.mode === 'live'` AND retrieval returns >0 results; snapshot-locked
- [ ] Operator confirm returns 403 without `view_network`, 400 on invalid zod; persists ConfirmedIncident + AgentActionLog row
- [ ] Agent candidate written iff non-abstained AND no `incomplete` verdict; promotion gated on ≥24h resolved
- [ ] `turbo run test typecheck` workspace-wide green; CI uses no paid services and no LLM API keys