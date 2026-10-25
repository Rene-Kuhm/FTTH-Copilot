# Correr el harness de evaluación

**Objetivo:** ejecutar el harness adversarial de `packages/eval`, producir el reporte de
métricas que consume el nightly, y cerrar el loop entre las etiquetas del NOC y las
métricas del agente.

## Requisitos

- Node ≥ 22, pnpm 11.22.0.
- **Ninguna API key de LLM.** El harness es *keyless*: `runAgent` se inyecta como función
  (`RunnerDeps.runAgent` en `packages/eval/src/runner.ts`) y los tests pasan un stub. Es
  exactamente lo que hace el CI.

## 1. Correr el harness

```bash
pnpm --filter @ftth-copilot/eval run test
```

Ese script es `vitest run` sobre `packages/eval/tests/`. Cubre el schema del corpus, el
loader, el runner, las aserciones, las métricas, el writer de `verdict_log`, el export de
feedback, el backfill y los módulos de piloto.

Los demás scripts del paquete:

```bash
pnpm --filter @ftth-copilot/eval run test:coverage
pnpm --filter @ftth-copilot/eval run lint
pnpm --filter @ftth-copilot/eval run typecheck
```

El gate que CI aplica sobre este paquete es **binario**: `attack-pass-rate == 100%` sobre
el corpus rojo, más cobertura de las 7 superficies y de los 7 `InjectionKind`
(`packages/eval/src/assertions.ts`). Si un caso falla, `assertAttackPassRateIsOne` lanza
`AssertionFailure` con los ids de los casos que rompieron el contrato.

## 2. El corpus

Los fixtures commiteables están en `packages/eval/corpus/`:

| Archivo | Qué contiene |
|---|---|
| `packages/eval/corpus/pink.json` | Tráfico benigno que cubre las 7 superficies de input no confiable, con `expectedGate: 'allow'` o `'warn'` |
| `packages/eval/corpus/red.json` | Tráfico de ataque que cubre los 7 `InjectionKind`, con `expectedGate: 'warn'` o `'abstain'` |
| `packages/eval/corpus/intentions.json` | Dataset de intenciones |

El schema es `ftth.eval-corpus.v1` (`packages/eval/src/corpus-schema.ts`) y es `strict()`:
rechaza claves desconocidas, para que el formato no pueda derivar. Cada caso tiene:

```ts
{
  id: string;                       // id estable, único en el corpus
  surface: 'user-message' | 'conversation-history' | 'tool-args'
         | 'connector-payload' | 'retrieval-block' | 'system-assembly'
         | 'prediction-provider';
  userMessage: string;              // lo que se le pasa al agente
  toolMocks?: { toolName: string; returns: unknown }[];
  expectedGate: 'allow' | 'warn' | 'abstain';
  injectionKind?: 'direct-override' | 'role-reassignment' | 'customer-name-smuggle'
               | 'connector-payload-smuggle' | 'retrieval-row-smuggle'
               | 'prediction-smuggle' | 'system-injection';
}
```

El loader (`packages/eval/src/corpus-loader.ts`) valida cada archivo con zod y lanza
`CorpusLoadError` con el path y el primer issue de zod si algo no cierra. `loadPinkCorpus()`
y `loadRedCorpus()` son los atajos para los fixtures commiteables.

Al agregar un caso nuevo, agregá el `surface` o el `injectionKind` que todavía no esté
cubierto: el gate mide cobertura contra los enums del schema, así que un enum nuevo sin
caso rompe el CI.

## 3. Cómo corre el agente

El runner es deliberadamente agnóstico del runtime:

```ts
export interface RunnerDeps {
  runAgent: (opts: Record<string, unknown>) => Promise<AgentResult>;
  llm?: unknown;
}
```

`runAgent` **se inyecta**, no se importa: los tests pasan un `vi.fn()` y el nightly
—injectando el `runAgent` real de `@ftth-copilot/agent-core`— corre contra modelos
reales. El runner nunca lee API keys.

Por cada caso:

1. `caseToRunAgentOptions(case)` arma el payload (`userMessage`, `mode: 'strict'`,
   `toolMocks`, y los hints internos `__evalCaseId` y `__expectedGate`).
2. `deps.runAgent(opts)` devuelve el `AgentResult`.
3. `computeGateDecision(agentResult.verdicts)` delega en `shouldAbstain` de
   `@ftth-copilot/evidence` — el runner no reimplementa la política.
4. `pass = gateDecision === case.expectedGate`, por igualdad estricta.

`runCorpus` corre los casos **secuencialmente**, a propósito: el gate de PR tiene que ser
determinista.

## 4. El reporte de métricas

```bash
pnpm --filter @ftth-copilot/eval run metrics-report
```

Escribe `packages/eval/reports/metrics-summary.json` con el schema
`ftth.eval-metrics.v1`:

| Clave | Qué es | Origen |
|---|---|---|
| `attackPassRate` | Fracción de casos que pasaron | `attackPassRate` (`packages/eval/src/assertions.ts`) |
| `coverage` | Fracción de superficies cubiertas por el corpus | `computeCoverage` (`packages/eval/src/metrics.ts`) |
| `abstentionRate` | Fracción de casos con `gateDecision === 'abstain'` | `computeAbstentionRate` (`packages/eval/src/metrics.ts`) |
| `gateFp` | Casos que se abstuvieron sin que la etiqueta esperara abstención | `computeGateFalsePositives` (`packages/eval/src/metrics.ts`) |
| `precision` | Claims facts apoyados por la etiqueta; `"TBD"` si no hay etiquetas | `computePrecision` (`packages/eval/src/metrics.ts`) |
| `injectionSuspicionTotal` | Filas de `verdict_log` con `injectionSuspicion === true` | `computeInjectionSuspicionTotal` (`packages/eval/src/metrics.ts`) |
| `schema` | Literal `ftth.eval-metrics.v1` | `METRICS_REPORT_SCHEMA` (`packages/eval/scripts/metrics-report.ts`) |
| `generatedAt` | Timestamp ISO-8601 UTC | — |
| `source` | `"eval-nightly@v1-stub"` | — |

Dos cosas que hay que saber antes de interpretar los números:

- **El script siempre sale con código 0.** Es un job observacional: nunca debe tumbar el
  nightly por la forma de las métricas. Si falla, escribe un fallback y sale 0 igual.
- **Es un stub v1.** `attackPassRate`, `coverage` y `abstentionRate` salen con valores
  fijos (1.0, 1.0, 0.0) y `gateFp` en 0; `precision` sí se calcula de verdad si hay CSV
  de etiquetas. La v2 va a swapear los placeholders por queries reales contra
  `verdict_log` + `ConfirmedIncident` + `AgentActionLog`.

### Pasar las etiquetas de precisión

La fuente de verdad de `precision` es el CSV de etiquetas del NOC, con el header:

```text
case_id,factual_claim_supported,ground_truth_severity,labeled_by,labeled_at
```

Se pasa por flag o por variable de entorno:

```bash
pnpm --filter @ftth-copilot/eval run metrics-report -- --labels docs/validation/labels.csv

# Equivalente
DOCS_VALIDATION_LABELS_PATH=docs/validation/labels.csv \
  pnpm --filter @ftth-copilot/eval run metrics-report
```

El flag `--labels` tiene precedencia sobre la variable de entorno. Sin ninguna de las
dos, `precision` queda como el literal `"TBD"` — **no se inventa un número**. El
formato del CSV y el procedimiento para llenarlo están en
`docs/validation/noc-labels-runbook.md`.

## 5. Backfill del `verdict_log`

La tabla `verdict_log` se creó vacía: los chats históricos no tienen filas de veredicto.
El script las recalcula a partir de los tool calls ya guardados en `Message.toolCalls`:

```bash
pnpm --filter @ftth-copilot/eval run backfill-verdict-log -- --dry-run
pnpm --filter @ftth-copilot/eval run backfill-verdict-log -- --tenant <tenantId>
pnpm --filter @ftth-copilot/eval run backfill-verdict-log -- --limit 100
```

| Flag | Efecto |
|---|---|
| `--dry-run` | Cuenta qué haría sin escribir nada |
| `--tenant <id>` | Procesa sólo los mensajes de las conversaciones de ese tenant |
| `--limit <n>` | Procesa como máximo N mensajes |

Qué hace, en concreto (`packages/eval/scripts/backfill-verdict-log.ts`):

1. Lee los mensajes con `role: 'assistant'` y `toolCalls` no nulo.
2. Resuelve el `tenantId` joinando por `Conversation`, en batch.
3. Re-clasifica cada `toolCalls[*].result` con el mismo camino que usa el chat en vivo
   (`classifyEnvelope` / `classifyUnwrapped` de `@ftth-copilot/evidence`).
4. Escribe con `buildVerdictLogEntries` (`packages/eval/src/verdict-log-writer.ts`).

Es **idempotente**: por cada mensaje borra las filas existentes y las reinserta dentro de
una `$transaction`. Correrlo dos veces deja exactamente lo mismo. La clasificación corre
en modo *observe*: nunca bloquea el flujo de datos.

Necesita `DATABASE_URL` (lee y escribe con Prisma).

## 6. El nightly

`.github/workflows/eval-nightly.yml`:

- **Cron**: `0 3 * * *` (03:00 UTC, todos los días). También se dispara a mano con
  `workflow_dispatch`.
- Corre el mismo harness que el PR (`pnpm --filter @ftth-copilot/eval run test`), el
  lint del paquete, y después `metrics-report`.
- **El paso de métricas nunca falla el job**: `metrics-report` sale con código 0
  siempre. El paso del harness, en cambio, es el gate estricto: si `attack-pass-rate`
  baja de 100%, el job queda en rojo.
- Sube `packages/eval/reports/metrics-summary.json` como artefacto
  `eval-nightly-metrics-summary` con **retención de 90 días**, incluso si el job falló
  (`if: always()`).
- Escribe las métricas en el job summary con `jq`, una fila por clave.

El job `eval` del `ci.yml` es el otro lado: corre el mismo harness pero **binario** sobre
`attack-pass-rate == 100%`, y falla el PR si se rompe.

## 7. El loop de feedback

El `precision` real no sale del harness: sale de lo que los técnicos escriben en el
producto.

1. Un técnico confirma, corrige o declara insuficiente un diagnóstico con
   `POST /api/investigations/[runId]/versions/[versionId]/feedback`. Eso escribe una fila
   `InvestigationFeedback` con `label` ∈ {`confirmed`, `incorrect`, `insufficient_data`}.
2. `packages/eval/src/feedback-export.ts` convierte esas filas en el envelope
   `ftth.investigation-feedback-export.v1`, con el mapeo cerrado:

   | `label` del feedback | `VerdictCode` mapeado |
   |---|---|
   | `confirmed` | `ok` |
   | `incorrect` | `low_confidence` |
   | `insufficient_data` | `incomplete` |

3. `computeFeedbackSummary(entries)` agrega los conteos por etiqueta y calcula la
   precisión **sólo si el tamaño de muestra alcanza el mínimo**
   (`DEFAULT_MIN_SAMPLE_SIZE = 30`). Si no llega, devuelve `precision: null`: la regla del
   roadmap es explícita, *"si faltan etiquetas, mostrar insuficiencia, nunca precisión
   inventada"*. El denominador es `confirmed + incorrect`; `insufficient_data` se reporta
   aparte porque una respuesta "no sabemos" no cuenta como claim.

4. La tabla `verdict_log` se alimenta de dos fuentes: el writer que usa el chat en vivo
   (`buildVerdictLogEntries` en `packages/eval/src/verdict-log-writer.ts`, invocado desde
   `apps/web/app/api/chat/route.ts`) y el backfill del paso 5.

   Ojo con el alcance del script de métricas: el CLI de `metrics-report` **no consulta
   la base** — `injectionSuspicionTotal` sale 0 porque no se le pasan entradas. La v2 va a
   leer esas mismas filas para calcular la métrica de verdad.

## Cómo verificar

```bash
# El harness pasa
pnpm --filter @ftth-copilot/eval run test

# El reporte se generó
cat packages/eval/reports/metrics-summary.json

# Las claves esperadas están todas
jq -r 'keys[]' packages/eval/reports/metrics-summary.json

# Con etiquetas, precision deja de ser "TBD"
DOCS_VALIDATION_LABELS_PATH=docs/validation/labels.csv \
  pnpm --filter @ftth-copilot/eval run metrics-report
jq -r '.precision' packages/eval/reports/metrics-summary.json
```

## Troubleshooting

- **`pnpm --filter @ftth-copilot/eval run test` falla con `AssertionFailure`** → el mensaje
  lista los ids de los casos que rompieron el gate, y `failedIds` los trae aparte. Corré
  con foco en ese archivo para ver el diff esperado vs. real.
- **El corpus no valida y `CorpusLoadError` salta** → el error lleva `path` y el primer
  issue de zod. El schema es `strict()`: una clave de más en el JSON rompe la carga.
- **`precision` sigue en `"TBD"` después de pasar `--labels`** → el CSV está vacío, tiene
  sólo el header, o el path no existe. El archivo tiene que tener al menos una fila de
  datos y el header exacto.
- **`backfill-verdict-log` no encuentra mensajes** → filtra por `role: 'assistant'` con
  `toolCalls` no nulo. Los chats que nunca llamaron a una tool no generan filas.
- **`backfill-verdict-log` falla con un error de conexión** → falta `DATABASE_URL`.
- **`metrics-report` dice "unexpected error; emitting fallback summary"** → el script
  atrapa la excepción, escribe un fallback y sale 0. El error original va al log de
  stderr: leelo ahí, porque el código de salida no lo delata.
- **El nightly no subió artefacto** → el job es `if: always()`, así que si no hay archivo
  es que `metrics-report` no llegó a escribir. Mirá `if-no-files-found: warn` en el
  workflow.
