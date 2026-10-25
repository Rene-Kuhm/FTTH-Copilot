# ADR 0005 — Evidencia primero: envelope `evidence.provenance.v1`

**Estado:** Aceptada
**Fecha:** 2026-09-03 (Fase A del roadmap Evidence-First,
`openspec/changes/archive/2026-09-03-fase-a-provenance`)

## Contexto

Un agente LLM conectado a un NMS produce tres cosas indistinguibles a simple vista: un dato
real recién leído, una inferencia razonable sin respaldo, y una invención. En un NOC, esa
distinción es la diferencia entre una visita técnica justificada y una wastes, y nada en la
interfaz la hacía visible.

La primera fase del roadmap de evidencia (*Fase A: Provenance*) tenía un alcance
deliberadamente acotado: **etiquetar** cada dato que consume el agente, sin cambiar lo que
el LLM ve ni lo que el usuario recibe. La fase siguiente (Truth Gate) tenía que poder
apoyarse en esas etiquetas.

El punto de intervención elegido fue el **choke point**: `executeToolCall` en
`packages/agent-core/src/tools/index.ts`. Todas las tools pasan por ahí, así que un solo
punto garantiza cobertura total sin tocar cada tool.

## Decisión

Envolver **toda** salida de tool en un envelope de procedencia versionado, con metadatos de
confianza, frescura y completitud, y hacerlo **antes** de que el dato llegue al LLM.

- El contrato es `evidence.provenance.v1`, un schema Zod en
  `packages/shared/src/contracts.ts:75-84`, con literal de versión (`z.literal`) para que
  un cambio de contrato **rompa** en vez de desviar en silencio.
- El envelope tiene ocho campos: `schema`, `source`, `tenantId`, `observedAt`, `ttlMs`,
  `completeness`, `confidence?` y `data`.
- Hay **dos regímenes de TTL**: `DEFAULT_TTL_MS = 15 min` para datos vivos y `DEMO_TTL_MS =
  60 min` para el modo demo (`packages/shared/src/contracts.ts:91`, `:93`).
- Los metadatos por tool viven en una tabla: `PROVENANCE_TOOL_META`
  (`packages/agent-core/src/tools/provenance.ts:54-66`). `get_predicted_issues` es
  `minimal`/0.5/60 s; detalle y búsqueda `partial`/0.8; topología `partial`/0.9; listados
  `complete`/1.0.
- **Ninguna tool de topología declara `complete`**, porque las aristas de topología caducan
  blandas.
- El `source` se deriva con `deriveSource` (`provenance.ts:29`): `curated` para
  `get_predicted_issues`, `<provider>.poll` o `<provider>.demo` para el resto.
- El envelope se construye y **se re-valida con `safeParse`** antes de salir de la capa de
  tools (`packages/agent-core/src/tools/index.ts:46`, `:77-81`). Si no valida, la tool
  devuelve un payload de error en español en vez de propagar un objeto inválido.
- El envelope es **aditivo**: no cambia las respuestas del LLM, ni los tipos
  `ToolCallRecord`/`AgentResult`/`ChatResponse`.

## Consecuencias

### Buenas

- **Cobertura garantizada por construcción**: no hay tool que pueda quedar sin envelope,
  porque el etiquetado ocurre en el choke point y no en cada tool.
- La **frescura es verificable**: `observedAt` + `ttlMs` permiten clasificar un dato como
  `stale` sin depender del modelo.
- La **completitud es explícita**: el sistema sabe cuándo le falta parte de la información,
  que es la condición que dispara la abstención en la fase siguiente.
- El `tenantId` viaja con el dato: el envelope es autocontenido y auditable.
- El literal de versión convierte un cambio de contrato en un **fallo ruidoso** en vez de
  una interpretación silenciosa.
- `safeParse` en la frontera de la capa de tools convierte un error de contrato en un
  mensaje accionable en lugar de un `undefined` que se propaga hasta el LLM.

### Malas

- Cada respuesta del LLM lleva una capa de contexto que no proviene del NMS. Eso consume
  tokens en cada iteración del loop.
- `completeness` y `confidence` son **declarados por el código, no medidos**. Si la
  metadata de una tool está mal calibrada, el TruthGate va a clasificar mal. La tabla
  `PROVENANCE_TOOL_META` es una decisión humana codificada, no una medición.
- Los valores de `confidence` son ordinales y heurísticos: `0.8` para detalle, `0.9` para
  topología. No hay una base estadística detrás, así que el umbral de `low_confidence` es
  tan arbitrario como la metadata que lo alimenta.
- `DEMO_TTL_MS` de 60 minutos hace que el demo se comporte de forma distinta al
  producción en el único aspecto que el TruthGate observa. Un bug de freshness puede no
  aparecer en el demo.
- El envelope se valida dos veces (al construirlo y al leerlo en el validator), lo que
  duplica el costo de parseo en las rutas más calientes.

### Abiertas

- La metadata por tool es manual. Si una tool nueva no se agrega a
  `PROVENANCE_TOOL_META`, su envelope sale con los defaults y el TruthGate la clasifica
  mal. Nada obliga a registrarla.
- `confidence` nunca se deriva de la respuesta real del NMS (por ejemplo, de un campo de
  calidad que el proveedor exponga). Es un valor fijo por tipo de tool.
