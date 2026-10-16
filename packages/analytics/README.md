# `@ftth-copilot/analytics`

Analítica del pipeline de telemetría FTTH. El paquete cubre tres tramos:

1. **Ingesta**: sacar una foto del estado de un conector NMS
   (`collectSamples`), persistirla como filas de `metricSample`
   (`persistSamples`) y acotar el crecimiento de la tabla (`runRetention`).
2. **Detección y scoring**: encontrar anomalías sobre series estacionales
   (`detectAnomalies`, `groupAnomalies`) y decidir cuánto creerle a una
   situación correlacionada (`extractFeatures`, `scoreSituation`,
   `updateWeights`).
3. **SLA**: calcular uptime sobre una ventana a partir de muestras puntuales de
   estado (`computeUptime`).

No expone rutas HTTP ni UI. Salvo `ingest.ts` y `retention.ts`, que escriben en
la base a través de `@ftth-copilot/db`, todo es cálculo puro sobre arreglos y
números: se puede testear sin base y sin red.

Dependencias de workspace: `@ftth-copilot/connectors-core` (interfaz
`INmsConnector`) y `@ftth-copilot/db` (Prisma).

## Módulos

| Archivo | Qué es |
| --- | --- |
| `src/types.ts` | Tipos neutrales (DB-agnostic) de la ingesta: `MetricPoint`, `MetricKind`, `DeviceKind`, `SampleMeta` y `CollectOptions`. No dependen de Prisma para poder testear el colector sin base. |
| `src/collect.ts` | `collectSamples(connector, meta, opts?)`: convierte el estado actual del conector en una lista plana de `MetricPoint`. Usa solo endpoints bulk (`listOlts` + `listOnus`) por defecto; el detalle por OLT/ONU se pide con `includeOltDetail` / `includeOnuDetail`, con fan-out acotado y sin abortar el lote si falla un dispositivo. |
| `src/ingest.ts` | `persistSamples(points)` inserta el lote en `metricSample` y devuelve `{ inserted }` (un lote vacío es no-op); `deleteSamplesBefore(cutoff, tenantId?)` borra lo estrictamente anterior al cutoff, opcionalmente acotado a un tenant. |
| `src/retention.ts` | `runRetention({ retentionDays, now?, tenantId? })`: calcula el cutoff `now - retentionDays` y delega la purga en `deleteSamplesBefore`, para que los detectores trabajen sobre una ventana reciente y acotada. |
| `src/anomaly.ts` | Detección robusta sobre series estacionales: `seasonalDecompose` (tendencia por mediana corrida + perfil estacional por fase) → `robustZScore` (mediana/MAD) → `detectAnomalies`, con filtro de comunidad temporal. `groupAnomalies` colapsa las anomalías contiguas en un grupo por incidente. |
| `src/correlation-score.ts` | Clasificador logístico online (perceptrón) sobre features de red hechas a mano: `extractFeatures` deriva el vector normalizado a [0, 1], `defaultWeights()` da los priors, `scoreSituation` pondera y devuelve confianza + severidad, y `updateWeights` ajusta los pesos con cada resultado etiquetado. |
| `src/scenario.ts` | `buildNocDegradationScenario(meta, opts?)`: genera una serie sintética de degradación de una ONU (RX bajando sin cruzar el umbral de offline, FEC corregidos creciendo, incorregibles en el último tercio y bias cayendo) para probar el NOC sin hardware. |
| `src/scheduler-helpers.ts` | Helpers puros del fan-out programado: `pickFecFanOutSlice` (rotación determinista sobre la lista de ONUs), `fitsRateBudget` (techo de requests por hora), `assembleOnuDetailPoints` (puntos FEC/ópticos/LOS de un `OnuDetail`, salteando campos no finitos) y `mapAllSettled` (concurrencia acotada que captura el error por ítem). |
| `src/sla.ts` | `computeUptime(samples, window)`: reparte la ventana en tiempo medido (entre muestras consecutivas) y no medido (antes de la primera muestra y después de la última), y devuelve `uptimePercent` (o `null` si no hay par de muestras) junto con `coveragePercent`. |

## Ejemplo de uso real

Ciclo de polling: muestrear, persistir y purgar lo viejo.

```ts
import type { INmsConnector } from '@ftth-copilot/connectors-core';
import {
  collectSamples,
  persistSamples,
  runRetention,
} from '@ftth-copilot/analytics';

const meta = { tenantId: 't1', connectionId: 'c1' };

export async function pollOnce(connector: INmsConnector): Promise<void> {
  const points = await collectSamples(connector, meta); // solo endpoints bulk
  await persistSamples(points);
  await runRetention({ retentionDays: 90, tenantId: meta.tenantId });
}
```

Análisis puro (sin base): anomalías, scoring de correlación y uptime.

```ts
import {
  computeUptime,
  defaultWeights,
  detectAnomalies,
  extractFeatures,
  groupAnomalies,
  scoreSituation,
  updateWeights,
} from '@ftth-copilot/analytics';

// Series numéricas del detector (por ejemplo RX power).
const anomalies = detectAnomalies(rxPowerSeries, { pointsPerDay: 24 });
const groups = groupAnomalies(anomalies); // un grupo por incidente contiguo

// `situation` es un SituationGroup del correlador de topología.
const features = extractFeatures(situation);
const score = scoreSituation(features, defaultWeights());
// score.confidence ∈ (0, 1); score.severity: 'critical' | 'major' | 'minor' | 'info'

// Aprendizaje con el resultado etiquetado por el operador.
const nextWeights = updateWeights(defaultWeights(), features, true);

// Uptime de una ventana; `t` va en epoch ms.
const uptime = computeUptime(statusSamples, { from: startMs, to: endMs });
```

## Tests

```bash
pnpm --filter @ftth-copilot/analytics test          # vitest run
pnpm --filter @ftth-copilot/analytics test:coverage # con cobertura
pnpm --filter @ftth-copilot/analytics typecheck     # tsc --noEmit
pnpm --filter @ftth-copilot/analytics lint          # eslint .
```

Los tests viven en `tests/`, un archivo por módulo: `anomaly.test.ts`,
`collect.test.ts`, `correlation-score.test.ts`, `scenario.test.ts`,
`scheduler-helpers.test.ts` y `sla.test.ts`. `retention.ts` no tiene archivo
propio: se cubre dentro de `ingest.test.ts` (mockea `@ftth-copilot/db`, así que
no hace falta una base real).

## Fuente de verdad

Todo lo que afirma este README sale de `src/` y sus tests. Si un módulo cambia
de nombre, de firma o de semántica, actualizá la tabla de arriba en el mismo
cambio.
