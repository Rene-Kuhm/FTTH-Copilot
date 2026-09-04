# Archive Report: Fase E — Per-tenant policy + temporal topology

**Change**: fase-e-tenant-topology
**Closed**: 2026-09-04
**Branch**: `feat/fase-e-tenant-topology`

## Objective

Deliver per-tenant policy + temporal topology. An optional `TenantPolicy` (1:1 with `Tenant`, 5 structured knobs: `retrievalLimit`, `retrievalSinceDays`, `truthGateMode`, `abstainOnCodes[]`, `promotionMinAgeMs`) overrides Fase C/D module constants per tenant; plus a single temporal `TopologyEdge` table (`OLT → PON_PORT → SPLITTER → CTO → ONU`) powering two read-only agent tools (`get_topology_path` ascending to OLT, `get_downstream_clients` descending BFS to ONUs). Strictly additive: a tenant without `TenantPolicy` runs Fase C/D byte-identical; the agent works without topology rows.

## PRs Merged

| PR | Phase | Description |
|----|-------|-------------|
| #68 | E-A | `TenantPolicy` seam: model + zod + `shouldAbstain` 3rd arg + `retrieveRelevantIncidents` 2nd arg + `eligibleForPromotion` 5th arg + `RunAgentOptions.tenantPolicy?` + chat-route per-turn loader + batched `promotePendingIncidents(now, policyLoader?)` + precedence logging |
| #69 | E-B | `TopologyEdge` model + BFS helpers + 2 topology tools + 2 routes (`/api/topology/{path,downstream}`) + role-gated `TopologyImpact` UI + Playwright E2E |
| E-8 | this archive | calendar-icon sync — spec promotion to canonical + archive |

## Spec Coverage

| Domain | Requirements | Scenarios | Status |
|--------|-------------|-----------|--------|
| tenant-policy | 9 | 9 | All COMPLIANT |
| temporal-topology | 7 | 9 | All COMPLIANT |
| strict-mode-abstention | 1 (+ Fase E) | 7 | All COMPLIANT |
| evidence-provenance | 1 (+ Fase E) | 5 | All COMPLIANT |
| confirmed-incident-memory | 1 (+ Fase E) | 11 | All COMPLIANT |
| **Total** | **19** | **41** | **41 fully COMPLIANT** |

## Test Counts

| Suite | Count | Status |
|-------|-------|--------|
| Unit + integration tests (13 test packages) | 726 | All pass |
| Typecheck | 15/15 packages | Clean |
| Build | (not run end-to-end locally) | Next.js prod build requires live Postgres + auth secrets; route/typecheck green, CI exercises `build` in its own environment |

PR E-B added **+73 tests** over the PR E-A baseline: 19 topology-edge envelope (shared) + 17 BFS (evidence) + 6 tool (agent-core) + 19 route tests (web) + 8 component tests (web) + 4 snapshot-locked strings (web) + 2 topology-fixture golden files.

## Verification

**Verdict**: PASS (no CRITICAL, no WARNING findings; only a SUGGESTION about the `edgesTraversed` counter over-counting on graphs with merges — non-blocking)
**Verify report**: `openspec/changes/archive/2026-09-04-fase-e-tenant-topology/verify-report.md`

## Known Deferrals

| Item | Status | Notes |
|------|--------|-------|
| `edgesTraversed` uniqueness | Deferred (SUGGESTION) | Small BFS approximates "unique edges walked"; rings with merges over-count. A future schema bump can add `edgesUnique` if needed; not blocking. |

## Archive Reconciliation

- **E-4.1 tasks.md desync**: tasks.md showed E-4.1 (`PROVENANCE_TOOL_META` rows for `get_topology_path` / `get_downstream_clients`) as `[ ]` despite the code being fully merged on main (PR #69, commit `8a5d7e7`). Verify-report proof: the "Both tools registered" scenario (`completeness === 'partial'`, `confidence === 0.9`) is verified PASS on the current commit. `grep` in `packages/agent-core/src/tools/provenance.ts` confirms both entries exist.
- **Canonical spec promotion**: the 3 delta specs that were previously working-tree-only edits (strict-mode-abstention, evidence-provenance, confirmed-incident-memory) were promoted to canonical during this archive; temporal-topology and tenant-policy were already byte-identical to canonical.

## Canonical Specs Updated

| Domain | Action |
|--------|--------|
| `openspec/specs/temporal-topology/spec.md` | Already complete (byte-identical to delta) |
| `openspec/specs/tenant-policy/spec.md` | Already complete (byte-identical to delta) |
| `openspec/specs/strict-mode-abstention/spec.md` | Appended 1 Fase E requirement + 7 scenarios (Fase D/E/F sections coexist) |
| `openspec/specs/evidence-provenance/spec.md` | Appended 1 Fase E requirement + 5 scenarios (Fase C/D/E/F sections coexist) |
| `openspec/specs/confirmed-incident-memory/spec.md` | Appended 1 Fase E requirement + 11 scenarios (Fase E/F sections coexist) |

## Engram Traceability

- Proposal: `sdd/fase-e-tenant-topology/proposal` (observation read)
- Design: `sdd/fase-e-tenant-topology/design` (observation read)
- Tasks: `sdd/fase-e-tenant-topology/tasks` (observation read)
- Verify report: `sdd/fase-e-tenant-topology/verify-report` (observation read)
- This archive report: `sdd/fase-e-tenant-topology/archive-report` (this observation)