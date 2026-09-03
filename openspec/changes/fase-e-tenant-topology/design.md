# Design: Fase E — Per-tenant policy + temporal topology

## Technical Approach

Fase E threads an **optional** per-tenant policy through four seams (abstention, retrieval, promotion, truth-gate mode) without breaking the Fase C/D contract, and adds a parallel temporal-topology capability (single-edge `TopologyEdge` table + two BFS tools). When `TenantPolicy` and topology rows are absent, every existing test stays byte-identical (the Fase D 616-test regression net holds).

The change is purely additive:
- `TenantPolicy` is read **once per turn** in the chat route and threaded through `RunAgentOptions` + the `retrievalProvider` closure. `runAgent` stays Prisma-free.
- Three evidence functions take a **trailing optional** `tenantPolicy` / `policyLoader` argument; `undefined` = Fase C/D unchanged.
- Two new pure-TS BFS helpers (`bfsDownstream`, `bfsAncestors` / `topologyPath`) filter `validTo === null` and use a `Set<string>` visited guard.
- Two agent tools (`get_topology_path`, `get_downstream_clients`) wrap existing `evidence.provenance.v1` envelopes; the 8-field envelope shape stays byte-identical (Fase A golden tests locked).
- Promotion batch-loads policies via one `prisma.tenantPolicy.findMany({where: {tenantId: {in: tenantIds}}})` → `Map<tenantId, TenantPolicy>` (no N+1).

## Architecture Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Where to read `TenantPolicy` | **Chat route**, parallel with `resolveTenantConnector` + confirmed-incident read | Keeps `runAgent` Prisma-free; one DB round-trip per turn |
| 2 | `tenantPolicy` arg position on existing functions | **Trailing optional** | Fase D archive §1 pre-approved; absent = Fase C/D unchanged |
| 3 | Truth-gate precedence | **`tenantPolicy.truthGateMode ?? env ?? DEFAULT_TRUTH_GATE_MODE`** | Per-tenant wins when set; absent = env byte-identical |
| 4 | Empty `abstainOnCodes` semantics | **`[]` = "never abstain"** | Explicit opt-out is the natural complement to override |
| 5 | Topology representation | **Single edge table + `TopologyNodeKind` enum** | 5 node tables explode join count; single model is sufficient for BFS |
| 6 | Expired edges | **Soft `validTo` filtered out** | Preserves history; BFS + Prisma read both filter `validTo: null` |
| 7 | Promotion policy load | **Batched `findMany` → `Map<tenantId, TenantPolicy>`** | Avoids N+1; per-candidate lookup is O(1) |
| 8 | Cross-tenant topology leak | **404 (not 403)** | Avoids disclosing existence; uniform with agent panel |
| 9 | Role gating for `TopologyImpact` | **OWNER/ADMIN expandable, OPERATOR/MEMBER compact — same JSON body** | Same wire format; only rendering diverges |
| 10 | Topology `PROVENANCE_TOOL_META` | **`completeness: 'partial'`, `confidence: 0.9`** | Topology can be stale; never mark complete |

## Data Flow

```
USER MESSAGE ──► POST /api/chat
                    │
                    ├── getCurrentUser + permission('chat')
                    ├── conversation + history
                    │
                    ├── resolveTenantConnector ────────┐
                    ├── prisma.confirmedIncident.findMany ─┤ (parallel)
                    └── prisma.tenantPolicy.findUnique ──┘  ◄── one read per turn
                    │
                    ├── resolveTruthGateMode(env, tenantPolicy)
                    │     ├── console.info('[ftth-copilot/tenant-policy] tenant=… knob=truthGateMode resolved=…')
                    │     └── returns 'observe' | 'strict'
                    │
                    ├── retrievalProvider closure (closes over tenantPolicy)
                    │     └── retrieveRelevantIncidents(args, tenantPolicy)
                    │           ├── limit     = args.limit ?? tenantPolicy.retrievalLimit ?? 5
                    │           └── sinceDays = args.sinceDays ?? tenantPolicy.retrievalSinceDays ?? 90
                    │
                    └── runAgent({ mode, tenantPolicy, retrievalProvider, … })
                          │
                          ├── LLM tool-call loop
                          │     └── executeToolCall → get_topology_path | get_downstream_clients
                          │           ├── prisma.topologyEdge.findMany({ where: {tenantId, validTo: null} })
                          │           ├── topologyPath / bfsDownstream (pure TS)
                          │           └── buildProvenanceEnvelope(data, toolName, provenance)
                          │
                          ├── verdicts ← classifyEnvelope(envelope)
                          │
                          └── shouldAbstain(verdicts, mode, tenantPolicy)
                                ├── if tenantPolicy?.abstainOnCodes defined → use that set (empty disables)
                                └── else → Fase C baseline (incomplete → abstain)

POST /api/pending-incidents/promote (OWNER) ─► promotePendingIncidents(now, policyLoader)
                                                    ├── collect tenantIds
                                                    ├── prisma.tenantPolicy.findMany({where: {tenantId: {in: tenantIds}}})
                                                    ├── Map<tenantId, TenantPolicy>
                                                    └── for each candidate:
                                                          eligibleForPromotion(c, src, now, hasInc, map.get(c.tenantId))
```

## File Changes

### Created (10)
| File | Role |
|------|------|
| `packages/db/prisma/migrations/<ts>_tenant_topology/migration.sql` | `tenant_policies` + `topology_edges` + `TopologyNodeKind` enum + indexes |
| `packages/evidence/src/topology.ts` | `bfsDownstream`, `bfsAncestors`, `topologyPath` (pure TS, cycle-safe, `validTo`-filtered) |
| `packages/evidence/tests/topology.test.ts` | 8 BFS cases (cycle, expired, empty, multi-hop, leaf OLT, root, mixed kinds, repeat edges) |
| `packages/agent-core/tests/tenant-policy.test.ts` | `runAgent` per-tenant `tenantPolicy` thread + truth-gate override + retrieval closure override |
| `apps/web/lib/policies/load-tenant-policy.ts` | `loadTenantPolicy(tenantId): Promise<TenantPolicy \| null>` (thin `findUnique` helper) |
| `apps/web/app/api/topology/path/route.ts` | `GET /api/topology/path?kind=&id=` (`view_network` gate, tenant-scoped) |
| `apps/web/app/api/topology/downstream/route.ts` | `GET /api/topology/downstream?kind=&id=` (`view_network` gate, tenant-scoped) |
| `apps/web/tests/api/topology-path.test.ts` | 200 happy / 403 (no `view_network`) / 404 (cross-tenant) / 400 (bad `kind`) |
| `apps/web/tests/api/topology-downstream.test.ts` | Same 4-case matrix |
| `apps/web/tests/api/chat-rag-policy.test.ts` | Per-tenant overrides (`retrievalLimit`, `retrievalSinceDays`, `truthGateMode`, `abstainOnCodes`) |

### Modified (15)
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `TenantPolicy`, `TopologyEdge`, `TopologyNodeKind` enum + indexes |
| `packages/shared/src/contracts.ts` | `TENANT_POLICY_SCHEMA`, `TOPOLOGY_EDGE_SCHEMA`, `topologyNodeKindSchema`, `tenantPolicySchema`, `topologyEdgeSchema` |
| `packages/shared/src/index.ts` | Re-export schemas + `TenantPolicy`, `TopologyEdge`, `TopologyNodeKind` types |
| `packages/shared/tests/contracts.test.ts` | Range / enum / literal guard tests |
| `packages/evidence/src/abstention-policy.ts` | `shouldAbstain(verdicts, mode, tenantPolicy?)` — 3rd arg overrides `abstainOnCodes` |
| `packages/evidence/src/relevant-incidents.ts` | `retrieveRelevantIncidents(args, tenantPolicy?)` — 2nd arg resolves `limit` / `sinceDays` |
| `packages/evidence/src/pending-incident.ts` | `eligibleForPromotion(..., tenantPolicy?)` — 5th arg resolves `promotionMinAgeMs` |
| `packages/evidence/src/index.ts` | Re-export `bfsDownstream`, `bfsAncestors`, `topologyPath` + `TopologyNodeKind` |
| `packages/evidence/tests/abstention-policy.test.ts` | 5 new policy-arg cases |
| `packages/evidence/tests/relevant-incidents.test.ts` | 5 new policy-arg cases |
| `packages/evidence/tests/pending-incident.test.ts` | 5 new policy-arg cases |
| `packages/agent-core/src/runtime.ts` | `RunAgentOptions.tenantPolicy?: TenantPolicy`; pure `resolveTenantPolicy(opts, env)`; thread into `shouldAbstain` + `loadRetrievalBlock` |
| `packages/agent-core/src/tools/provenance.ts` | `PROVENANCE_TOOL_META.get_topology_path = {completeness: 'partial', confidence: 0.9}`; same for `get_downstream_clients` |
| `packages/agent-core/src/tools/index.ts` | 2 new `buildTools` entries + 2 new `executeToolCall` cases (both wrap `buildProvenanceEnvelope`) |
| `packages/agent-core/src/index.ts` | Re-export `TenantPolicy`, `TopologyEdge`, `TopologyNodeKind` types |
| `apps/web/app/api/chat/route.ts` | Load `TenantPolicy` once per turn; thread into `runAgent` + retrieval closure; resolve per-tenant truth-gate mode (with `console.info` precedence log) |
| `apps/web/app/api/pending-incidents/promote/route.ts` | Pass `policyLoader: loadTenantPolicy` to `promotePendingIncidents` |
| `apps/web/lib/promote-pending-incidents.ts` | `promotePendingIncidents(now, policyLoader?)` — batched `findMany` + `Map` lookup |
| `apps/web/components/IncidentsPanel.tsx` | `<TopologyImpact>` subcomponent, role-gated (OWNER/ADMIN expandable, OPERATOR/MEMBER compact) |
| `packages/evidence/README.md` | Fase E section |

## Interfaces / Contracts

```ts
// packages/shared/src/contracts.ts
export const TENANT_POLICY_SCHEMA = 'ftth.tenant-policy.v1' as const;
export const TOPOLOGY_EDGE_SCHEMA  = 'ftth.topology-edge.v1'  as const;
export const topologyNodeKindSchema = z.enum(['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU']);

export const tenantPolicySchema = z.object({
  schema: z.literal(TENANT_POLICY_SCHEMA),
  schemaVersion: z.literal(1),
  tenantId: z.string().min(1),
  retrievalLimit:     z.number().int().min(1).max(50).optional(),
  retrievalSinceDays: z.number().int().min(1).max(365).optional(),
  truthGateMode:      z.enum(['observe', 'strict']).optional(),
  abstainOnCodes:     z.array(z.enum(['ok','low_confidence','stale','incomplete'])).optional(),
  promotionMinAgeMs:  z.number().int().min(0).optional(),
  lastEvaluatedAt:    z.string().datetime().optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
export type TenantPolicy = z.infer<typeof tenantPolicySchema>;

export const topologyEdgeSchema = z.object({
  schema: z.literal(TOPOLOGY_EDGE_SCHEMA),
  id: z.string().min(1), tenantId: z.string().min(1),
  parentKind: topologyNodeKindSchema, parentId: z.string().min(1),
  childKind:  topologyNodeKindSchema, childId:  z.string().min(1),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().nullable().optional(),
  source: z.string().min(1),
  createdAt: z.string().datetime(),
}).strict().refine(
  (e) => e.validTo == null || new Date(e.validTo).getTime() > new Date(e.validFrom).getTime(),
  { message: 'validTo must be > validFrom', path: ['validTo'] },
);
```

```ts
// packages/agent-core/src/runtime.ts (additive)
export interface RunAgentOptions {
  // … existing fields unchanged
  tenantPolicy?: TenantPolicy; // Fase E — additive, never alters envelope
}

export function resolveTenantPolicy(
  opts: { mode?: TruthGateMode; tenantPolicy?: TenantPolicy },
  env: { TRUTH_GATE_MODE?: string },
): TruthGateMode {
  const fromPolicy = opts.tenantPolicy?.truthGateMode;
  if (fromPolicy) {
    console.info(
      `[ftth-copilot/tenant-policy] tenant=${opts.tenantPolicy!.tenantId} knob=truthGateMode resolved=${fromPolicy}`,
    );
    return fromPolicy;
  }
  const fromEnv = env.TRUTH_GATE_MODE;
  if (fromEnv === 'observe' || fromEnv === 'strict') return fromEnv;
  return DEFAULT_TRUTH_GATE_MODE;
}
```

```ts
// packages/evidence/src/topology.ts (NEW)
export type TopologyEdge = z.infer<typeof topologyEdgeSchema>;
export type { TopologyNodeKind };

// All three filter `e.validTo === null` first; visited set is `${kind}:${id}`.
export function bfsDownstream(edges: TopologyEdge[], rootKind: TopologyNodeKind, rootId: string): string[];
export function bfsAncestors(edges: TopologyEdge[], leafKind: TopologyNodeKind, leafId: string): Array<{kind: TopologyNodeKind; id: string}>;
export function topologyPath(edges: TopologyEdge[], leafKind: TopologyNodeKind, leafId: string): Array<{kind: TopologyNodeKind; id: string}>; // bfsAncestors reversed
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit — evidence | `shouldAbstain(..., policy?)` × 5: undefined keeps Fase C; `[]` disables; `['stale']` triggers on stale; `['low_confidence']` triggers on low_conf; observe mode ignores override | Extend `abstention-policy.test.ts` |
| Unit — evidence | `retrieveRelevantIncidents(args, policy?)` × 5: no policy / `retrievalLimit: 7` caps at 7 / `retrievalSinceDays: 30` filters / both knobs / args wins over policy | Extend `relevant-incidents.test.ts` |
| Unit — evidence | `eligibleForPromotion(..., policy?)` × 5: undefined → 24h baseline / `0` immediate / `60_000` 1min gate / `259_200_000` 72h gate / 25h-old against 24h gate | Extend `pending-incident.test.ts` |
| Unit — evidence | topology BFS × 8: linear OLT→ONU; multi-branch CTO→3 ONUs (1 expired); self-loop; A↔B cycle; empty graph; root with no edges; mixed kinds; leaf OLT | New `topology.test.ts` |
| Runtime — agent-core | `runAgent({tenantPolicy, mode})`: per-tenant mode wins over env; absent = Fase D baseline; `shouldAbstain` consumes `abstainOnCodes`; `retrievalProvider` closure consumes knobs; `console.info` precedence log fires once per override | New `tenant-policy.test.ts` |
| Route — chat | absent policy = Fase D byte-identical (existing `chat-rag.test.ts` keeps green); per-tenant overrides: `retrievalLimit: 7` → ≤7 rows; `truthGateMode: 'observe'` overrides env `strict`; `abstainOnCodes: ['incomplete']` no-op | New `chat-rag-policy.test.ts` |
| Route — topology | 200 happy path / 403 missing `view_network` / 404 cross-tenant / 400 invalid `kind` | `topology-path.test.ts`, `topology-downstream.test.ts` |
| Route — promote | per-tenant `promotionMinAgeMs` matrix (1min / 24h / 72h gates); batched load fires exactly one `tenantPolicy.findMany` for 10 candidates across 4 tenants | Extend `pending-incidents-promote.test.ts` |
| E2E — Playwright | `IncidentsPanel` → `TopologyImpact` accordion: OWNER/ADMIN see expandable "Análisis de impacto"; OPERATOR/MEMBER see compact "Resumen"; empty state shows "No hay datos de topología para este dispositivo." for both | New `apps/web/tests/e2e/topology-impact.spec.ts` |

## Spanish templates (snapshot-locked)

```ts
// apps/web/components/IncidentsPanel.tsx — TopologyImpact subcomponent
export const TOPOLOGY_HEADING_OWNER_ADMIN     = 'Análisis de impacto';
export const TOPOLOGY_HEADING_OPERATOR_MEMBER = 'Resumen';
export const TOPOLOGY_EMPTY_MESSAGE           = 'No hay datos de topología para este dispositivo.';
```

Lifted to module-scope constants so a dedicated component test (`apps/web/tests/components/topology-impact.test.tsx`) snapshots byte-equality. Snapshots are the regression net for any prompt drift.

## Precedence logging

When a per-tenant override applies, the runtime emits exactly one `console.info` per resolved knob:

```
[ftth-copilot/tenant-policy] tenant=<tenantId> knob=<name> resolved=<value>
```

Locked examples (byte-tested):

```
[ftth-copilot/tenant-policy] tenant=t1 knob=truthGateMode resolved=observe
[ftth-copilot/tenant-policy] tenant=t1 knob=abstainOnCodes resolved=[stale,incomplete]
[ftth-copilot/tenant-policy] tenant=t1 knob=retrievalLimit resolved=7
[ftth-copilot/tenant-policy] tenant=t1 knob=retrievalSinceDays resolved=30
[ftth-copilot/tenant-policy] tenant=t1 knob=promotionMinAgeMs resolved=259200000
```

Absent `tenantPolicy` → zero log lines. The format is reused inside the chat route when `retrievalLimit` / `retrievalSinceDays` / `abstainOnCodes` / `truthGateMode` override env/module defaults.

## Threat Matrix

**N/A** — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary is touched. All changes are additive inside the existing Next.js + Prisma + pnpm monorepo.

## Migration / Rollout

**Additive.** Single migration `<ts>_tenant_topology` creates:
- `tenant_policies` (PK `tenantId`, FK to `tenants` ON DELETE CASCADE) with 5 nullable structured columns + `schemaVersion` + `lastEvaluatedAt` + `createdAt` / `updatedAt`.
- `topology_edges` (PK `id`, FK to `tenants` ON DELETE CASCADE) with composite indexes `(tenantId, parentKind, parentId)` and `(tenantId, childKind, childId)`.
- `TopologyNodeKind` enum (`OLT | PON_PORT | SPLITTER | CTO | ONU`).

No backfill: empty tables preserve Fase D byte-identical behavior. CI applies the migration via the existing service container.

## Risks / Rollback

| Risk | Mitigation |
|------|------------|
| BFS traverses expired edges | Hard filter `edges.filter((e) => e.validTo === null)` in all three helpers + Prisma `where: { validTo: null }` on every read; covered by `topology.test.ts` expired-edge case |
| Per-tenant truth gate breaks global safety | Same `'observe' \| 'strict'` enum; absent policy keeps env byte-identical (covered by `tenant-policy.test.ts`) |
| Promotion N+1 on `policyLoader` | Batched `findMany({where: {tenantId: {in: tenantIds}}})` + `Map<tenantId, TenantPolicy>` (covered by `pending-incidents-promote.test.ts`) |
| Topology routes leak cross-tenant | Every Prisma read scopes by `user.tenantId`; cross-tenant IDs → 404, never 403 (covered by `topology-{path,downstream}.test.ts`) |
| Role-gated UI forks JSON wire format | Same `/api/topology/downstream` body for every role; only the React component renders differently (covered by Playwright E2E) |

**Rollback TenantPolicy**: drop `tenant_policies` + revert `runtime.ts` to Fase D shape; revert the 3rd/2nd/5th optional args on the three evidence functions. 616 existing tests stay green; `verify` is a single drop-table migration.

**Rollback TopologyEdge**: drop `topology_edges` + `TopologyNodeKind` enum + delete the two `topology/{path,downstream}/route.ts` files + remove `TopologyImpact` from `IncidentsPanel`. The two tools vanish; `PROVENANCE_TOOL_META` rows are removed.

**Independence**: the two features touch disjoint tables, disjoint routes, and disjoint evidence functions. They can ship as one PR or two chained PRs (recommended order: TenantPolicy first → TopologyEdge second; see `sdd-tasks`).

## Open Questions

None — all 11 design points are derived directly from the locked proposal and the 5 spec files. No blocking decisions remain; ready for `sdd-tasks`.