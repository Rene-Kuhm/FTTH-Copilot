# La investigación cognitiva

El chat responde preguntas. La **investigación** produce un diagnóstico. Son dos caminos
distintos en el producto, y entender la diferencia explica la mayor parte del diseño de
`packages/agent-core`.

## La diferencia

| | Chat | Investigación |
|---|---|---|
| Pregunta | "¿estado de OLT-Norte-01?" | "¿cuál es la causa raíz de la caída de RX en OLT-Este-01?" |
| Salida | Una respuesta en lenguaje natural | Un informe con hipótesis, evidencia a favor y en contra, y confianza |
| Persistencia | Conversación, mensajes, tool calls | Un **run** con **versiones inmutables** y snapshot |
| Reversible | No importa | Cada versión queda congelada para siempre |

La investigación se pide sobre un **incidente** (`POST /api/incidents/[id]/investigate`), no
sobre una conversación.

## Los hechos van antes que el modelo

El motor de investigación no empieza preguntándole al LLM. Empieza calculando.

`computeInvestigationFacts` (`packages/agent-core/src/investigation-facts.ts:36`) es una
función **pura** sobre referencias de evidencia: no toca el LLM, no toca la base, no tiene
efectos. El motor la corre en `packages/agent-core/src/investigation-engine.ts:193`, antes de
cualquier llamada al modelo.

Los umbrales están **en el código**, no en el prompt:

| Métrica | Umbral |
|---|---|
| Atenuación crítica | `Rx < -27.0 dBm` |
| Atenuación warning | `Rx < -25.0 dBm` |

(`investigation-facts.ts:85-86`)

El motivo es de confianza: un umbral que vive en el código tiene versión, se testea, y no
puede ser reinterpretado por el modelo. Un umbral que vive en el prompt depende de cada
corrida.

## El modelo propone, el código dispone

Después de los hechos, el LLM propone hipótesis y cita evidencia a favor y en contra. Tres
mecanismos impiden que la salida del modelo se publique sin revisión:

### 1. Filtrado estricto de citas

`packages/agent-core/src/investigation-engine.ts:245-252` descarta cualquier `forRefIds` o
`againstRefIds` que no exista en el conjunto válido de referencias. Una cita inventada no
sobrevive al filtro, y una hipótesis que queda sin citas se degrada, no se publica.

### 2. Checks de sólo lectura

`sanitizeChecks` (`investigation-engine.ts:117-140`) convierte cualquier tipo de check
prohibido en `observe_only`. El modelo puede *proponer* una acción; el sistema no la ejecuta.

### 3. Validación del schema en la salida

`investigationResultSchema.parse(result)` (`investigation-engine.ts:388`) valida el resultado
antes de devolverlo, y el validator lo re-valida otra vez al leerlo
(`investigation-validator.ts:219`, `:298`), con fallback seguro si el parse falla.

## Cuando el modelo no está, igual hay diagnóstico

Si no hay LLM configurado, si devuelve vacío, o si la llamada falla, el motor construye
hipótesis deterministas con `buildDeterministicHypotheses`
(`investigation-engine.ts:58`), invocada en los tres casos (`:324`, `:336`, `:313-314`).

Esto no es un modo degradado: es la razón por la que el producto sigue siendo útil en un
entorno sin claves de API, y por la que el harness de eval puede correr "keyless" en CI
(`docs/engineering` y el workflow `eval-nightly.yml`).

## Inmutabilidad: cada versión es una foto

Una investigación no se edita. Cada corrida produce un `InvestigationVersion`
(`packages/db/prisma/schema.prisma:719`) con:

- `versionId` e `versionIndex` — identidad e orden.
- `rulesetVersion`, `promptVersion`, `modelVersion` — **exactamente qué reglas, qué prompt y
  qué modelo produjeron esta versión**.
- `snapshotJson` y `snapshotAt` — la foto de la evidencia usada.

Los tres campos de versión son los que hacen auditable el sistema. Sin ellos, "el agente dijo
X" no es reproducible: seis meses después no se sabe si fue el prompt viejo, las reglas viejas
o el modelo viejo.

El prompt y el ruleset están versionados explícitamente en
`packages/agent-core/src/investigation-prompt.ts:4-5`:
`prompt-investigation@1.0.0` y `ruleset-investigation@1.0.0`.

## El feedback del técnico cierra el ciclo

Cuando un técnico valida o descarta un diagnóstico, se registra un
`InvestigationFeedback` (`schema.prisma:746`) con `label`
(`confirmed|incorrect|insufficient_data`), `observations`, `realCause` y
`resolutionEvidence`.

Ese feedback tiene dos destinos:

1. Alimenta el harness de eval (`packages/eval`), que mide `precision`, `abstentionRate` y
   `gateFp` todas las noches.
2. Puede promover el incidente a `ConfirmedIncident`, la **memoria inmutable** del producto
   (`POST /api/incidents/[id]/confirm`).

La promoción es **idempotente**: el primer POST devuelve 201 y los siguientes 200 con la
misma fila. Un técnico que confirma dos veces no genera dos entradas en la base de
conocimiento.

## El límite de tiempo

La ventana de evidencia está acotada: `MAX_INVESTIGATION_WINDOW_DAYS` se verifica en
`investigation-engine.ts:181-183`, y el endpoint acepta `windowDays` y `timeoutMs` (tope
15000 ms). Una investigación que busca la causa raíz de un problema de hace tres meses no es
una investigación: es una auditoría, y hay que decirlo.

## Telemetría

Cada investigación corre dentro de un span CHAIN `investigation.engine`
(`investigation-engine.ts:159`), con la cantidad de hipótesis y contradicciones como
atributos del span (`:375-383`). Eso permite medir en Phoenix u OpenTelemetry cuánto
trabajo genera cada incidente, no sólo cuánto cuesta.

## En una línea

La investigación no es "el chat pero más largo": es un proceso con hechos deterministas
primero, hipótesis del modelo después, citas filtradas contra la evidencia real, snapshot
inmutable de cada versión, y feedback humano que vuelve al corpus de evaluación.
