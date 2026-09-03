# Proposal: Fase E — Per-tenant policy + temporal topology

## Intent

Add an optional `TenantPolicy` (1:1 with `Tenant`, 5 structured knobs) overriding Fase C/D defaults per tenant, and a single temporal `TopologyEdge` table powering two read-only agent tools (`get_topology_path` ascending to OLT, `get_downstream_clients` descending BFS to ONUs). Strictly additive: a tenant without `TenantPolicy` runs Fase C/D byte-identical; the agent works without topology rows.

## Scope

### In Scope
- `TenantPolicy` model: `retrievalLimit`, `retrievalSinceDays`, `truthGateMode` (nullable enum), `abstainOnCodes[]`, `promotionMinAgeMs`
- `TopologyEdge` + `TopologyNodeKind` enum (`OLT|PON_PORT|SPLITTER|CTO|ONU`), `validTo` soft-expiry, manual migration
- zod contracts (`tenantPolicySchema`, `topologyEdgeSchema`) + pure-TS BFS helpers (`bfsDownstream`, `bfsAncestors`, `topologyPath`, filter `validTo IS NOT NULL`)
- 3rd/2nd/5th optional arg on `shouldAbstain`/`retrieveRelevantIncidents`/`eligibleForPromotion` (Fase D pre-approved shape); `RunAgentOptions.tenantPolicy?`
- Two agent tools + `PROVENANCE_TOOL_META` rows (`completeness: 'partial'`, `confidence: 0.9`)
- Chat route loads `TenantPolicy` once per turn; `GET /api/topology/{path,downstream}` (`view_network` gate)
- `promotePendingIncidents(now, policyLoader?)` — batched `Map<tenantId, TenantPolicy>`
- Role-gated `TopologyImpact` accordion (Operator/MEMBER compact; OWNER/ADMIN expandable)
- Tests; `verify` PASS; 616 existing tests stay green when `tenantPolicy` is absent

### Out of Scope
- Eval harness, prompt-injection suite (Fase F); hosted-service deps; retroactive topology backfill
- New role/permission; promotion telemetry sink (Phase 2); operator confirm UX polish, promotion undo, cron-driven promotion
- Fase B/C re-tuning; five node tables (single edge model only)

## Capabilities

### New Capabilities
- `tenant-policy`: model + zod contract + 5-knob override + per-turn loader
- `temporal-topology`: model + enum + BFS helpers + two HTTP routes + zod contract

### Modified Capabilities
- `evidence-provenance`: `PROVENANCE_TOOL_META` rows for two new tools
- `strict-mode-abstention`: `shouldAbstain(verdicts, mode, tenantPolicy?)` accepts `abstainOnCodes`
- `confirmed-incident-memory`: retrieval + promotion accept per-tenant `retrievalLimit/retrievalSinceDays/promotionMinAgeMs`

## Approach

Per-tenant > module constant > env, across all four seams. Single edge table traversed by `(tenantId, parentKind, parentId, validTo IS NULL)`; BFS is pure-TS. Promotion batch-loads policies once; chat threads the loaded policy through `runAgent` + retrieval closure.

| Seam | Override |
|------|----------|
| `shouldAbstain` | `abstainOnCodes` |
| `retrieveRelevantIncidents` | `retrievalLimit`, `retrievalSinceDays` |
| `eligibleForPromotion` | `promotionMinAgeMs` |
| `runAgent` truth gate | `truthGateMode` |

## Affected Areas

| Area | Impact |
|------|--------|
| `packages/db/prisma/{schema.prisma,migrations/<ts>_tenant_topology/}` | New: `TenantPolicy`, `TopologyEdge`, enum, indexes |
| `packages/shared/src/contracts.ts` + `packages/evidence/src/{abstention-policy,relevant-incidents,pending-incident,topology}.ts` | New zod contracts; 3rd/2nd/5th optional args; new BFS helpers |
| `packages/agent-core/src/{runtime.ts,tools/{index,provenance}.ts}` | `tenantPolicy?` + 2 tools + 2 meta rows |
| `apps/web/app/api/{chat,topology/{path,downstream},pending-incidents/promote}/route.ts` + `lib/{policies/load-tenant-policy,promote-pending-incidents}.ts` | Per-turn loader; 2 new GET routes; `policyLoader` param |
| `apps/web/components/{IncidentsPanel,AlertsPanel}.tsx` | Role-gated `TopologyImpact` |
| `openspec/specs/{tenant-policy,temporal-topology}/spec.md` | New canonicals |
| `openspec/specs/{evidence-provenance,strict-mode-abstention,confirmed-incident-memory}/spec.md` | Additive deltas |
| `packages/evidence/README.md` | Fase E section |

## Risks

| Risk | Mitigation |
|------|------------|
| BFS traverses expired edges | Filter `validTo IS NULL`; soft-expiry tests |
| Per-tenant truth gate breaks global safety | Same enum; absent policy == env byte-identical (test) |
| Promotion N+1 on `policyLoader` | Batched `findMany` → `Map<tenantId, TenantPolicy>` |
| Topology routes leak cross-tenant | Scoped by `user.tenantId`; `view_network` gate |
| Role-gated UI forks JSON | Same body; rendering diverges; snapshot tests |

## Rollback Plan

Drop both tables via down migration (additive). Revert the three signature extensions to drop the trailing optional arg. Remove `tenantPolicy?` from `RunAgentOptions`. UI `TopologyImpact` already hidden when policy absent. Pre-Fase-E behavior byte-identical without `TenantPolicy` rows or topology edges.

## Dependencies

Fase A `evidence.provenance.v1` · Fase B `Verdict` + `TruthGateMode` · Fase C `shouldAbstain` · Fase D archive pre-approval · existing `AgentActionLog` · Postgres 16 service container. **No paid deps, no LLM API keys, no pgvector.**

## Success Criteria

- [ ] Migrations apply; down migration round-trips
- [ ] Absent `TenantPolicy`: 616 existing tests pass unmodified; behavior byte-identical
- [ ] Per-tenant knobs override defaults; `truthGateMode` wins over env when set
- [ ] `get_topology_path` returns ancestor chain; `get_downstream_clients` returns reachable ONUs; both filter `validTo IS NULL`
- [ ] Topology routes 403 without `view_network`; tenant-isolation refuses cross-tenant ids
- [ ] Promotion batch loads policies once; per-candidate override applied
- [ ] Role-gated `TopologyImpact` renders compact for Operator/MEMBER, expandable for OWNER/ADMIN
- [ ] `turbo run test typecheck` workspace-wide green; CI uses no paid services
