# ADR 0010 — Selección determinista de modo en el Organic Diagnostic Router

**Estado:** Aceptada
**Fecha:** 2026-09-17
**Documento relacionado:** `openspec/changes/adaptive-router/design.md` (AD-1, AD-2, AD-3)

## Contexto

No todas las consultas al chat merecen el mismo tratamiento. La consulta "¿estado de
OLT-Norte-01?" y la consulta "¿cuál es la causa raíz de la caída de RX en OLT-Este-01?"
tienen la misma forma gramatical y costos radicalmente distintos: la primera se resuelve con
una lectura y cero llamadas al modelo; la segunda necesita varias fuentes de evidencia,
iteraciones y el TruthGate.

Antes del router, el loop del agente era siempre el mismo: LLM → tool → LLM → respuesta, con
un máximo de 6 iteraciones y todas las tools disponibles. Para un NOC con flotas de
operadores consultando estado y potencia, eso significaba consumir tokens en cada consulta
trivial.

La pregunta de diseño era si el modo de ejecución debía elegirlo un modelo.

## Decisión

Elegir el modo con una **función pura determinista**, nunca con un LLM.

### Selección de modo

`selectMode()` (`packages/agent-core/src/adaptive-router.ts`) opera sobre
`(intentionLabel, querySignals)`:

1. `classifyIntention` produce la etiqueta de intención.
2. Un extractor por regex produce las señales: device IDs (`(onu|olt)-?\d+`), palabras de
   acción, interrogación y pistas multi-dispositivo.
3. Una **tabla de precedencia** decide el modo:

| Etiqueta | Palabra de acción | Device ID | Interrogación | Modo |
|---|---|---|---|---|
| `routine_topology` | listar / estado / detalle / mostrar | sí | no | `direct` |
| `routine_topology` | cualquiera | sí | no | `direct` |
| `routine_topology` | cualquiera | no | sí | `assisted` |
| `routine_topology` | cualquiera | no | no | `investigation` |
| `incident_diagnosis` | cualquiera | sí | no | `direct` |
| `incident_diagnosis` | cualquiera | sí | sí | `assisted` |
| `incident_diagnosis` | cualquiera | no | cualquiera | `investigation` |
| `advisory` | cualquiera | cualquiera | cualquiera | `investigation` |

### Selección de tools

`selectTools(mode, querySignals, allTools)` es igualmente determinista y también por regex:

| Señal | Tools habilitadas |
|---|---|
| `(onu\|olt)-?\d+` | `get_onu_detail`, `get_olt_detail`, `get_topology_path` |
| `potencia\|rx\|signal` | `get_onus_with_low_signal`, `get_onu_detail` |
| `ayer\|hoy\|histórico` | `get_predicted_issues` |
| `caíd[oa]\|causa raíz` | `get_predicted_issues`, `get_topology_path`, `get_downstream_clients` |
| `topologí[a]\|árbol` | `get_topology_path`, `get_downstream_clients` |

Por modo: `direct` devuelve **una** tool; `assisted` devuelve una de consulta más una de
contexto; `investigation` devuelve todas.

### Ejecución

- `direct` **nunca** llama al LLM: el runtime corta antes de `llm.createMessage` y arma la
  respuesta formateando el resultado de la tool.
- `assisted` limita las llamadas al LLM a 1, o 2 si la primera emite tool calls.
- `investigation` mantiene el loop actual con `maxIterations = 6`.
- El runtime filtra las tools estilo Anthropic por el modo decidido
  (`packages/agent-core/src/runtime.ts:445`): filtrar antes de enviar el esquema al modelo
  es una **restricción** de qué puede pedir, no sólo una optimización de costo.
- `AgentResult.route` es **aditivo** (campo opcional): los consumidores que desestructuran
  `text`, `toolCalls`, `verdicts`, `abstention`, `tokens`, `costUsd` y `latencyMs` siguen
  funcionando sin cambios.

## Consecuencias

### Buenas

- **Reproducibilidad total**: la misma consulta produce el mismo modo, siempre. Con un
  clasificador LLM, el modo puede variar entre corridas y hace imposible razonar sobre un
  incidente concreto.
- **Auditable**: `planRoute` es una función pura con una tabla de precedencia; un fallo de
  routing se reproduce y se testea con una tabla de casos.
- **Gratis**: la decisión ocurre antes de cualquier llamada al modelo.
- El filtro de tools **acota la superficie** del LLM de forma determinista: en modo
  `direct` el modelo ni ve las tools que no puede usar.
- `AgentResult.route` como campo aditivo permite observar el modo en las métricas
  (`ftth_copilot_router_dispatches_total`) sin romper a los consumidores existentes.
- El modo `direct` elimina por completo la latencia y el costo del LLM para la consulta más
  frecuente de un NOC.

### Malas

- **La tabla es una heurística de v1**, documentada como tal: *"This is a deterministic v1;
  Block 3's distribution data will replace it"* (`openspec/changes/adaptive-router/design.md`).
  No hay datos de distribución de uso que la respalden.
- La extracción por regex es **frágil ante sinónimos y otros idiomas**: "mostrar" está en la
  lista, "enseñame" no.
- Un device ID reconocible **baja** el modo en `incident_diagnosis`. Si el operador escribe
  el ID mal, la consulta se resuelve en modo `direct` con una lectura que puede no ser la
  que quería, y la respuesta es pobre pero no errónea.
- `advisory` siempre va a `investigation`, incluso para preguntas de consejo que podrían
  resolverse con una lectura. Es el precio de no subestimar una pregunta de causa raíz.
- La tabla **no se actualiza sola**: cada nueva forma de consulta que merezca un modo
  distinto exige editar código y sus tests.

### Abiertas

- El plan de reemplazar la tabla por datos de distribución real no tiene fecha ni criterio
  de éxito definido.
- No hay forma de que el operador fuerce un modo. Un `direct` mal elegido no tiene salida
  para el usuario.
- El filtro por regex de señales y el de tools están acoplados: una señal nueva obliga a
  tocar las dos tablas, y no hay un test que verifique la cobertura cruzada.
