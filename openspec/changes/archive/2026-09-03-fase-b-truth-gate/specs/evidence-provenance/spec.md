# Delta for evidence-provenance

## MODIFIED Requirements

### Requirement: Threading de `tenantId` end-to-end

`apps/web/app/api/chat/route.ts` MUST pasar `tenantId` (de `user.tenantId`) y `connectionId` a `runAgent`; `RunAgentOptions` MUST añadir (aditivo) el campo para el tenant/provenance; `runAgent` MUST reenviarlo a `executeToolCall`. Sin cambios en `ToolCallRecord`/`AgentResult`/`ChatResponse`.

`AgentResult` SHALL gain an optional `verdicts` field (`Verdict[]` from `@ftth-copilot/evidence`). This is additive — no existing field is removed or renamed. `runAgent` SHALL populate `verdicts` by calling `TruthGate.classify` / `classifyUnwrapped` for each tool result after execution.

(Previously: AgentResult had no verdicts field; runAgent did not classify tool results.)

#### Scenario: tenant fluye de la route a la tool

- GIVEN una request con `user.tenantId = 't1'` que dispara una tool
- WHEN la tool se ejecuta
- THEN el envelope lleva `tenantId === 't1'` (rastreado route → runAgent → executeToolCall)

#### Scenario: Contratos sin drift

- GIVEN `runAgent` devuelve un `AgentResult`
- WHEN se ejecuta runtime con el nuevo threading
- THEN `AgentResult`/`ToolCallRecord`/`ChatResponse` mantienen su shape existente (sin campos removidos o renombrados)

#### Scenario: Verdicts attached to AgentResult

- GIVEN a `runAgent` execution with tool calls
- WHEN all tool calls complete
- THEN `AgentResult.verdicts` is an array of `Verdict` objects (each with `code`, `reason`, `severity`) AND existing fields (`text`, `toolCalls`) are unchanged

#### Scenario: Missing verdicts for backward compatibility

- GIVEN a consumer that does not read `verdicts`
- WHEN it receives an `AgentResult`
- THEN the `verdicts` field is present but optional; omission is valid for pre-Fase-B results
