# ADR 0012 — Versiones de investigación inmutables y memoria de incidentes confirmados

**Estado:** Aceptada
**Fecha:** 2026-09-03 (`20260903195643_confirmed_incidents`) y 2026-09-07
(`20260907140000_investigation_run_version_feedback`,
`20260907141000_add_investigation_feedback_id_to_confirmed`)

## Contexto

Cuando el agente produce un diagnóstico, ese diagnóstico es una **afirmación causal**:
"la ONU está así por culpa de X". Es el tipo de dato que un NOC va a actuar: alguien va a
subir a una torre.

De ahí se derivan tres requisitos que tiran en direcciones opuestas si no se resuelven
con cuidado:

1. **Auditabilidad**: hace falta poder demostrar qué se le dijo al operador, con qué
   evidencia, y bajo qué reglas.
2. **Corrección**: un diagnóstico puede estar mal, y el técnico lo va a corregir.
3. **Aprendizaje**: las correcciones tienen que volver al sistema para que mejore.

Un modelo relacional mutable choca con los tres: si el diagnóstico se puede editar, el
histórico deja de ser fiable; si no se puede editar, el técnico no puede corregir.

## Decisión

Separar **el resultado** de **el conocimiento**, y hacer ambos append-only.

### La investigación produce versiones inmutables

- `InvestigationRun` (`schema.prisma:683`) es la unidad de trabajo: `runId` opaco,
  `status` (`pending|ready|failed|expired`), `requestedAt`, `windowStart?`, `windowEnd?`,
  `requestedByUserId`. Unique `[tenantId, runId]`.
- `InvestigationVersion` (`schema.prisma:719`) es la **foto**: `versionId`, `versionIndex`,
  `rulesetVersion`, `promptVersion`, `modelVersion`, `snapshotJson`, `snapshotAt`. Uniques
  `[tenantId, runId, versionIndex]` y `[tenantId, versionId]`.
- Pedir una investigación con `refresh: true` **crea una versión nueva**; la anterior no se
  toca. No hay update ni delete de versiones.
- Los tres campos de versión (`rulesetVersion`, `promptVersion`, `modelVersion`) son los que
  hacen el resultado **reproducible**: sin ellos, "el agente dijo X" no alcanza para saber
  si fue el prompt viejo, las reglas viejas o el modelo viejo. El prompt y el ruleset están
  versionados explícitamente en
  `packages/agent-core/src/investigation-prompt.ts:4-5`
  (`prompt-investigation@1.0.0`, `ruleset-investigation@1.0.0`).
- `InvestigationVersion` **no tiene relación Prisma** con `InvestigationRun`: las versiones
  se consultan por el `runId` blando (comentario `schema.prisma:707-711`).

### El feedback del técnico es una fila nueva

- `InvestigationFeedback` (`schema.prisma:746`) registra la adjudicación: `label`
  (`confirmed|incorrect|insufficient_data`), `observations?`, `realCause?`,
  `resolutionEvidence?`, `authorUserId`, `submittedAt`. Uniques
  `[tenantId, runId, versionId, authorUserId, label]` y `[tenantId, feedbackId]`.
- El endpoint es **idempotente**: el primer POST devuelve 201 y los siguientes 200 con la
  misma fila.

### Los incidentes confirmados son la memoria

- `ConfirmedIncident` (`schema.prisma:482`) es el conocimiento acumulado: `summary`,
  `symptoms` (Json), `rootCause`, `fix`, `observedAt`, `resolvedAt`, `severity`,
  `confirmedBy` (`operator|agent|system`), `searchTokens` (tokens BM25 precomputados),
  `embedding Bytes?` (pgvector diferido). Unique `[tenantId, sourceIncidentId]`.
- Hay **dos caminos** de confirmación: el operador con `POST /api/incidents/[id]/confirm`,
  o la promoción automática del agente tras la resolución. El segundo es un
  `PendingIncidentCandidate` (`schema.prisma:529`) que sólo un `OWNER` puede promover
  (`POST /api/pending-incidents/promote`).
- `ConfirmedIncident.investigationFeedbackId` y `sourceIncidentId` son **soft refs sin FK**
  (comentario `schema.prisma:491-495`): borrar un feedback **no** puede borrar el
  conocimiento acumulado.

### Los incidentes confirmados son contexto, nunca evidencia

- `retrieveRelevantIncidents` (`packages/evidence/src/relevant-incidents.ts:96`) los
  recupera por BM25 en memoria (`packages/evidence/src/bm25-lite.ts:76`), con `RRF_K = 60`,
  `MIN_SPARSESCORE = 0.05` y `DEVICE_HINT_BOOST = 1.5`.
- Su docstring es explícito: *"never enter the Truth Gate data path"*
  (`relevant-incidents.ts:6-9`). Un incidente del pasado **no** puede convertir evidencia
  incompleta en suficiente.

## Consecuencias

### Buenas

- **El histórico es fiable**: como las versiones no se editan, la auditoría de "qué se le
  dijo al operador" tiene una respuesta exacta.
- **La reproducibilidad está garantizada** por los tres campos de versión y el snapshot.
- **El técnico puede corregir sin romper nada**: el feedback es una fila nueva, y el
  diagnóstico original queda intacto junto a él.
- **El conocimiento sobrevive a sus fuentes**: las soft refs garantizan que purgar
  feedbacks o incidentes no purgue la base de conocimiento.
- **La idempotencia del POST de confirmación** evita duplicar entradas en la KB cuando un
  técnico confirma dos veces o cuando dos peticiones compiten.
- El **snapshot inmutable** es lo que permite auditar un incidente meses después, cuando el
  estado de la red ya cambió.
- La separación versión/feedback permite que el harness de eval use exactamente los mismos
  labels que el operador produjo en producción.

### Malas

- **Las tablas crecen sin límite.** `InvestigationVersion` guarda el snapshot completo de
  la evidencia por versión, y no hay política de retención para ninguna de las tres tablas.
- El **snapshot duplica datos**: cada versión guarda su propia copia de la evidencia usada.
  Es lo que lo hace fiable y, a la vez, lo que lo hace caro.
- `InvestigationVersion` **sin relación Prisma** significa que el ORM no garantiza la
  integridad referencial entre run y versión, y que la navegación entre ambos es manual.
- `searchTokens` son **tokens BM25 precomputados**: la búsqueda no mejora si el texto se
  actualiza, porque el precomputado queda viejo.
- `embedding` está definido pero **sin usar**: el retrieval es BM25. La columna existe para
  una fase posterior.
- La promoción automática del agente a `ConfirmedIncident` **requiere un `OWNER`**
  (`POST /api/pending-incidents/promote`): el sistema no se auto-aprueba knowledge, lo cual
  es correcto pero añade un paso humano a un flujo que se pretendía automático.
- `PendingIncidentCandidate` queda huérfano si nadie lo promueve: no hay limpieza.

### Abiertas

- No hay política de retención para `InvestigationVersion`, `InvestigationFeedback` ni
  `ConfirmedIncident`. Es el mismo problema que ya tiene `DecisionEvaluation`.
- El gate de "5000 ejemplos reales" para entrenar un modelo (ver
  [ADR 0009](0009-laya-como-capa-de-decision-rapida.md)) no está automatizado.
- La búsqueda semántica sigue pendiente; hoy el recall es léxico y por device hint.
