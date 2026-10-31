# Routing y la capa de decisión Laya

Cada consulta que llega al chat pasa por un router que decide **cuánto esfuerzo** poner en
responderla. No todas las consultas merecen una sesión de LLM con tool calls: la mayoría se
resuelve con una lectura directa de la base de datos del NMS.

## Los tres modos

`packages/agent-core/src/adaptive-router.ts` define tres modos:

| Modo | Qué hace | Coste |
|---|---|---|
| `direct` | Una tool call, sin LLM. La respuesta se arma formateando el resultado de la tool | 0 llamadas al LLM |
| `assisted` | Una tool de consulta + una de contexto, con el LLM resumiendo | 1–2 llamadas al LLM |
| `investigation` | Todas las tools, loop completo, retrieval completo, TruthGate | hasta 6 iteraciones |

La diferencia es medible: una consulta de estado que antes costaba
`LLM → tool → LLM → respuesta` se resuelve como `tool → respuesta` en milisegundos.

## La selección de modo es determinista

`selectMode()` es una **función pura** sobre `(intentionLabel, querySignals)`. No llama al
LLM. Usa la etiqueta de intención y un extractor de señales basado en regex, y después una
tabla de precedencia:

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

Las reglas que se leen en la tabla:

- Una etiqueta **advisory** (consulta de consejo o de causa raíz) siempre va a
  `investigation`. No hay atajo para el consejo.
- En `incident_diagnosis`, la presencia de un device ID **baja** el modo: si sé de qué
  equipo me hablás, puedo mirar.
- En `routine_topology`, la ausencia de device ID **sube** el modo: si no sé de qué equipo
  pregunto, tengo que explorar.

## El filtro de tools también es determinista

`selectTools(mode, querySignals, allTools)` extrae señales por regex y devuelve el
subconjunto de tools:

| Señal detectada | Tools habilitadas |
|---|---|
| `(onu\|olt)-?\d+` | `get_onu_detail`, `get_olt_detail`, `get_topology_path` |
| `potencia\|rx\|signal` | `get_onus_with_low_signal`, `get_onu_detail` |
| `ayer\|hoy\|histórico` | `get_predicted_issues` |
| `caíd[oa]\|causa raíz` | `get_predicted_issues`, `get_topology_path`, `get_downstream_clients` |
| `topologí[a]\|árbol` | `get_topology_path`, `get_downstream_clients` |

Por modo: `direct` devuelve **una** tool (la más específica); `assisted` devuelve una tool de
consulta más una de contexto (topología o issues predichos); `investigation` devuelve todas.

El runtime filtra las tools estilo Anthropic según el modo
(`packages/agent-core/src/runtime.ts:445`). Filtrar antes de enviar el esquema al modelo no
es una optimización de costo: es una restricción de qué puede pedir.

## Por qué no un modelo decide el modo

Podría haberse resuelto con un LLM clasificador. La tabla de precedencia es mejor por tres
razones:

1. **Es reproducible.** La misma consulta produce el mismo modo, siempre. Con un modelo, el
   modo puede cambiar entre corridas y hace imposible razonar sobre un incidente.
2. **Es auditable.** `planRoute` es una función pura: se puede testear con una tabla de
   casos, y un fallo de routing se reproduce.
3. **Es gratis.** La decisión ocurre antes de cualquier llamada al modelo.

La distribución de datos de uso que justification de esta tabla está planeada como fase
posterior, cuando haya suficientes ejemplos reales.

## Laya: la capa de decisión rápida (System 1)

Laya es un clasificador **rule-based** de eventos de red, implementado en TypeScript en
`packages/shared/src/laya-expert-system.ts`. Clasifica un evento en una `EventClass`:

`CONGESTION`, `DEVICE_FAULT`, `MASS_OUTAGE`, `NORMAL`, `OPTICAL_DEGRADATION`,
`OPTICAL_FAULT`, `POWER_FAULT`, `UNKNOWN`, `UPLINK_FAULT`.

Cada clase tiene asociados una severidad (`EVENT_CLASS_SEVERITY`), un scope probable
(`EVENT_CLASS_SCOPE`) y si requiere investigación
(`EVENT_CLASS_REQUIRES_INVESTIGATION`).

El scoring cuenta coincidencias de keywords por clase; el desempate va por prioridad, y la
confianza se deriva como `min(0.95, 0.5 + (score/max_possible)*0.45)`.

**Laya no reemplaza al router.** Sólo aporta una señal adicional: informa el routing del
Organic Diagnostic Router. El servicio FastAPI de `services/laya` es un espejo REST de la
implementación TypeScript, no la fuente de verdad.

### Los cuatro modos de Laya

| Modo | Qué hace |
|---|---|
| `disabled` | No hace nada |
| `shadow` | Registra la decisión sin cambiar la ruta. **Es el default** |
| `assisted` | Inyecta `eventClass` en el router cuando la confianza supera el umbral |
| `automatic` | La decisión de Laya puede tomar la ruta directamente |

En `shadow` cada decisión se persiste en `DecisionEvaluation`
(`packages/db/prisma/schema.prisma:554`) con `eventClass`, `severity`, `confidence`,
`latencyMs`, `actualRoute` y `operatorOutcome`. La tabla existe para dos cosas: medir
cuánto acierta Laya contra lo que el operador hizo realmente, y alimentar el dataset de
entrenamiento cuando haya suficientes ejemplos reales.

### Fail-open

`LAYA_FAIL_OPEN=true` (default) significa que si Laya no responde o excede el timeout, el
sistema sigue con el pipeline actual y registra `fallback` en vez de una decisión. Un
clasificador auxiliar que puede dejar al producto sin responder no es aceptable en un NOC.

### Un solo switch

`LAYA_ENABLED` es el master switch: `false` revierte todo sin redeploy. Junto con
`LAYA_MODE`, `LAYA_FAIL_OPEN`, `LAYA_MIN_CONFIDENCE` y `LAYA_SUGGEST_ROUTE` forman el
superficie de configuración. `LAYA_SUGGEST_ROUTE=false` (default) significa que Laya
**registra** pero no **sugiere ruta**; es lo que separa `shadow` de `assisted`.

## Telemetría de la decisión

`GET /api/metrics` expone la familia `ftth_laya_*`:

- `ftth_laya_requests_total` — decisiones tomadas.
- `ftth_laya_latency_ms` — latencia.
- `ftth_laya_confidence` — confianza.

Y la familia del router: `ftth_copilot_router_dispatches_total`, que cuenta los despachos
por modo. El dashboard `/dashboard/laya` las grafica.

## En una línea

El router decide cuánto pensar; Laya decide qué clase de evento es, en menos de 5 ms, sin
molestar al router hasta que haya evidencia de que sirve.
