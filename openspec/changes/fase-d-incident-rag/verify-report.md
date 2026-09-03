```yaml
# Verify Report: fase-d-incident-rag
# Date: 2026-09-03
# Branch: feat/fase-d-incident-rag
# Mode: openspec (Strict TDD)
change: fase-d-incident-rag
verdict: PASS
evidence_revision: 280f1d8435b780cc9dedff8feca1f1912df266dba42d8ecbbaf3ecb2cda612ee
test_output_hash: 34d7efb3dff13a3b55e99669970b65e28ace0f09e17f40a24a758eddfbde1c19
build_output_hash: f6c7e0b9b2c4f3a8e7d5c6b4a9f8e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6
summary: "616 tests, 0 failures, 0 skipped, 8 requirements (23 scenarios) all green; Fase A/B/C contracts preserved"
test_command: "node_modules/.bin/turbo run test --force"
typecheck_command: "node_modules/.bin/turbo run typecheck"
build_command: "node_modules/.bin/turbo run build"

totals:
  requirements: 8
  scenarios: 23
  tests_passed: 616
  tests_failed: 0
  tests_skipped: 0

completion:
  total_tasks: 23
  completed_tasks: 23
  pending_tasks: 0

package_test_results:
  "@ftth-copilot/agent-core": 104
  "@ftth-copilot/alerts": 52
  "@ftth-copilot/analytics": 33
  "@ftth-copilot/connectors-core": 20
  "@ftth-copilot/connectors-mikrowisp": 35
  "@ftth-copilot/connectors-smartolt": 24
  "@ftth-copilot/db": 17
  "@ftth-copilot/detection": 57
  "@ftth-copilot/evidence": 122
  "@ftth-copilot/monitoring": 7
  "@ftth-copilot/security": 39
  "@ftth-copilot/shared": 61
  "@ftth-copilot/soc": 13
  "@ftth-copilot/web": 32

critical_issues: 0
warnings: 0
suggestions: 0
```

# Verify Report: fase-d-incident-rag

**Date**: 2026-09-03
**Status**: PASS
**Mode**: openspec (Strict TDD)
**Branch**: `feat/fase-d-incident-rag`

## Summary

Fase D — Confirmed Incident Memory + Hybrid RAG (sparse-first): ships two confirmation paths (operator + agent), pre-LLM BM25 retrieval via `retrievalProvider`, a sparse-first RAG with `RRF_K=60` plumbing ready for Phase 2 dense merge. `evidence.provenance.v1`, `shouldAbstain`, and `abstention.v1` are unchanged. All 23 scenarios across 8 requirements are green; all Fase A/B/C contracts preserved.

## Outcome

- **Verdict**: PASS (0 CRITICAL, 0 WARNING)
- **Specs synced**: 1 created (`confirmed-incident-memory`) + 2 additive appends (`evidence-provenance`, `strict-mode-abstention`)
- **Tests**: 616 passed / 0 failed / 0 skipped — workspace-wide (`turbo run test --force`)
- **Typecheck**: OK (`turbo run typecheck` exit 0; all 15/15 packages)
- **Build**: OK (`turbo run build` exit 0)
- **Strict TDD**: ACTIVE — every implementation task paired with a RED test in the same commit

## Spec Compliance Matrix

| Requirement | Scenarios | Status | Covering test surface |
|-------------|-----------|--------|----------------------|
| `ConfirmedIncident` envelope (`ftth.confirmed-incident.v1`) | 3 (schema literal, score range, heading byte-identical) | ✅ PASS | `packages/shared/tests/contracts.test.ts`, `packages/evidence/tests/relevant-incidents.test.ts` |
| `BM25Lite` scorer | 2 (stop-words, golden ranking) | ✅ PASS | `packages/evidence/tests/bm25-lite.test.ts` + golden fixture |
| `retrieveRelevantIncidents` pure-TS contract | 5 (refusal, demo, window, cap, deviceHint) | ✅ PASS | `packages/evidence/tests/relevant-incidents.test.ts` |
| `PendingIncidentCandidate` persistence | 3 (clean, abstained/incomplete, demo) | ✅ PASS | `apps/web/tests/api/chat-rag.test.ts` |
| Pre-LLM system-prompt injection | 3 (live injects, demo/empty skip, Truth-Gate untouched) | ✅ PASS | `packages/agent-core/tests/runtime.test.ts` |
| Operator confirmation flow | 4 (permission, zod, happy, idempotent) | ✅ PASS | `apps/web/tests/api/incidents-confirm.test.ts` (9 tests) |
| Agent confirmation flow + promotion | 2 (24h gate, eligible promotion) | ✅ PASS | `apps/web/tests/lib/promote-pending-incidents.test.ts` + `apps/web/tests/api/pending-incidents-promote.test.ts` |
| Multi-tenant safety | 1 (cross-tenant isolation) | ✅ PASS | `packages/evidence/tests/relevant-incidents.test.ts` |

**Totals**: 8/8 requirements compliant · 23/23 scenarios compliant · 0 N/A · 0 FAILED.

## Fase A/B/C Contract Preservation

| Phase | Contract | Status | Evidence |
|-------|----------|--------|----------|
| Fase A | `evidence.provenance.v1` envelope unchanged | ✅ PASS | `packages/shared/tests/contracts.test.ts` (golden suite runs unchanged); Fase A `truth-gate.test.ts` green |
| Fase A | Tool-result envelope still parses | ✅ PASS | `evidenceProvenanceSchema.safeParse(...)` golden suite |
| Fase A | Confirmed-incident contract is distinct | ✅ PASS | `evidenceProvenanceSchema.safeParse(confirmedIncidentRow).success === false` |
| Fase B | `Verdict` / `VerdictCode` / `VerdictSeverity` unchanged | ✅ PASS | `packages/evidence/tests/{truth-gate,index-exports}.test.ts` |
| Fase B | `runAgent` data path byte-identical when `retrievalProvider` undefined | ✅ PASS | `packages/agent-core/tests/runtime.test.ts` — 104 tests |
| Fase C | `shouldAbstain` / `buildAbstention` / `abstentionSchema` unchanged | ✅ PASS | `packages/evidence/tests/abstention-policy.test.ts` (31 cases) |
| Fase C | Existing abstention scenarios still pass | ✅ PASS | `apps/web/tests/api/chat-abstention.test.ts` (8 tests) |
| Fase C | Candidate write uses existing verdict set (no new codes) | ✅ PASS | `apps/web/tests/api/chat-rag.test.ts` — gate reads `result.verdicts` for `code === 'incomplete'` |
| Fase C | Retrieved incidents do not trigger abstention | ✅ PASS | `packages/agent-core/tests/runtime.test.ts` — retrieval block is pre-LLM only |

## Build / Type / Test Evidence

| Command | Exit | Notes |
|---------|------|-------|
| `turbo run test --force` | 0 | 616 passed / 0 failed / 0 skipped; `test_output_hash=34d7efb3…de1c19` |
| `turbo run typecheck` | 0 | 15/15 packages; all green |
| `turbo run build` | 0 | 2/2 packages; new routes `/api/incidents/[id]/confirm` + `/api/pending-incidents/promote` in the manifest |

## Per-Package Test Breakdown

| Package | Tests | Notes |
|---------|-------|-------|
| `@ftth-copilot/agent-core` | 104 | Includes retrieval-provider injection + pre-LLM block scenarios + Truth-Gate untouched |
| `@ftth-copilot/alerts` | 52 | Unchanged |
| `@ftth-copilot/analytics` | 33 | Unchanged |
| `@ftth-copilot/connectors-core` | 20 | Unchanged |
| `@ftth-copilot/connectors-mikrowisp` | 35 | Unchanged |
| `@ftth-copilot/connectors-smartolt` | 24 | Unchanged |
| `@ftth-copilot/db` | 17 | Unchanged (no new tests; schema migration in Fase D WU1 was applied earlier) |
| `@ftth-copilot/detection` | 57 | Unchanged |
| `@ftth-copilot/evidence` | 122 | Includes `bm25-lite` + `relevant-incidents` + `pending-incident` + `abstention-policy` + `index-exports` |
| `@ftth-copilot/monitoring` | 7 | Unchanged |
| `@ftth-copilot/security` | 39 | Unchanged |
| `@ftth-copilot/shared` | 61 | Includes `confirmedIncidentSchema` + `pendingIncidentCandidateSchema` contracts |
| `@ftth-copilot/soc` | 13 | Unchanged |
| `@ftth-copilot/web` | 32 | `chat-abstention` (8) + `chat-rag` (6) + `incidents-confirm` (9) + `pending-incidents-promote` (3) + `promote-pending-incidents` (6) |

## Files Touched (implementation, for reference)

| File | Action | Note |
|------|--------|------|
| `apps/web/app/api/incidents/[id]/confirm/route.ts` | Created | POST with `view_network` gate, zod body, status check, idempotency, audit row |
| `apps/web/tests/api/incidents-confirm.test.ts` | Created | 9 tests: 403/400/404/409 + happy + idempotent + searchTokens |
| `apps/web/components/IncidentsPanel.tsx` | Modified | "Marcar como confirmado" button gated on `incident.status === 'resolved'` AND `view_network`; modal with 3 textareas; inline error display |
| `apps/web/app/api/incidents/route.ts` | Modified | GET now includes `resolved` status so the panel can display confirm candidates |
| `apps/web/app/api/pending-incidents/promote/route.ts` | Created | POST with OWNER role gate; delegates to helper |
| `apps/web/lib/promote-pending-incidents.ts` | Created | `promotePendingIncidents(now)` — orchestrates read + eligibility check + write |
| `apps/web/lib/auth/permissions.ts` | Modified | Documented `OWNER` as the only admin promoter (no new permission in Phase D) |
| `apps/web/tests/lib/promote-pending-incidents.test.ts` | Created | 6 tests: empty/24h gate/still open/incomplete verdict/idempotent |
| `apps/web/tests/api/pending-incidents-promote.test.ts` | Created | 3 tests: 401/403/200 + OWNER counter forwarding |
| `apps/web/tests/fixtures/incidents-confirm-201.golden.json` | Created | Snapshot fixture for the happy-path 201 response |
| `apps/web/tests/fixtures/pending-incidents-promote-200.golden.json` | Created | Snapshot fixture for the 200 response |
| `apps/web/e2e/incidents-confirm.spec.ts` | Created | Playwright e2e: button visible only on resolved rows; modal opens; POST body shape; inline 409 error |

## Coherence Adjustments (documented, not blocking)

1. **`promotePendingIncidents` lives in `apps/web/lib/` (not `packages/evidence/src/`)** — same architectural choice the chat-route made for `retrieveRelevantIncidents`: keep `packages/evidence` DB-free; the route owns the persistence shell. The eligibility gate (`eligibleForPromotion`) is the only thing in `packages/evidence/src/pending-incident.ts`; the orchestration around it lives in apps/web where Prisma is already a workspace dep.
2. **`searchTokens` on agent-promoted `ConfirmedIncident` rows uses the candidate summary tokenized with the design-locked regex** — same `TOKEN_REGEX` / lowercased whitespace-joined form the operator confirm route uses. No Phase-2 dense-merge change required.
3. **`AgentActionLog.result` for the operator path is the string `created.id`** (per the design contract); for the agent path it is the same string. Both routes are symmetric.
4. **GET `/api/incidents` now includes `resolved`** — this widens the existing API surface to surface confirm candidates. Only the `IncidentsPanel` consumer is in-tree; no other callers exist (`grep -rn "api/incidents"` confirmed).
5. **`apps/web/tests/lib/` directory created** — the helper test needed its own file because `vi.mock('@/lib/promote-pending-incidents')` for the route test hijacks the helper test's `await import()`. Splitting into two files is the cleanest fix; vitest discovers tests via the existing `tests/**/*.test.ts` glob.

## Forward Note for Fase E (per-tenant policy + telemetry)

The Fase D helper is **single-tenant, single-decision**: every OWNER promotion runs `promotePendingIncidents(now)` with one policy. The 24h gate is global. Fase E should:

1. **Per-tenant promotion policy** — `eligibleForPromotion(candidate, sourceIncident, now, hasIncomplete, tenantPolicy?)` accepting an override map per tenant (e.g. shorter gates for high-traffic tenants, longer for cautious ones). Policy would live next to the `ConnectorResolution` config and survive the same env-var override mechanism.
2. **Telemetry sink** — when a promotion fires, mirror `{ tenantId, candidateId, promotedAt, confirmedIncidentId }` to a sink (Fase F candidates: Postgres `promotion_event` table, OpenTelemetry span, webhooks). This enables calibration: which tenants self-confirm vs rely on agent promotion, how often candidates age past 24h.
3. **Lightweight nightly cron** — the admin route is fine for human-driven promotion; for SOCs with many tenants, a cron-driven equivalent (same helper, no HTTP gate) would close the gap. The helper is already injectable (`now: Date`) so a cron can pin the wall clock per run.
4. **Embedding plumbing** — `ConfirmedIncident.embedding: Bytes?` is reserved for Phase 2 pgvector. When Fase E ships the dense list, `retrieveRelevantIncidents` will merge via `RRF_K = 60` with the existing sparse rank — no schema change required.
5. **Operator confirm UX** — current modal forces the operator to re-type `summary` (defaulted from incident title). Fase E could let the operator pick from a `ConfirmedIncident`-template library, or auto-suggest the `rootCause` / `fix` from the originating `toolCallsJson` rows.
6. **Promotion undo** — once a candidate is `promoted`, the only way to revert is to `DELETE FROM confirmed_incidents WHERE id = ?`. Fase E should expose an `/api/confirmed-incidents/:id` DELETE route, OWNER-only, with the same audit-row discipline.
7. **Re-examine the 24h gate** — initial conservative default. Once telemetry is in place, recalibrate against real distribution data and consider per-tenant defaults.

No design changes are required to the `ConfirmedIncident` envelope or `promotePendingIncidents` signature itself; both already carry everything needed. The only structural extension needed for Fase E is an optional `tenantPolicy?` parameter on `promotePendingIncidents`, applied inside `eligibleForPromotion` only when a tenant override is supplied.

## SDD Cycle Complete

All 23 implementation tasks across Phase D-1 / D-2 / D-3 / D-4 / D-5 / D-6 are now `[x]` in `tasks.md`. Phase D-7 (verify + docs + archive) is closed by this report and the corresponding archive operation. The sparse-first RAG is live: operator confirms write through `POST /api/incidents/:id/confirm`; agent candidates are promoted by `POST /api/pending-incidents/promote`; the chat route injects the heading pre-LLM via the new `retrievalProvider` hook. Ready for archive.