# evidence-provenance Specification

## Purpose

Etiquetar cada dato que consume el agente con metadatos de procedencia (`evidence.provenance.v1`) en el choke point `executeToolCall`, sin cambiar las respuestas del LLM. Fase A del roadmap Evidence-First: provee base verificable para el Truth Gate (Fase B, fuera de alcance). Solo aditivo sobre los contratos `ToolCallRecord`/`AgentResult`/`ChatResponse`.

## Requirements

### Requirement: Contrato `evidence.provenance.v1`

El paquete `packages/shared` MUST definir el zod schema `evidenceProvenanceSchema` en `contracts.ts` con constant `EVIDENCE_PROVENANCE_SCHEMA = 'evidence.provenance.v1'` como literal de versión (`z.literal`), envolviendo: `schema`, `source` (nonempty string), `tenantId` (nonempty string), `observedAt` (ISO datetime `z.string().datetime()`), `ttlMs` (int no-negativo), `completeness` (enum `complete|partial|minimal`), `confidence` (number 0..1 opcional), `data` (`unknown`).

#### Scenario: Fixture válida aceptada

- GIVEN un objeto con todos los campos requeridos válidos (`schema`, `source: 'smartolt.demo'`, `tenantId: 't1'`, `observedAt: ISO`, `ttlMs >= 0`, `completeness`, `data`)
- WHEN se ejecuta `evidenceProvenanceSchema.safeParse(fixture)`
- THEN `.success` es `true`

#### Scenario: Version literal rechaza otro schema

- GIVEN la misma fixture pero `schema: 'evidence.provenance.v2'`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `false`

#### Scenario: `source` vacío rechazado

- GIVEN fixture con `source: ''`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `false`

#### Scenario: `tenantId` vacío rechazado

- GIVEN fixture con `tenantId: ''`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `false`

#### Scenario: `observedAt` inválido rechazado

- GIVEN fixture con `observedAt: 'not-a-date'`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `false`

#### Scenario: `ttlMs` negativo rechazado

- GIVEN fixture con `ttlMs: -1`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `false`

#### Scenario: `completeness` fuera de enum rechazado

- GIVEN fixture con `completeness: 'full'`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `false`

#### Scenario: `confidence` fuera de [0,1] rechazado

- GIVEN fixture con `confidence: 1.5`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `false`

#### Scenario: `confidence` opcional omitido

- GIVEN fixture válida sin campo `confidence`
- WHEN se ejecuta `safeParse`
- THEN `.success` es `true`

### Requirement: Golden tests del contrato

`packages/shared/tests/contracts.test.ts` MUST añadir un bloque `describe('evidence.provenance.v1')` siguiendo el patrón de telemetry/finding/action: una fixture válida más mutaciones negativas que afirman `safeParse(...).success === false`. Los 9 tests baseline MUST seguir pasando (solo aditivos).

#### Scenario: Pass baseline preservado

- GIVEN el suite de tests existente de shared
- WHEN se ejecuta la suite con los nuevos tests añadidos
- THEN los 9 tests baseline pasan Y los nuevos golden tests pasan

#### Scenario: Mutación negativa detecta campo roto

- GIVEN un golden test por cada mutación (source, tenantId, observedAt, ttlMs, completeness, confidence, schema)
- WHEN se ejecuta la suite
- THEN cada mutación con `.success === false` falla de forma determinista

### Requirement: Enrichment en `executeToolCall`

`packages/agent-core/src/tools/index.ts` MUST hacer que `executeToolCall` devuelva una string JSON del shape `{ schema, source, tenantId, observedAt, ttlMs, completeness, confidence, data }` en lugar del crudo. `source` MUST auto-derivarse como `providerName + (mock ? '.demo' : '.poll')` (ej. `smartolt.demo`/`smartolt.poll`); para `get_predicted_issues` source MUST ser `curated`. `observedAt` MUST capturarse por llamada con `new Date().toISOString()`. El wrapper deja el payload crudo bajo `data`.

#### Scenario: Cualquier tool envuelve el payload

- GIVEN una tool cualquiera ejecutada con contexto de provenance
- WHEN `executeToolCall` resuelve el dato del connector
- THEN devuelve string JSON que `safeParse` contra `evidenceProvenanceSchema` con `.success === true` y la respuesta cruda está bajo `data`

#### Scenario: `get_predicted_issues` usa source `curated`

- GIVEN `get_predicted_issues` invocada con `predictionProvider`
- WHEN se resuelve
- THEN `source === 'curated'`

#### Scenario: Modo demo deriva `.demo`

- GIVEN connector en modo mock (`useMock: true`)
- WHEN se ejecuta una tool (no `get_predicted_issues`)
- THEN `source` termina en `'.demo'` (ej. `smartolt.demo`)

#### Scenario: Modo live deriva `.poll`

- GIVEN connector en modo live (`useMock: false`)
- WHEN se ejecuta una tool (no `get_predicted_issues`)
- THEN `source === '<provider>.poll'`

### Requirement: Contexto `provenance` en `executeToolCall`

`executeToolCall` MUST aceptar un argumento de contexto opcional `provenance?: ProvenanceContext` (con `tenantId`, `source` override) para inyectar tenant y override de source. Si se provee `source`, MUST usarse en lugar de la derivación automática.

#### Scenario: `tenantId` inyectado

- GIVEN `provenance = { tenantId: 't1' }`
- WHEN se ejecuta una tool
- THEN el envelope resultante lleva `tenantId === 't1'`

#### Scenario: `source` override

- GIVEN `provenance = { tenantId: 't1', source: 'custom' }`
- WHEN se ejecuta una tool
- THEN el envelope lleva `source === 'custom'`

#### Scenario: Sin tenantId usa default

- GIVEN no se provee `provenance` (o `tenantId` faltante)
- WHEN se ejecuta una tool
- THEN el envelope NO rompe (tenantId MAY quedar vacío o default y el LLM rotula como sin tenant)

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

### Requirement: `ttlMs` default y override

`packages/shared` MUST exportar una constante `DEFAULT_TTL_MS` (live ~15 min; demo más largo). El enrichment MUST poblar `ttlMs` con el default, y SHOULD permitir override por herramienta (mapa por tool name) para configurable per-tool sin bump de contrato.

#### Scenario: Live usa TTL default

- GIVEN contexto live sin override
- WHEN se ejecuta una tool
- THEN `ttlMs === DEFAULT_TTL_MS`

#### Scenario: Demo usa TTL mayor

- GIVEN contexto demo sin override
- WHEN se ejecuta una tool
- THEN `ttlMs` es mayor que el default live

#### Scenario: Override por herramienta

- GIVEN una tool con override definido (ej. predicción con TTL propio)
- WHEN se ejecuta
- THEN `ttlMs` refleja el override

#### Scenario: `ttlMs` negativo nunca se emite

- GIVEN cualquier camino de ejecución
- WHEN se construye el envelope
- THEN `ttlMs` es siempre >= 0 (validado por el contrato)

### Requirement: `completeness` / `confidence` best-effort

El enrichment MUST fijar `completeness` en `complete|partial|minimal` según el shape de la tool; tools de shape vacío/pronóstico MUST usar `minimal` con `confidence` baja. `confidence` SHOULD ser 0..1. El contrato permite `minimal` y `confidence` opcional.

#### Scenario: Tools con shape vacío usan minimal

- GIVEN una tool que devuelve shape vacío (o pronóstico sin métrica firme)
- WHEN se ejecuta
- THEN `completeness === 'minimal'` y `confidence` es bajo (0..1)

#### Scenario: Cumplimiento del enum

- GIVEN cualquier resultado de tool
- WHEN se ejecuta
- THEN `completeness` es uno de `complete|partial|minimal`

### Requirement: Datos grandes pasan intactos

El wrapper MUST conservar el payload crudo completo bajo `data` sin truncar ni transformar, incluso con resultados grandes.

#### Scenario: Payload grande sin pérdida

- GIVEN una tool que devuelve un resultado extenso
- WHEN se ejecuta
- THEN `data` del envelope parseado contiene el payload completo sin truncamiento

## ADDED Requirements (Fase C)


### Requirement: Abstention attached to AgentResult (additive)

`packages/shared` MUST extend `AgentResult` and `ChatResponse` with additive optional fields to carry the Fase C `abstention.v1` payload. No existing field is renamed, removed, or has its semantics changed. Pre-Fase-C consumers MUST remain valid.

| Contract | New field | Type | Default |
|----------|-----------|------|---------|
| `AgentResult` | `abstention?` | `Abstention` | undefined |
| `AgentResult` | `abstained?` | `boolean` | undefined |
| `ChatResponse` | `abstention?` | `Abstention` | undefined |

`Abstention` is defined in `strict-mode-abstention` (schema `ftth.abstention.v1`). When `mode === 'strict'` and the run produces any `incomplete` verdict, `runAgent` populates all three fields together. Otherwise all three MUST remain undefined. Persistence into `Message.content` and the synthetic `Message.toolCalls` row named `__abstention__` is owned by the chat route (see `strict-mode-abstention`).

#### Scenario: Abstained flag set with abstention payload

- GIVEN a strict-mode run with `incomplete` verdicts
- WHEN `runAgent` returns
- THEN `result.abstained === true` AND `result.abstention` is a valid `Abstention`

#### Scenario: Missing abstention in observe mode (backward compatibility)

- GIVEN `mode: 'observe'`, any verdict set
- WHEN `runAgent` returns
- THEN `result.abstention === undefined` AND `result.abstained === undefined` AND `result.text` is the LLM's text

#### Scenario: ChatResponse carries abstention

- GIVEN `AgentResult.abstention` defined
- WHEN the chat route builds `ChatResponse`
- THEN `ChatResponse.abstention === AgentResult.abstention`

#### Scenario: Route persists __abstention__ pseudo-tool row

- GIVEN strict + incomplete run
- WHEN the route persists the assistant message
- THEN `Message.toolCalls` contains a row `{ name: '__abstention__', arguments: {}, result: <Abstention JSON> }` AND `Message.content` equals the rendered Spanish text

## ADDED Requirements (Fase D)

### Requirement: Fase D does not modify `evidence.provenance.v1`

Fase D (confirmed-incident-memory) MUST NOT add, remove, or rename any field in the `evidence.provenance.v1` envelope or in any consumer contract (`ToolCallRecord`, `AgentResult`, `ChatResponse`). Retrieved incidents are emitted through a separate `ftth.confirmed-incident.v1` contract and a separate `RELEVANT_INCIDENTS_HEADING` system-prompt block; they MUST NOT flow through `executeToolCall` or carry provenance metadata. The existing Fase A golden tests MUST continue to pass without modification.

#### Scenario: Golden tests still pass

- GIVEN the Fase A `evidence.provenance.v1` golden tests
- WHEN the suite runs after Fase D is merged
- THEN every existing test passes unchanged (no skipped, no `xit`, no removed cases)

#### Scenario: Tool-result envelopes unchanged

- GIVEN a tool call after Fase D is merged
- WHEN `executeToolCall` returns
- THEN the returned JSON `safeParse`s against `evidenceProvenanceSchema` and contains no fields derived from retrieved incidents

#### Scenario: Confirmed-incident contract is separate

- GIVEN a payload built by `retrieveRelevantIncidents`
- WHEN `evidenceProvenanceSchema.safeParse` runs
- THEN `.success === false` (the contracts are distinct; retrieved incidents are not provenance-tagged)
