# Tasks: Fase E — Per-tenant policy + temporal topology

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,500–2,000 (additions + tests + 2 routes + UI + docs; excludes generated goldens) |
| 400-line budget risk | **High** |
| Chained PRs recommended | **Yes** |
| Suggested split | PR E-A (TenantPolicy seam) → PR E-B (TopologyEdge + tools + routes + UI), each ≤600 lines incl. tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| E-A | `TenantPolicy` model + zod + 3 evidence extensions + agent-core thread + chat route loader + batched promote loader + precedence log | PR E-A (target: `main`) | `turbo run test --filter='./packages/{shared,evidence,agent-core}' && pnpm --filter web test apps/web/tests/api/chat-rag-policy.test.ts` | Manual `POST /api/chat` with seeded `TenantPolicy{retrievalLimit:7,truthGateMode:'observe'}`; expect ≤7 rows + one `[ftth-copilot/tenant-policy] …` line | Drop `tenant_policies`; revert 3rd/2nd/5th optional args; remove `tenantPolicy?` from `RunAgentOptions` |
| E-B | `TopologyEdge` model + BFS helpers + 2 tools + 2 routes + `TopologyImpact` UI + Playwright E2E | PR E-B (target: `main`, after E-A) | `turbo run test --filter='./packages/{evidence,agent-core}' && pnpm --filter web test:e2e apps/web/tests/e2e/topology-impact.spec.ts` | Manual `GET /api/topology/downstream?kind=OLT&id=OLT1`; expect `{root,onuIds,edgesTraversed}`; cross-tenant → 404 | Drop `topology_edges` + `TopologyNodeKind`; delete `apps/web/app/api/topology/*/route.ts`; remove `TopologyImpact`; revert 2 `PROVENANCE_TOOL_META` rows |

## Phase E-1 — Schema + contracts (Prisma + zod) — Files: `packages/db`, `packages/shared`, `packages/evidence`

- [x] **E-1.1** Add `TenantPolicy` (1:1 `Tenant`, 5 nullable knobs + `schemaVersion` + `lastEvaluatedAt`), `TopologyEdge` (single edge model, soft `validTo`), `TopologyNodeKind` enum + composite indexes `(tenantId,parentKind,parentId)` and `(tenantId,childKind,childId)`; generate manual migration `<ts>_tenant_topology`. **RED**: `pnpm --filter db exec prisma migrate deploy` on the CI service container applies + `migrate reset` round-trips; fixture check: 0 rows ⇒ Fase D byte-identical. **Commit**: `feat(db):`.
- [x] **E-1.2** Add `TENANT_POLICY_SCHEMA` + `TOPOLOGY_EDGE_SCHEMA` literals + `topologyNodeKindSchema` (enum) + `tenantPolicySchema` (range 1..50 / 1..365 / `>= 0`) + `topologyEdgeSchema` (refine `validTo > validFrom`, self-loop guard, kind enum) to `packages/shared/src/contracts.ts`. **RED**: `packages/shared/tests/contracts.test.ts` covers literal mismatch, range bounds, enum rejection, self-loop, `validTo<=validFrom`, all 5 kinds accepted. **Commit**: `feat(shared):`.
- [x] **E-1.3** Re-export `TenantPolicy`, `TopologyEdge`, `TopologyNodeKind` + new schemas from `@ftth-copilot/shared`; preserve Fase A 9-case goldens byte-identical. **RED**: `packages/shared/tests/index-exports.test.ts` asserts new symbols; Fase A envelope keys remain exactly 8. **Commit**: `feat(shared):`.
- [x] **E-1.4** Add `packages/evidence/src/topology.ts` skeleton + re-export `TopologyNodeKind`, `TopologyEdge` from `@ftth-copilot/evidence`. **RED**: `packages/evidence/tests/index-exports.test.ts` covers new symbols. **Commit**: `feat(evidence):`.
- [x] **E-1.5** Lock Spanish UI strings as module constants + snapshot them: `TOPOLOGY_HEADING_OWNER_ADMIN='Análisis de impacto'`, `TOPOLOGY_HEADING_OPERATOR_MEMBER='Resumen'`, `TOPOLOGY_EMPTY_MESSAGE='No hay datos de topología para este dispositivo.'`. **RED**: golden test byte-equal to voseo baseline; template strings asserted under `apps/web/tests/components/topology-impact.test.tsx`. **Commit**: `test(shared):`.

## Phase E-2 — Evidence extensions (abstention / retrieval / promotion) — Files: `packages/evidence`

- [x] **E-2.1** `shouldAbstain(verdicts, mode, tenantPolicy?)` — 3rd optional arg; `undefined` = Fase C byte-identical; `[]` disables; defined set replaces `['incomplete']`. **RED**: 5 cases in `packages/evidence/tests/abstention-policy.test.ts` — undefined keeps Fase C / `[]` disables / `['stale']` triggers stale / `['low_confidence']` triggers low_conf / observe mode ignores override. **Commit**: `feat(evidence):`.
- [x] **E-2.2** `retrieveRelevantIncidents(args, tenantPolicy?)` — 2nd optional arg resolves `limit` and `sinceDays` as `args.X ?? tenantPolicy.X ?? moduleDefault.X`. **RED**: 5 cases in `packages/evidence/tests/relevant-incidents.test.ts` — absent policy baseline / `retrievalLimit:10` caps at 10 / `retrievalSinceDays:30` filters 60d row / both knobs / args wins over policy. **Commit**: `feat(evidence):`.
- [x] **E-2.3** `eligibleForPromotion(c, src, now, hasIncomplete, tenantPolicy?)` — 5th optional arg resolves `promotionMinAgeMs` as `tenantPolicy.X ?? PROMOTION_MIN_AGE_MS`; `0` allows immediate; `60_000` 1min; `259_200_000` 72h; absent = 24h. **RED**: 5 cases in `packages/evidence/tests/pending-incident.test.ts` per spec. **Commit**: `feat(evidence):`.

## Phase E-3 — Topology BFS helpers (pure TS, Prisma-free) — Files: `packages/evidence`

- [x] **E-3.1** Implement `bfsDownstream(edges, rootKind, rootId): string[]` + `bfsAncestors(edges, leafKind, leafId): Array<{kind,id}>` + `topologyPath(edges, leafKind, leafId)` (= `bfsAncestors` reversed); both filter `validTo===null` and use `Set<\`${kind}:${id}\`>` visited guard. **RED**: 8 cases in `packages/evidence/tests/topology.test.ts` — linear OLT→ONU / multi-branch CTO→3 ONUs (1 expired) / self-loop / A↔B cycle (no infinite) / empty graph / leaf OLT with no edges / mixed kinds / expired edge filtered. **Commit**: `feat(evidence):`.
- [x] **E-3.2** Snapshot fixtures (`packages/evidence/tests/fixtures/topology-snapshot.json`) for canonical OLT→PON→SPLITTER→CTO→ONU chain + 1 expired subtree; deterministic order. **RED**: snapshot equality (golden). **Commit**: `test(evidence):`.

## Phase E-4 — Agent-core (runtime + tools + provenance) — Files: `packages/agent-core`

- [ ] **E-4.1** Register `PROVENANCE_TOOL_META.get_topology_path = {completeness:'partial', confidence:0.9}` and the same for `get_downstream_clients` in `packages/agent-core/src/tools/provenance.ts`. **RED**: `packages/agent-core/tests/provenance.test.ts` reads both keys + asserts existing rows untouched. **Commit**: `feat(agent-core):`.
- [x] **E-4.2** Add `RunAgentOptions.tenantPolicy?: TenantPolicy` + pure `resolveTenantPolicy(opts, env): TruthGateMode` (precedence `tenantPolicy.truthGateMode ?? env.TRUTH_GATE_MODE ?? DEFAULT_TRUTH_GATE_MODE`) emitting one `console.info('[ftth-copilot/tenant-policy] tenant=… knob=truthGateMode resolved=…')` per override; thread into `shouldAbstain` + `loadRetrievalBlock`. **RED**: `packages/agent-core/tests/tenant-policy.test.ts` covers per-tenant mode wins / absent = Fase D / log fires exactly once / retrieval closure sees policy. **Commit**: `feat(agent-core):`.
- [x] **E-4.3** Add 2 `buildTools` entries (`get_topology_path`, `get_downstream_clients`) + 2 `executeToolCall` switch cases wrapping `buildProvenanceEnvelope`; `get_topology_path` returns `data:null` on unknown id (verdict `incomplete` reason `no-envelope`); `get_downstream_clients` returns `{root:{kind,id}, onuIds:string[], edgesTraversed:number}`. **RED**: `packages/agent-core/tests/tools.test.ts` — happy path / empty subtree / unknown id / expired-edge filtering / Prisma `where:{validTo:null}` asserted. **Commit**: `feat(agent-core):`.

## Phase E-5 — Web chat route + promotion loader — Files: `apps/web`

- [x] **E-5.1** Create `apps/web/lib/policies/load-tenant-policy.ts` — thin `prisma.tenantPolicy.findUnique({where:{tenantId}})` returning `TenantPolicy | null`; re-export type. **RED**: `apps/web/tests/lib/load-tenant-policy.test.ts` (mocked prisma) covers present / absent. **Commit**: `feat(web):`.
- [x] **E-5.2** Chat route loads `TenantPolicy` once via `Promise.all` parallel with `resolveTenantConnector` and confirmed-incident read; threads into `runAgent({tenantPolicy})` + the `retrievalProvider` closure; emits one `console.info` per resolved knob. **RED**: `apps/web/tests/api/chat-rag-policy.test.ts` — absent policy = Fase D byte-identical (616 baseline holds) / `retrievalLimit:7` ≤7 rows / `truthGateMode:'observe'` overrides env `strict` / `abstainOnCodes:['incomplete']` no-op. **Commit**: `feat(web):` (chat route).
- [x] **E-5.3** Extend `promotePendingIncidents(now, policyLoader?)` with optional `policyLoader:(tenantIds)=>Promise<Map<string,TenantPolicy>>`; default issues one `prisma.tenantPolicy.findMany({where:{tenantId:{in:tenantIds}}})` → `Map`; per-candidate lookup O(1). Route passes `policyLoader: loadTenantPolicy`. **RED**: `apps/web/tests/api/pending-incidents-promote.test.ts` — 1min / 24h / 72h gates / N+1 guard: 10 candidates × 4 tenants ⇒ exactly one `tenantPolicy` query. **Commit**: `feat(web):`.

## Phase E-6 — Topology routes (`view_network` gate) — Files: `apps/web`

- [x] **E-6.1** `GET /api/topology/path?kind=&id=` — require `view_network`, scope by `user.tenantId`, 400 on bad `kind`, 404 on cross-tenant id, 200 with `Array<{kind,id}>` from leaf→root. **RED**: `apps/web/tests/api/topology-path.test.ts` — 200 happy / 403 missing `view_network` / 404 cross-tenant / 400 bad kind. **Commit**: `feat(web):`.
- [x] **E-6.2** `GET /api/topology/downstream?kind=&id=` — same gates; returns `{root:{kind,id}, onuIds:string[], edgesTraversed:number}`; `onuIds:[]` on leaf OLT. **RED**: `apps/web/tests/api/topology-downstream.test.ts` — 4-case matrix + empty subtree + expired-edge excluded + Prisma `where:{validTo:null}` asserted. **Commit**: `feat(web):`.

## Phase E-7 — UI `TopologyImpact` subcomponent + Playwright E2E — Files: `apps/web`

- [x] **E-7.1** Add `<TopologyImpact>` subcomponent inside `apps/web/components/IncidentsPanel.tsx`; role-gated (OWNER/ADMIN render expandable "Análisis de impacto"; OPERATOR/MEMBER render compact "Resumen"); same JSON wire format for both roles; empty state uses `TOPOLOGY_EMPTY_MESSAGE`. **RED**: `apps/web/tests/components/topology-impact.test.tsx` + snapshot test asserts headings + empty msg byte-equal. **Commit**: `feat(web):` (UI).
- [x] **E-7.2** Playwright E2E: role-matrix renders correct heading + accordion state; cross-tenant fetch returns 404 (not 403); missing `view_network` shows 403 inline. **RED**: `apps/web/tests/e2e/topology-impact.spec.ts` (role switch) + `apps/web/tests/e2e/topology-rbac.spec.ts` (permission gates). **Commit**: `test(web):`.

## Phase E-8 — Verify + docs + archive — Files: workspace + `openspec/specs`

- [x] **E-8.1** Workspace regression sweep: `turbo run test typecheck` green across all packages + `apps/web`; Fase A 9-case goldens + 616 baseline pass with no `tenantPolicy`; promotion N+1 guard verified. **Commit**: `chore(verify):`.
- [x] **E-8.2** Write `verify-report.md` (PASS); promote spec deltas to canonicals (`openspec/specs/{tenant-policy,temporal-topology}/spec.md`); archive change under `openspec/changes/fase-e-tenant-topology/.archived/`; append Fase E section to `packages/evidence/README.md`. **Commit**: `docs(spec):`.

## Strict TDD Reminder

Every implementation task above (E-1.1 through E-7.2) pairs with a RED test description in the **RED** field. `sdd-apply` MUST write the failing test first, observe it fail, then implement. Refactor only after GREEN. No task ships without its RED → GREEN → REFACTOR cycle recorded in the work-unit evidence.
