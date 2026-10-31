# Tutorial 2 — Tu primera consulta

**Objetivo:** entender qué pasa realmente cuando le hacés una pregunta al chat, y aprender a
leer la respuesta como un sistema con evidencia — no como un texto generado.

**Requiere:** el demo del [Tutorial 1](tutorial-1-el-demo-en-un-comando.md) corriendo.

---

## La pregunta más simple

En el chat del demo, escribí:

```
estado de OLT-Norte-01
```

Fijate en la respuesta. Ahora vamos a entender por qué fue tan rápida.

## El sistema no siempre llama al LLM

Cada consulta pasa por el **Organic Diagnostic Router**
(`packages/agent-core/src/adaptive-router.ts`), que decide en uno de tres modos cuánto
trabajo poner:

| Modo | Qué hace | Coste |
|---|---|---|
| `direct` | Una tool call, sin LLM | 0 llamadas al LLM |
| `assisted` | Una tool de consulta + una de contexto, el LLM resume | 1–2 llamadas |
| `investigation` | Todas las tools, loop completo, evidencia completa | hasta 6 iteraciones |

La decisión **no la toma un modelo**. `selectMode()` es una función pura sobre
`(intentionLabel, querySignals)` con una tabla de precedencia. Se extraen señales con
regex: device IDs (`olt-1`, `onu-42`), palabras de acción (`listar`, `estado`, `detalle`) y
la presencia de interrogación.

Con `estado de OLT-Norte-01` salen las tres señales: etiqueta `routine_topology`, palabra de
acción `estado` y device ID presente. La tabla da **`direct`**.

## Qué es una tool

Una tool es una lectura con nombre. Las diez del producto:

```text
get_network_overview      get_olt_detail          get_onu_detail
list_olts                 list_onus               get_onus_with_low_signal
search_by_customer_name   get_predicted_issues
get_topology_path         get_downstream_clients
```

En modo `direct` se ejecuta **una**: la más específica para la señal detectada. En tu
consulta, `get_olt_detail(oltId: "OLT-NORTE-01")`.

El resultado se formatea y se devuelve. De ahí los 3 ms.

## Cada resultado viene con un envelope

No recibís el JSON crudo del NMS. Recibís un envelope de procedencia
(`evidence.provenance.v1`), que en el demo se ve así:

```json
{
  "schema": "evidence.provenance.v1",
  "source": "smartolt.demo",
  "observedAt": "2026-09-17T22:17:39.038Z",
  "ttlMs": 3600000,
  "completeness": "complete",
  "confidence": 1,
  "data": { }
}
```

Tres campos que importan:

- **`source`** — `smartolt.demo` (fixture) o `smartolt.poll` (NMS real). `curated` para los
  issues predichos.
- **`ttlMs`** — 15 minutos para datos vivos, 60 para el demo
  (`packages/shared/src/contracts.ts:91`).
- **`completeness`** — `complete`, `partial` o `minimal`. Las tools de topología nunca
  declaran `complete`, porque las aristas caducan.

## El TruthGate le pone un veredicto

Antes de que la respuesta llegue a tu pantalla, el envelope pasa por el **TruthGate**
(`packages/evidence/src/truth-gate.ts`), que lo clasifica en cuatro dimensiones:

| Dimensión | Veredicto | Cuándo |
|---|---|---|
| Frescura | `stale` | `now > observedAt + ttlMs` |
| Confianza | `low_confidence` | confianza bajo el umbral |
| Completitud | `incomplete` | `completeness != complete` |
| Todo ok | `ok` | — |

En el demo, el envelope está fresco, completo y con confianza 1: el veredicto es **`ok`**.

Probá el otro caso. Hacé una consulta de topología, que devuelve `completeness: partial`:

```
topología de OLT-Norte-01
```

Ahí el veredicto pasa a `incomplete`.

## Qué pasa cuando el veredicto no es `ok`

En modo `strict` (el default) la política es **asimétrica**
(`packages/evidence/src/abstention-policy.ts:79`):

```text
incomplete            → abstain  (el LLM NO habla; responde el sistema)
stale                → warn     (se avisa, pero se responde)
low_confidence       → warn
ok                   → allow
```

Es decir: **falta información ⇒ se abstiene; la información es vieja ⇒ se avisa**. Un dato
de hace 20 minutos es menos útil, pero no es inventado.

Cuando se abstiene, la respuesta no es un texto del modelo: es un payload estructurado
`ftth.abstention.v1` con `reason`, `missing`, `available`, `nextStep` y `toolsAffected`. El
`nextStep` nunca está vacío: el sistema siempre dice qué haría falta para responder.

## Probá el modo que sí usa el LLM

Ahora una pregunta de causa raíz:

```
¿Cuál es la causa raíz de la caída de RX en OLT-Este-01?
```

La etiqueta es `advisory`, y en la tabla de precedencia **advisory siempre va a
`investigation`**. El modo usa todas las tools, retrieval completo, TruthGate, y hasta 6
iteraciones del loop de tool calls.

El costo en tokens es otra historia. Mirá la métrica:

```bash
curl -s http://localhost:3001/api/metrics | grep ftth_copilot_router_dispatches
```

`ftth_copilot_router_dispatches_total` cuenta los despachos por modo. Vas a ver `direct` y
`investigation` en proporción distinta.

## El registro de veredictos

Cada veredicto queda persistido. Podés verlos en el panel de auditoría
(`/api/audit`) o en la tabla `verdict_log`
(`packages/db/prisma/schema.prisma:664`).

Cada fila es un (mensaje, tool call) con `code`, `severity`, `observedAt` e
`injectionSuspicion`. Eso responde a la pregunta "por qué el agente dijo eso", y es lo que
permite medir la tasa de abstención en el harness de evaluación.

## Lo que aprendiste

- El router decide cuánto pensar, y lo decide con una tabla, no con un modelo.
- Cada lectura viene con un envelope que dice de dónde salió y cuánto vale.
- El TruthGate clasifica ese envelope, y en modo strict la evidencia incompleta **corta** la
  respuesta del LLM.
- Todo queda registrado.

## Siguiente

Ya entendés el camino corto. El siguiente tutorial te da el entorno de desarrollo para
poder tocar el código: [Tutorial 3 — Entorno local](tutorial-3-entorno-local.md).
