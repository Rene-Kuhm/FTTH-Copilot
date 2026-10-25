# Evidencia y Truth Gate

Este es el mecanismo central del producto: **una respuesta del agente no vale más que la
evidencia que la sostiene**, y el sistema está diseñado para que esa relación sea verificable
y auditable.

## El problema que resuelve

Un LLM conectado a un NMS puede producir tres cosas indistinguibles a simple vista:

1. Un dato real que acaba de leer del NMS.
2. Una inferencia razonable, pero sin respaldo directo.
3. Una invención.

En un NOC, los tres casos se ven igual en la pantalla del operador. El costo del error no es
un bug de software: es una visita técnica innecesaria, o un equipo de campo que sube a una
torre que no estaba caída.

La respuesta de FTTH-Copilot no es "pedirle al modelo que sea honesto". Es **estructural**:
toda salida del agente pasa por un clasificador determinista antes de llegar al operador.

## El envelope de procedencia

Cada resultado de tool call se envuelve en `evidence.provenance.v1`
(`packages/shared/src/contracts.ts:75-84`):

```json
{
  "schema": "evidence.provenance.v1",
  "source": "smartolt.poll",
  "tenantId": "t1",
  "observedAt": "2026-09-17T22:17:39.038Z",
  "ttlMs": 900000,
  "completeness": "complete",
  "confidence": 1,
  "data": { }
}
```

Ocho campos, y cada uno responde a una pregunta distinta:

| Campo | Pregunta que responde |
|---|---|
| `source` | ¿de dónde salió esto? (`smartolt.poll`, `smartolt.demo`, `curated`, `mikrowisp.poll`) |
| `observedAt` | ¿cuándo se observesó? |
| `ttlMs` | ¿cuánto vale este dato antes de caducar? |
| `completeness` | ¿viene completo, parcial o es un mínimo? |
| `confidence` | ¿cuán segura es la lectura? |
| `tenantId` | ¿de quién es este dato? |
| `data` | el contenido |
| `schema` | el literal de versión, para que un cambio de contrato rompa en vez de desviar |

### Dos regímenes de TTL

`DEFAULT_TTL_MS = 15 min` para datos vivos y `DEMO_TTL_MS = 60 min` para el modo demo
(`packages/shared/src/contracts.ts:91`, `:93`). La diferencia es deliberada: en demo no hay
equipo real al que volver a preguntar, así que el dato vale más tiempo.

### La completitud no es uniforme

`PROVENANCE_TOOL_META` (`packages/agent-core/src/tools/provenance.ts:54-66`) define por tool
qué metadatos lleva el envelope:

| Tipo de tool | `completeness` | `confidence` | TTL |
|---|---|---|---|
| `get_predicted_issues` | `minimal` | 0.5 | 60 s |
| Detalle y búsqueda | `partial` | 0.8 | — |
| Topología | `partial` | 0.9 | — |
| Listados | `complete` | 1.0 | — |

**Ninguna tool de topología declara `complete`**, porque las aristas caducan blandas: un
grafo de topología siempre puede tener una arista vencida. Declararlo completo sería
mentir sobre la antigüedad del dato.

El envelope se construye y se re-valida **antes de salir de la capa de tools**
(`packages/agent-core/src/tools/index.ts:46`): si el `safeParse` falla, el tool devuelve un
payload de error en español en vez de propagar un objeto inválido (`tools/index.ts:77-81`).

## El Truth Gate: un clasificador de cuatro dimensiones

`packages/evidence/src/truth-gate.ts` clasifica cada envelope en un `VerdictCode`. Las
dimensiones son independientes, y la más grave gana:

| Dimensión | Veredicto | Qué mide |
|---|---|---|
| Confianza | `low_confidence` | el `confidence` declarado está por debajo del umbral |
| Frescura | `stale` | `now > observedAt + ttlMs` |
| Completitud | `incomplete` | `completeness` no es `complete` |
| Todo ok | `ok` | — |

`rankVerdicts` (`truth-gate.ts:118-137`) define el orden de precedencia:
`incomplete > stale > low_confidence > ok`.

El reloj `now` es inyectable, lo que hace la clasificación testeable sin esperar.

### Observar no es bloquear

En **modo `observe`**, el TruthGate registra el veredicto pero **nunca interrumpe el flujo de
datos**. El docstring del módulo lo dice explícitamente (`truth-gate.ts:6-9`): *never throws
and never blocks data flow*. Esto existe para poder desplegar la clasificación en toda la
flota y medirla antes de dejar que frene respuestas.

## La abstención es asimétrica

En **modo `strict`** (el default), la política vive una capa más arriba, en
`packages/evidence/src/abstention-policy.ts:79`:

```text
shouldAbstain(verdicts, mode)
  strict:   hay 'incomplete'           → 'abstain'
            hay 'stale' o 'low_confidence' → 'warn'
            todo 'ok'                   → 'allow'
  observe:  siempre                     → 'allow'
```

La asimetría es el punto: **la evidencia incompleta detiene la respuesta; la evidencia vieja
o de baja confianza sólo advierte**. Una respuesta con un dato de hace 20 minutos es menos
útil, pero no es inventada; una respuesta a la que le falta la mitad de los campos sí lo es.

Cuando el veredicto dispara `abstain`, `runAgent` **reemplaza el texto del LLM** por un
payload estructurado `ftth.abstention.v1`
(`packages/shared/src/contracts.ts`), con:

- `reason`: el `VerdictCode` que disparó la abstención.
- `claim`: la afirmación que el modelo quiso hacer (para que el operador la pueda evaluar).
- `missing`: qué evidencia faltó.
- `available`: qué evidencia sí había.
- `nextStep`: qué hacer a continuación. **No vacío** — es obligatorio por schema.
- `toolsAffected`: qué tools estaban involucradas.

El LLM no decide si se abstiene. La decisión es de código determinista; el LLM sólo aporta
el texto del `claim`, que queda visible.

### Modo por tenant

`TRUTH_GATE_MODE` es el default global, pero la política por tenant tiene precedencia:
`tenantPolicy.truthGateMode > process.env.TRUTH_GATE_MODE > DEFAULT_TRUTH_GATE_MODE`
(`packages/agent-core/src/runtime.ts:314`). Un ISP puede observar en su flota mientras otro
exige strict, sin redeploy.

## Los incidentes confirmados son contexto, nunca evidencia

Este es un matiz importante y a menudo mal entendido.

`retrieveRelevantIncidents` (`packages/evidence/src/relevant-incidents.ts:96`) recupera
incidentes confirmados mediante BM25 en memoria
(`packages/evidence/src/bm25-lite.ts:76`) con `RRF_K = 60`, `MIN_SPARSESCORE = 0.05` y
`DEVICE_HINT_BOOST = 1.5` (`relevant-incidents.ts:21-33`).

Esos incidentes sirven para que el agente sepa **qué se hizo la última vez que pasó algo
parecido**. Pero su docstring es explícito: *never enter the Truth Gate data path*
(`relevant-incidents.ts:6-9`). Un incidente confirmado del pasado **nunca** puede
convertir una evidencia incompleta en suficiente. Si lo hiciera, el sistema aprendería a
contar historias en vez de medir.

## Lo que queda registrado

Cada veredicto se persiste en `VerdictLog`
(`packages/db/prisma/schema.prisma:664`): una fila por (mensaje, tool call) con `code`,
`severity`, `observedAt` y `injectionSuspicion`. Eso permite tres cosas que no serían
posibles sin el log:

1. Auditar por qué el agente respondió lo que respondió.
2. Medir la tasa de abstención por tenant y por tool en el harness de eval.
3. Detectar intentos de prompt injection que lleguen por el contenido de los datos
   (`injectionSuspicion`).

## En una línea

El sistema no confía en el LLM. Confía en el envelope. El LLM redacta; el TruthGate dicta
cuándo esa redacción puede publicarse.
