# Design: Fase A — Provenance

## Technical Approach

Enrich at the choke point: `executeToolCall` wraps the raw connector payload into an `evidence.provenance.v1` JSON envelope, derivable source + metadata, additive over `ToolCallRecord`/`AgentResult`/`ChatResponse`. `tenantId` is threaded from the chat route via `runAgent` → new `ProvenanceContext` arg. Pure helpers exported from `agent-core` for golden testing. No changes to `llm.ts`, `prompts/system.ts`, or LLM responses.

## Architecture Decisions

### Decision: Mock/live detection source
| Option | Tradeoff | Decision |
|---|---|---|
| Read `useMock` off `INmsConnector` | `useMock` is `private`, not on the interface; impossible without contract change | Rejected |
| Thread `mode`/`provider` via `ProvenanceContext` (from `dataSource.mode`/`.provider`) | One plumbing field; reliable; `runAgent` already has it | **Chosen** |

`dataSource.mode` maps `demo`→`.demo`, `live`→`.poll`; `dataSource.provider` lowercased→`providerName`. In `buildDefaultConnector`, mode = `SMARTOLT_USE_MOCK !== 'false'` and provider = `'smartolt'`.

### Decision: Contract as wrapping object vs flat
| Option | Tradeoff | Decision |
|---|---|---|
| Flat metadata mixed with data | Ambiguous fields | Rejected |
| Wrapping `{ ...meta, data }` | Raw payload isolated under `data`; matches roadmap intent | **Chosen** |

## Envelope & Per-Tool Tables

`executeToolCall` returns `JSON.stringify({ schema, source, tenantId, observedAt, ttlMs, completeness, confidence, data })`.

| tool | completeness | confidence | ttlMs |
|---|---|---|---|
| get_predicted_issues | minimal | 0.5 | 60000 (override via `CURATED_TTL_MS`) |
| list_olts | complete | 1.0 | `DEFAULT_TTL_MS` |
| get_olt_detail | complete | 1.0 | `DEFAULT_TTL_MS` |
| get_network_overview | complete | 1.0 | `DEFAULT_TTL_MS` |
| list_onus | complete | 1.0 | `DEFAULT_TTL_MS` |
| get_onu_detail | partial | 0.8 | `DEFAULT_TTL_MS` |
| get_onus_with_low_signal | partial | 0.8 | `DEFAULT_TTL_MS` |
| search_by_customer_name | partial | 0.8 | `DEFAULT_TTL_MS` |

- `DEFAULT_TTL_MS = 15 * 60_000` (live); demo override `DEMO_TTL_MS = 60 * 60_000` when `mode === 'demo'`. No per-tool override beyond `get_predicted_issues`.
- Empty/forecast shapes (predictions) → `minimal` / low confidence. All others → `complete`/`partial` per richness.

## Data Flow

    chat/route (user.tenantId, connectionId, dataSource) ──► runAgent(RunAgentOptions) ──► ProvenanceContext
        │                                                                        │
        └── resolveTenantConnector ──► connector ────────► executeToolCall(connector, name, args, provider?, ctx?)
                                                                     │
                          builds envelope {schema,source,tenantId,observedAt,ttlMs,completeness,confidence,data}
                                                                     │
        AgentResult{toolCalls:[ToolCallRecord{name,arguments,result=envelopeStr}]}  ──► ChatResponse (unchanged)

## Signature Changes

`RunAgentOptions` adds (additive): `tenantId?: string` and `connectionId?: string`. `runAgent` builds a `ProvenanceContext` (from these plus the existing `dataSource.mode`/`.provider`) and passes it to `executeToolCall`.

```ts
export interface ProvenanceContext {
  tenantId?: string;
  connectionId?: string;      // connection/connector lineage, for future traceability
  source?: string;            // override; wins over derivation
  mode?: 'live' | 'demo';     // demo -> .demo, live -> .poll
  provider?: string;          // lowercased -> providerName
}
executeToolCall(connector, toolName, args, predictionProvider?, provenance?: ProvenanceContext): Promise<string>
```

**`connectionId` (decisión explícita):** la spec (`spec.md`, "threading end-to-end") exige pasar `tenantId` **y `connectionId`** a `runAgent`. Ambos se enrutan desde la chat route vía `RunAgentOptions` hacia `ProvenanceContext`. `connectionId` **no** entra al envelope de 8 campos del contrato `evidence.provenance.v1` (el contrato no lo define); se transporta en `ProvenanceContext` como contexto de conexión disponible para las fases siguientes (p. ej. trailing por conexión en el Truth Gate). `connectionId` tampoco se expone al LLM en Fase A (sin cambio de respuestas); queda en el contexto interno.

`deriveSource(mode, provider, toolName, sourceOverride?)` → `get_predicted_issues`→`curated`; else `(sourceOverride ?? provider.toLowerCase()) + (mode==='demo'?'.demo':'.poll')`.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/shared/src/contracts.ts` | Modify | Add `EVIDENCE_PROVENANCE_SCHEMA`, `evidenceProvenanceSchema`, `DEFAULT_TTL_MS`, `DEMO_TTL_MS` |
| `packages/shared/src/index.ts` | Modify | Re-export provenance schema + types |
| `packages/shared/tests/contracts.test.ts` | Modify | Additive golden `describe('evidence.provenance.v1')` |
| `packages/agent-core/src/tools/index.ts` | Modify | Wrap in `executeToolCall`; add `provenance.ts` helpers incl. `deriveSource`, `defaultProvenance`, `PROVENANCE_TOOL_META` |
| `packages/agent-core/src/runtime.ts` | Modify | Add `tenantId` + `connectionId` to options; build+pass `ProvenanceContext` |
| `packages/agent-core/src/index.ts` | Modify | Export `ProvenanceContext`, `deriveSource`, `defaultProvenance` |
| `apps/web/app/api/chat/route.ts` | Modify | Pass `tenantId: user.tenantId` + `connectionId` (de `dataSource`) to `runAgent` |
| `apps/web/lib/connectors/chat-client.ts` | No change | Already carries `mode`/`provider`/`connectionId` in `dataSource`; only forwarded via route → runAgent |
| `packages/agent-core/tests/tools.test.ts` | Modify | Update 7 shape-breaking `it.each` + predicted-issues assertions; add envelope cases |
| `packages/agent-core/tests/runtime.test.ts` | Modify | Assert envelope under `toolCalls[].result`, no drift |
| `packages/agent-core/tests/provenance.test.ts` | Create | Unit tests for pure helpers |

## Testing Strategy

| Layer | What | How |
|---|---|---|
| Unit (shared) | Schema golden + negative mutations | Additive `describe` block |
| Unit (agent-core) | `deriveSource`, `defaultProvenance`, tool meta | New `provenance.test.ts` |
| Integration | Envelope shape for all 8 tools | Update `tools.test.ts` to `JSON.parse(result)` + `safeParse` |
| Regression | no drift on `AgentResult`/`ChatResponse` | `runtime.test.ts` unchanged shape |

Edge cases: `get_predicted_issues` → `curated`; missing provider → error string unwrapped (kept as-is, not enveloped); `null`/`undefined` data → `'No encontrado'` unwrapped; demo vs live source suffix; `provenance.source` override; `connectionId` threaded through context but never into the 8-field envelope / LLM text; large payload intact under `data`.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Pure additive data-enrichment.

## Migration / Rollout

No data migration. Additive contract; old consumers ignore new envelope fields. Rollback: revert wrapper + threading; remove schema. CI gate `turbo run test`.

## Open Questions

- [ ] Whether `null`/error paths should also be enveloped — design keeps them unwrapped to avoid leaking provenance on non-data responses (revisit in Phase B).
