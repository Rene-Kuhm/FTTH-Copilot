# `@ftth-copilot/learning`

Núcleo puro del learning loop. Funciones deterministas: sin Prisma, sin Redis, sin red y sin
reloj implícito. El tiempo entra siempre como parámetro.

Esta es la **Fase 0** (`odd/tasks/learning-loop.md`): la verdad de base. Ninguna fase cambia
lo que ve el usuario hasta la Fase 6.

## Qué hay adentro

| Módulo | Qué hace |
|---|---|
| `src/types.ts` | Contratos de datos del paquete: filas de feedback, incidentes, aristas topológicas, eventos, reportes de suficiencia. |
| `src/labels.ts` | Resolución de etiquetas según D1 (T0.2). |
| `src/events.ts` | Agrupación en eventos y split temporal según D9 (T0.3). |
| `src/sufficiency.ts` | Insuficiencia honesta según I10 (T0.4). |

## Por qué un paquete aparte

El learning necesita de `InvestigationFeedback`, de `TopologyEdge` y de las métricas de
precisión. Si esa lógica viviera en `packages/eval` arrastraría Prisma; si viviera en
`packages/evidence` cruzaría la pared del Truth Gate. Como paquete propio:

- es **puro**: se testea sin base de datos y sin Redis;
- es **determinista**: mismo input ⇒ mismo output byte a byte (invariante I8);
- la **pared del Truth Gate** es comprobable: `tests/import-graph.test.ts` lee el código de
  `packages/evidence` y falla si algo de ahí alcanza a este paquete (invariante I1).

## Contratos canónicos

El juego cerrado de etiquetas (`FEEDBACK_LABELS`) y el umbral de muestra mínima
(`DEFAULT_MIN_SAMPLE_SIZE`) viven en `packages/shared/src/learning.ts`. `packages/eval` y
`apps/web` los reexportan para no cambiar su API pública: un tipo duplicado en dos paquetes
es un bug (AGENTS.md §4).

## T0.2 — Resolución de etiquetas (D1)

```ts
resolveLabels(rows, { knownVersionIds? }): LabelResolution;
partitionForTraining(resolution): TrainingPartition;
```

- **Una sola opinión por autor**: la de `submittedAt` más reciente. Si dos filas del mismo
  autor empatan en el tiempo, gana la de `feedbackId` mayor, para que dos corridas sobre las
  mismas filas den el mismo resultado (I8).
- **Consenso**: si todos los autores coinciden, esa etiqueta; si discrepan, `conflicted` —
  fuera del entrenamiento y contado aparte, porque una tasa alta de conflicto señala
  diagnósticos ambiguos.
- **`insufficient_data` nunca es positiva ni negativa**: alimenta el corpus de abstención (I7).
- **Las filas que no se pueden usar se descartan contadas por motivo** (`invalidLabel`,
  `orphanVersion`, `malformed`). Descartarlas en silencio mentiría sobre el tamaño real de la
  muestra.
- **Aislamiento por tenant**: dos tenants que compartan `versionId` nunca se mezclan (I3).

## T0.3 — Agrupación en eventos y split temporal (D9)

```ts
groupIntoEvents(incidents, topology, windowMs?): LearningEvent[];
temporalSplit(events, cutoff): TemporalSplit;
```

- **Ancestro topológico compartido**: dos incidentes se agrupan si comparten un ancestro en
  `TopologyEdge` **vigente en su `observedAt`**. La topología es temporal: una arista vencida
  o que todavía no empieza no correlelaciona.
- **Ventana de 2 h** (`DEFAULT_EVENT_WINDOW_MS`): la agrupación es transitiva — si A une con B
  y B une con C, los tres son un evento.
- **La topología es por tenant**: dos tenants que usen el mismo id de nodo no se mezclan (I3).
- **El `eventId` es determinista**: sale del contenido (sha256 de tenant + incidentes), nunca
  del reloj (I8).

`temporalSplit` parte en `train` (antes de `T`, **más** lo que cruza el corte) y `eval`
(estrictamente después de `T`). Un evento que cruza el corte va a `train` a propósito: si fuera
a `eval`, la evaluación mediría sobre incidentes que el modelo ya vio. El subconjunto que
cruza queda listado en `crossing`.

## T0.4 — Insuficiencia honesta (I10)

```ts
sampleSufficiency(sampleSize, compute, { minSampleSize? }): SufficiencyResult<T>;
sufficiencyReport(metrics, { minSampleSize? }): SufficiencyReport;
```

- Bajo el umbral devuelve `insufficient` con `value: null`: **nunca** un número.
- La función `compute` **no se invoca** bajo el umbral, así que no hay forma de que un
  número se escape por un camino lateral.
- El umbral por defecto es `DEFAULT_MIN_SAMPLE_SIZE` (30), el mismo que usa
  `computeFeedbackSummary` en `packages/eval`: los dos leen la constante de
  `@ftth-copilot/shared`, así que no pueden divergir.
- `sufficiencyReport` marca cada métrica y `isCalibrated` solo es `true` si **todas** tienen
  muestra suficiente: un artefacto con una sola métrica sin muestra no se puede promover.

## Tests

```bash
pnpm --filter @ftth-copilot/learning test
```

Umbrales de cobertura del núcleo: 80% líneas, 80% funciones, 70% ramas, 80% sentencias.
