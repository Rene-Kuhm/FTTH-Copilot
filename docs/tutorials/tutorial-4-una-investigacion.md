# Tutorial 4 — Una investigación de punta a punta

**Objetivo:** pedir un diagnóstico formal sobre un incidente, entender su estructura
—hipótesis, evidencia a favor y en contra, checks de sólo lectura— y ver cómo cada versión
queda congelada.

**Requiere:** el entorno local del [Tutorial 3](tutorial-3-entorno-local.md), con datos de
demo.

---

## La diferencia con el chat

El chat responde preguntas. La **investigación** produce un diagnóstico formal sobre un
incidente, con tres diferencias:

| | Chat | Investigación |
|---|---|---|
| Se pide sobre | Una conversación | Un **incidente** |
| Salida | Texto en lenguaje natural | Informe con hipótesis y evidencia |
| Persistencia | Mensajes | Un **run** con **versiones inmutables** |
| Reversible | No importa | Cada versión queda congelada |

## 1. Prepará un incidente

Las investigaciones se piden sobre un incidente, no sobre una ONU suelta. Podés abrir uno
desde la UI (panel de incidentes) o por la API:

```bash
curl -s -X POST http://localhost:3001/api/incidents \
  -H 'Content-Type: application/json' \
  -b 'ftth_session=<tu-cookie>; ftth_csrf=<tu-csrf>' \
  -H 'X-CSRF-Token: <tu-csrf>' \
  -d '{
    "deviceKind": "ONU",
    "deviceId": "onu-scenario-1",
    "title": "Caída de RX en onu-scenario-1",
    "severity": "warning"
  }'
```

Si ya existe un incidente abierto o acusado para ese equipo, la API responde
**409** con `{error, existingId}` (`apps/web/app/api/incidents/route.ts`).

Guardate el `id` que devuelve.

> El CSRF es obligatorio en métodos mutantes: el middleware exige que el header
> `X-CSRF-Token` coincida con la cookie `ftth_csrf`
> (`apps/web/middleware.ts:127`). Ver
> [Agregar un endpoint de la API](../how-to/agregar-un-endpoint-de-la-api.md).

## 2. Pedí la investigación

```bash
curl -s -X POST http://localhost:3001/api/incidents/<ID>/investigate \
  -H 'Content-Type: application/json' \
  -b 'ftth_session=<tu-cookie>; ftth_csrf=<tu-csrf>' \
  -H 'X-CSRF-Token: <tu-csrf>' \
  -d '{"windowDays": 7}'
```

Respuestas posibles:

- **202** `{runId, status:'pending', retryAfterMs:3000}` — la investigación es asíncrona;
  esperá y consultá de nuevo.
- **201** `{runId, versionId, versionIndex, status:'ready', result}` — salió de una.
- **429** `{error:'Investigation quota exceeded', retryAfter}` — te pasaste de la cuota
  (`INVESTIGATION_RATE_LIMIT_PER_MINUTE`, default 10).

Podés ver el estado con:

```bash
curl -s http://localhost:3001/api/incidents/<ID>/investigate -b 'ftth_session=<tu-cookie>'
```

## 3. Leé la estructura del resultado

El resultado sigue el schema `ftth.investigation-result.v1`
(`packages/shared/src/contracts.ts`). Las partes que importan:

### Hechos deterministas primero

El motor **no** le pregunta al LLM qué está mal. Empieza calculando
`computeInvestigationFacts` (`packages/agent-core/src/investigation-facts.ts:36`), una
función pura sobre las referencias de evidencia. Los umbrales están en el código, no en el
prompt:

| Métrica | Umbral |
|---|---|
| Atenuación crítica | `Rx < -27.0 dBm` |
| Atenuación warning | `Rx < -25.0 dBm` |

### Hipótesis con citas

Después el modelo propone hipótesis, y cada una cita las referencias que la apoyan
(`forRefIds`) y las que la contradicen (`againstRefIds`).

Las citas se filtran contra el conjunto válido de referencias
(`packages/agent-core/src/investigation-engine.ts:245-252`): **una cita que no existe se
descarta**. Una hipótesis que queda sin citas no se publica como si tuviera respaldo.

### Checks de sólo lectura

Cada check propuesto por el modelo es forzado a `observe_only` si es de un tipo prohibido
(`investigation-engine.ts:117-140`). El modelo puede *proponer* una acción; el sistema no la
ejecuta.

### Confianza y veredicto

El resultado pasa por `investigationResultSchema.parse()` al salir del motor
(`investigation-engine.ts:388`) y se re-valida al leerlo
(`packages/agent-core/src/investigation-validator.ts:219`).

## 4. Mirá las versiones

```bash
curl -s http://localhost:3001/api/incidents/<ID>/investigate -b 'ftth_session=<tu-cookie>'
```

Cada versión trae **exactamente qué la produjo**:

| Campo | Qué es |
|---|---|
| `versionId` / `versionIndex` | Identidad y orden |
| `rulesetVersion` | Las reglas aplicadas (`ruleset-investigation@1.0.0`) |
| `modelVersion` | El modelo |
| `snapshotAt` | Cuándo se tomó la foto de la evidencia |
| `snapshot` | La foto |

El snapshot es lo que hace el resultado **reproducible**: sin él, "el agente dijo X" no
alcanza para saber si fue el prompt viejo, las reglas viejas o el modelo viejo.

Pedir una investigación con `{"refresh": true}` genera una **versión nueva**; la anterior
no se toca. Las versiones se persisten en `InvestigationVersion`
(`packages/db/prisma/schema.prisma:719`).

## 5. Registrá tu veredicto como técnico

Cuando el diagnóstico es correcto (o no), registralo. Eso alimenta el harness de
evaluación:

```bash
curl -s -X POST \
  http://localhost:3001/api/investigations/<RUN_ID>/versions/<VERSION_ID>/feedback \
  -H 'Content-Type: application/json' \
  -b 'ftth_session=<tu-cookie>; ftth_csrf=<tu-csrf>' \
  -H 'X-CSRF-Token: <tu-csrf>' \
  -d '{
    "label": "confirmed",
    "observations": "Coincide con la medición en sitio.",
    "realCause": "Conector sucio en la caja de distribución.",
    "resolutionEvidence": "Se limpió el conector y el RX volvió a -19 dBm."
  }'
```

Los labels son `confirmed`, `incorrect` o `insufficient_data`. El endpoint es idempotente:
el primer POST devuelve 201, los siguientes 200 con la misma fila.

## 6. Confirmá el incidente (opcional)

Si el incidente está resuelto y querés que entre en la memoria del producto:

```bash
curl -s -X POST http://localhost:3001/api/incidents/<ID>/confirm \
  -H 'Content-Type: application/json' \
  -b 'ftth_session=<tu-cookie>; ftth_csrf=<tu-csrf>' \
  -H 'X-CSRF-Token: <tu-csrf>' \
  -d '{
    "rootCause": "Conector sucio en la caja de distribución.",
    "fix": "Limpieza del conector y sellado.",
    "summary": "Caída de RX por conector sucio en CTO."
  }'
```

El incidente confirmado se guarda en `ConfirmedIncident` con sus tokens BM25 precomputados
(`searchTokens`). A partir de ahí, las consultas similares lo recuperan como **contexto de
fondo** — nunca como evidencia. Ver
[Evidencia y Truth Gate](../explanation/evidencia-y-truth-gate.md).

## 7. Mirá las métricas

```bash
curl -s http://localhost:3001/api/metrics | grep -E 'ftth_copilot_(llm|rag)'
```

Y el resultado del harness, que corre todas las noches:

```bash
pnpm --filter @ftth-copilot/eval run metrics-report
```

Escribe `packages/eval/reports/metrics-summary.json`. Las métricas son
`attackPassRate`, `coverage`, `abstentionRate`, `gateFp`, `precision` y `schema`.

## Si algo falla

- **429 en el POST** — se agotó la cuota. Esperá `retryAfter` segundos, o subí
  `INVESTIGATION_RATE_LIMIT_PER_MINUTE`.
- **404 `Incident not found`** → el incidente no es de tu tenant.
- **La investigación tarda y devuelve `pending`** → es el flujo normal: el `202` te dice
  que reintentes en 3 segundos.
- **El resultado no tiene hipótesis** → el motor cayó al fallback determinista
  (`buildDeterministicHypotheses`), que ocurre cuando no hay LLM configurado, cuando el
  modelo devuelve vacío o cuando la llamada falla.

---

## Qué aprendiste

- La investigación tiene hechos deterministas **antes** del modelo.
- Las citas del modelo se filtran contra la evidencia real.
- Cada versión queda congelada con el ruleset, el prompt y el modelo que la produjeron.
- Tu veredicto como técnico es lo que hace que el sistema mejore.

## Dónde seguir

- [Investigación cognitiva](../explanation/investigacion-cognitiva.md) — el diseño completo.
- [Correr el harness de evaluación](../how-to/correr-el-harness-de-evaluacion.md) — cómo se
  mide.
- [ADR 0012 — Versiones inmutables](../adr/0012-versiones-inmutables-y-memoria-confirmada.md)
  — la decisión y sus consecuencias.
