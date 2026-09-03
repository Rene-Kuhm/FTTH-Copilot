# Proposal: Fase A — Provenance

## Intent

Eliminar la alucinación como clase de fallo desde los cimientos: hoy el agente consume `JSON.stringify(data)` crudo sin metadatos de procedencia (fuente, tenant, fecha, vigencia, confianza). Sin ellos ningún Truth Gate futuro puede verificar qué respalda una afirmación. Fase A etiqueta cada dato consumido con `evidence.provenance.v1`, **sin cambiar respuestas**. Primer paso verificable del roadmap Evidence-First.

## Scope

### In Scope
- Contrato zod `evidence.provenance.v1` envolvente: `{ schema, source, tenantId, observedAt, ttlMs, completeness, confidence, data }` en `shared/src/contracts.ts`.
- Golden tests (mismo patrón que `contracts.test.ts`).
- Enrichment en `executeToolCall` (choke point): crudo bajo `data`, `source` derivado (`providerName + .demo/.poll`; `get_predicted_issues` → `curated`), `observedAt` por llamada.
- Threading de `tenantId` (chat route → `runAgent` → `executeToolCall`).
- `ttlMs` default + override por herramienta; `completeness`/`confidence` best-effort.

### Out of Scope
- **Truth Gate** (Fase B) — no valida ni detiene.
- Cambio de respuestas del LLM.
- `llm.ts` y `prompts/system.ts` — NO se tocan.
- Config per-tenant de TTL / calibración.

## Capabilities

### New Capabilities
- `evidence-provenance`: contrato `evidence.provenance.v1` + enrichment del `executeToolCall`.

### Modified Capabilities
- None.

## Approach

Envolver en `executeToolCall` (choke point, Approach 1): devuelve string JSON `{ schema, source, tenantId, observedAt, ttlMs, completeness, confidence, data }`. `source` derivado del connector; `observedAt` por llamada; `tenantId` plomneado desde `user.tenantId` del chat route vía `runAgent` → nuevo arg de contexto. Contratos `ToolCallRecord`/`AgentResult`/`ChatResponse` intactos.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `shared/src/contracts.ts` | Modified | Añade `evidence.provenance.v1` |
| `shared/tests/contracts.test.ts` | Modified | Golden tests aditivos |
| `agent-core/src/tools/index.ts` | Modified | Wrapper + contexto |
| `agent-core/src/runtime.ts` | Modified | Pasa tenantId/source |
| `agent-core/src/index.ts` | Modified | Exporta helpers |
| `web/app/api/chat/route.ts` | Modified | Pasa tenantId + connectionId |
| `web/lib/connectors/chat-client.ts` | Modified | Reenvía connectionId |
| `agent-core/tests/tools.test.ts` | Modified | 14 assertions rompen |
| `agent-core/tests/runtime.test.ts` | Modified | Shape sin drift |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 14 assertions rompen | High | Actualizar en lockstep |
| Drift de ToolCallRecord/AgentResult | Med | Solo aditivos + tests |
| Ruido JSON en texto LLM | Med | system/prompt intactos |
| 9 golden tests regresionan | Low | Nuevos aditivos |

## Rollback Plan

Revertir wrapper a crudo + quitar threading de `tenantId`; eliminar `evidence.provenance.v1`. Tolerante, sin migración.

## Dependencies

- Contrato zod base en `packages/shared`; baseline shared 9/9, agent-core 49/49.

## Success Criteria

- [ ] `evidence.provenance.v1` golden-testeado; shared verde (9 + nuevos).
- [ ] `executeToolCall` envuelve todo; `source` correcto, `tenantId` plomneado end-to-end.
- [ ] Contractos `ToolCallRecord`/`AgentResult`/`ChatResponse` inalterados; agent-core verde con 14 assertions actualizadas.
- [ ] llm/prompt sin cambios; respuestas demo siguen parseando.
