# Archive Report: fase-d-incident-rag

**Date**: 2026-09-03
**Status**: archived
**Mode**: openspec (hybrid-ready: engram memory recorded separately)
**Branch**: `feat/fase-d-incident-rag`

## Change Summary

Fase D — Confirmed Incident Memory + Hybrid RAG (sparse-first): ships
two confirmation paths (operator + agent) that feed a `ConfirmedIncident`
knowledge base; sparse-first BM25 over pre-computed `searchTokens`
ranks top-5 within a 90-day window, scoped per tenant. `RRF_K = 60`
plumbing is in place for the Phase 2 dense merge without schema change.
`evidence.provenance.v1`, `shouldAbstain`, and `abstention.v1` are
unchanged — retrieved items flow through a separate
`ftth.confirmed-incident.v1` envelope and an explicit
"contexto, no evidencia" system-prompt block.

## Outcome

- **Verdict**: PASS (0 CRITICAL, 0 WARNING)
- **Specs synced**: 1 created + 2 additive appends
- **Tests**: 616 passed / 0 failed / 0 skipped — workspace-wide
- **Build**: OK (`turbo run build` exit 0)
- **Typecheck**: OK (`turbo run typecheck` exit 0; 15/15)
- **SDD cycle**: complete

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `confirmed-incident-memory` | **Created** | Full spec promoted to `openspec/specs/confirmed-incident-memory/spec.md` (8 requirements, 23 scenarios) — mechanical `cp`, `diff -r` empty |
| `evidence-provenance` | **Extended (additive)** | New `## ADDED Requirements (Fase D)` section appended (1 requirement, 3 scenarios): `Fase D does not modify evidence.provenance.v1`. No Fase A/B/C content removed or renamed. |
| `strict-mode-abstention` | **Extended (additive)** | New `## ADDED Requirements (Fase D)` section appended (1 requirement, 3 scenarios): `Fase D does not modify abstention.v1 or strict-mode override behavior`. No Fase C content removed or renamed. |

## Archive Contents

- `proposal.md` ✅
- `specs/confirmed-incident-memory/spec.md` ✅ (delta — promoted to canonical)
- `specs/evidence-provenance/spec.md` ✅ (delta — merged into canonical)
- `specs/strict-mode-abstention/spec.md` ✅ (delta — merged into canonical)
- `design.md` ✅
- `tasks.md` ✅ (15/15 implementation tasks marked `[x]`; Phase 7 7.1–7.2 closed by this work)
- `verify-report.md` ✅

## Source of Truth Updated

- `openspec/specs/confirmed-incident-memory/spec.md` — new canonical spec for the sparse-first confirmed-incident memory capability
- `openspec/specs/evidence-provenance/spec.md` — extended with the additive `Fase D does not modify evidence.provenance.v1` requirement + 3 scenarios
- `openspec/specs/strict-mode-abstention/spec.md` — extended with the additive `Fase D does not modify abstention.v1` requirement + 3 scenarios
- `packages/evidence/README.md` — updated with a new "Confirmed-incident memory + hybrid retrieval (Fase D)" section: `BM25Lite` + stop-words, `retrieveRelevantIncidents` args contract, `RRF_K = 60` plumbing, `RELEVANT_INCIDENTS_HEADING` literal, `formatRelevantIncidentsBlock` line format, `buildPendingIncidentCandidate` builder + `promotePendingIncidents(now)` helper, opt-in rollback playbook (drop both tables + revert retrievalProvider)

## Task Completion Gate

All 15 implementation tasks (Phase D-1 1.1–1.3, D-2 2.1–2.4, D-3 3.1–3.2, D-4 4.1–4.2, D-5 5.1, D-6 6.1–6.2) marked `[x]` in `tasks.md`. Phase D-7 (verify + docs + archive) is closed by this archive operation. No stale unchecked tasks. No exceptional reconciliation performed.

## Verification Summary

| Metric | Value |
|--------|-------|
| Requirements | 8/8 new compliant (`confirmed-incident-memory`) + 2/2 additive (`evidence-provenance`, `strict-mode-abstention`) |
| Scenarios | 23/23 new compliant (confirmed-incident-memory) + 6/6 additive (3+3 in the two no-op deltas) |
| Tests | 616 passed / 0 failed / 0 skipped — workspace-wide |
| Build | OK (`turbo run build` exit 0; new routes `/api/incidents/[id]/confirm` + `/api/pending-incidents/promote` in manifest) |
| Typecheck | OK (`turbo run typecheck` exit 0; 15/15 packages) |
| `@ftth-copilot/evidence:test` | 122 passed (incl. `bm25-lite.test.ts` + `relevant-incidents.test.ts` + `pending-incident.test.ts` + Fase B/C regression) |
| `@ftth-copilot/agent-core:test` | 104 passed (incl. `runtime.test.ts` retrieval-provider injection + Truth-Gate untouched) |
| `@ftth-copilot/shared:test` | 61 passed (incl. `confirmedIncidentSchema` + `pendingIncidentCandidateSchema` contracts) |
| `@ftth-copilot/web:test` | 32 passed (incl. `incidents-confirm` 9 + `pending-incidents-promote` 3 + `promote-pending-incidents` 6 + Fase C `chat-abstention` 8 + WU3 `chat-rag` 6) |
| CRITICALs | 0 |
| WARNINGs | 0 |

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
6. **Fase D-6.1 golden fixtures** — the original task description referenced `packages/evidence/tests/fixtures/relevant-incidents-{heading,block-2}.golden.txt` for the existing heading snapshot, but those were already byte-locked inline in `relevant-incidents.test.ts` (commit `e2e31b3`, Fase WU2). The new WU4 work adds `apps/web/tests/fixtures/{incidents-confirm-201,pending-incidents-promote-200}.golden.json` for the new HTTP response shapes; both committed.

## Final-State Facts

- **Apply**: 15/15 tasks, 7 new commits on `feat/fase-d-incident-rag` after PRs #64 (WU1), #65 (WU2), #66 (WU3) merged:
  - `7c97a0d` feat(web): POST /api/incidents/:id/confirm with view_network gate + idempotency + audit
  - `9fa7ce4` feat(web): IncidentsPanel "Marcar como confirmado" action for resolved incidents
  - (merge commit for D-5.1) feat(web): POST /api/pending-incidents/promote (OWNER-only) with eligibleForPromotion gating
  - `534e149` test(web): snapshot fixtures + Playwright e2e for operator confirm flow
  - `1b164a7` docs(sdd): fase-d-incident-rag verify report — PASS
  - `915c36a` docs(sdd): archive fase-d-incident-rag and promote confirmed-incident-memory spec
- **Verify**: PASS — 616 tests, 0 warnings, 0 critical findings; evidence-revision `sha256:280f1d8435b780cc9dedff8feca1f1912df266dba42d8ecbbaf3ecb2cda612ee`
- **Verify-report**: 1 commit (`1b164a7`); 166 lines; YAML envelope + markdown body
- **Tests reported are the final counts from `turbo run test --force`** (616 passed), not an intermediate snapshot

## Forward Note for Fase E (per-tenant policy + telemetry)

The Fase D gate is **single-tenant, single-decision**: every OWNER promotion runs `promotePendingIncidents(now)` with one policy. The 24h gate is global. The Spanish `RELEVANT_INCIDENTS_HEADING` is one fixed block. Fase E should:

1. **Per-tenant promotion policy** — `eligibleForPromotion(candidate, sourceIncident, now, hasIncomplete, tenantPolicy?)` accepting an override map per tenant (e.g. shorter gates for high-traffic tenants, longer for cautious ones). Policy would live next to the `ConnectorResolution` config and survive the same env-var override mechanism.
2. **Telemetry sink** — when a promotion fires, mirror `{ tenantId, candidateId, promotedAt, confirmedIncidentId }` to a sink (Fase F candidates: Postgres `promotion_event` table, OpenTelemetry span, webhooks). This enables calibration: which tenants self-confirm vs rely on agent promotion, how often candidates age past 24h, how often `eligibleForPromotion` blocks candidates.
3. **Lightweight nightly cron** — the admin route is fine for human-driven promotion; for SOCs with many tenants, a cron-driven equivalent (same helper, no HTTP gate) would close the gap. The helper is already injectable (`now: Date`) so a cron can pin the wall clock per run.
4. **Embedding plumbing** — `ConfirmedIncident.embedding: Bytes?` is reserved for Phase 2 pgvector. When Fase E ships the dense list, `retrieveRelevantIncidents` will merge via `RRF_K = 60` with the existing sparse rank — no schema change required.
5. **Operator confirm UX** — current modal forces the operator to re-type `summary` (defaulted from incident title). Fase E could let the operator pick from a `ConfirmedIncident`-template library, or auto-suggest the `rootCause` / `fix` from the originating `toolCallsJson` rows.
6. **Promotion undo** — once a candidate is `promoted`, the only way to revert is `DELETE FROM confirmed_incidents WHERE id = ?`. Fase E should expose an `/api/confirmed-incidents/:id` DELETE route, OWNER-only, with the same audit-row discipline.
7. **Re-examine the 24h gate** — initial conservative default. Once telemetry is in place, recalibrate against real distribution data and consider per-tenant defaults.

No design changes are required to the `ConfirmedIncident` envelope or `promotePendingIncidents` signature itself; both already carry everything needed. The only structural extension needed for Fase E is an optional `tenantPolicy?` parameter on `promotePendingIncidents`, applied inside `eligibleForPromotion` only when a tenant override is supplied.

## Mechanical Copy Readback (audit trail)

```text
# confirmed-incident-memory promotion (Step 2)
$ diff -r openspec/changes/fase-d-incident-rag/specs/confirmed-incident-memory/spec.md \
          openspec/specs/confirmed-incident-memory/spec.md
(empty — byte-identical; cp succeeded on first attempt)

# evidence-provenance merge (Step 2 — additive, not byte-identical by design)
Source:  openspec/changes/fase-d-incident-rag/specs/evidence-provenance/spec.md  (24 lines added)
Target:  openspec/specs/evidence-provenance/spec.md                              (256 + 24 = 280 lines, +24)
Merge:   +1 requirement ("Fase D does not modify evidence.provenance.v1") + 3 scenarios appended under a new "## ADDED Requirements (Fase D)" section
         All Fase A/B/C requirements/scenarios preserved verbatim.

# strict-mode-abstention merge (Step 2 — additive, not byte-identical by design)
Source:  openspec/changes/fase-d-incident-rag/specs/strict-mode-abstention/spec.md  (25 lines added)
Target:  openspec/specs/strict-mode-abstention/spec.md                                (89 + 25 = 114 lines, +25)
Merge:   +1 requirement ("Fase D does not modify abstention.v1 or strict-mode override behavior") + 3 scenarios appended under a new "## ADDED Requirements (Fase D)" section
         All Fase C requirements/scenarios preserved verbatim.

# change folder archive move (Step 3)
$ diff -r openspec/changes/fase-d-incident-rag openspec/changes/archive/2026-09-03-fase-d-incident-rag
(empty — byte-identical; git mv succeeded on first attempt)
```

## SDD Cycle Complete

The change has been fully planned, designed, specified, implemented, verified, and archived. The sparse-first RAG is live: operator confirms write through `POST /api/incidents/:id/confirm`; agent candidates are promoted by `POST /api/pending-incidents/promote`; the chat route injects the heading pre-LLM via the new `retrievalProvider` hook; retrieved rows never enter the Truth Gate. All Fase A/B/C contracts preserved byte-identical. Ready for Fase E.