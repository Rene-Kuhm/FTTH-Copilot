# Property-Based Testing en los paquetes núcleo

Las pruebas basadas en propiedades (*property-based testing*, con `fast-check` + Vitest) complementan los tests por ejemplos verificando leyes matemáticas, contratos Zod, determinismo y aislamiento multi-tenant sobre cientos de entradas sintéticas generadas y reducidas (*shrinking*) automáticamente.

En FTTH-Copilot este enfoque aporta cuatro garantías concretas:

- **Estabilidad numérica y pureza en detección (`@ftth-copilot/detection`):** comprueba invariancia ante permutaciones, no mutación de arreglos, respeto del `now` inyectado y límites numéricos reales en los cálculos estadísticos y detectores puros.
- **Integridad de contratos canónicos (`@ftth-copilot/shared`):** verifica idempotencia y round-trip de los esquemas Zod, rechazo de claves desconocidas en esquemas `.strict()`, tope de bytes UTF-8 y preservación estricta de `tenantId`.
- **Consistencia de correlación y calidad (`@ftth-copilot/evidence`):** valida claves de identidad compuestas, idempotencia de deduplicación, orden determinista, detección de reinicios de contador y no contaminación entre tenants.
- **Detección de regresiones y fugas cross-tenant (`@ftth-copilot/alerts`):** fija reglas de correlación, severidad, ventanas temporales, agrupación de métricas y expone explícitamente los defectos de aislamiento por `tenantId` conocidos.

> [!NOTE]
> Todas las suites usan **únicamente fixtures sintéticos**: identificadores de tenant inventados (`tenant-a`, `tenant-b`, `tenant-*`) e identificadores de dispositivo sintéticos (`onu-prop-*`, `olt-prop-*`, `ONU-1`). No hay datos reales, credenciales ni IPs productivas.

---

## Cómo correr la suite

### Suite completa del monorepo

```bash
pnpm test:property
```

Ejecuta `turbo run test:property` sobre los cuatro paquetes con suite de propiedades (`@ftth-copilot/detection`, `@ftth-copilot/shared`, `@ftth-copilot/evidence` y `@ftth-copilot/alerts`).

### Ejecución focalizada por paquete

```bash
pnpm --filter @ftth-copilot/detection test:property
pnpm --filter @ftth-copilot/shared test:property
pnpm --filter @ftth-copilot/evidence test:property
pnpm --filter @ftth-copilot/alerts test:property
```

---

## Semilla fija, cantidad de corridas y reproducción de fallos

- **Semilla fija por defecto:** `20260923` en los cuatro paquetes.
- **Cantidad de corridas acotada:** `200` iteraciones por propiedad (`RUNS = 200`), con cotas menores en chequeos específicos (`150` en `packages/shared/tests/property/investigation.property.test.ts`, `50` en el chequeo de borde de `D7` y saturación de `E-7`, y `20` en los rechazos de `tenantId` vacío de `E-8` y `E-11`).

### Cómo reproducir un fallo específico

Cuando `fast-check` encuentra un contraejemplo, imprime en el error la semilla y el `path` del caso reducido (por ejemplo `{ seed: 20260923, path: "42:1:0" }`).

1. **Con la semilla por defecto (`20260923`):** volvé a correr el comando focalizado del paquete afectado; al ser determinista, reproduce exactamente el mismo contraejemplo.
2. **Con otra semilla en `@ftth-copilot/detection`:** los archivos de `detection` leen `process.env.PBT_SEED ?? 20260923`, por lo que podés probar otra semilla sin editar archivos:
   ```bash
   PBT_SEED=123456 pnpm --filter @ftth-copilot/detection test:property
   ```
3. **Con otra semilla o `path` puntual en cualquier paquete:** cambiá temporalmente `const SEED = 20260923` o pasá `{ seed: <semilla>, path: "<path>", endOnFailure: true }` en el `fc.assert(...)` del test correspondiente para ir directo al caso mínimo y revertí ese cambio antes de commitear.

---

## Defectos cross-tenant conocidos en `@ftth-copilot/alerts`

La suite de `@ftth-copilot/alerts` incluye **dos pins de fallo esperado (`it.fails`)** para dos defectos cross-tenant **conocidos** en el código actual:

- **`A-1` — [`packages/alerts/src/correlate.ts:27`](../packages/alerts/src/correlate.ts#L27):** `correlateAlerts` agrupa únicamente por `${alert.deviceKind}:${alert.deviceId}` sin incluir `tenantId` y copia `tenantId`/`connectionId` de `group[0]`.
- **`A-5` — [`packages/alerts/src/dedup.ts:74`](../packages/alerts/src/dedup.ts#L74):** `reconcile` busca alertas previas usando `findingKey` sin `tenantId` y propaga el registro previo sin verificar ni sobreescribir `meta.tenantId`.

La suite queda en verde hoy precisamente porque ambos casos están marcados con `it.fails(...)`. Cuando se corrijan esos defectos en `correlate.ts` y `dedup.ts`, **esos dos `it.fails` fallarán en Vitest** (porque las propiedades pasarán a cumplirse) y deberán convertirse en aserciones `it(...)` normales.

---

## Inventario de invariantes declarados

### `@ftth-copilot/detection`

| ID | Ley verificada | Archivo |
|---|---|---|
| `D1 (median & mad)` | `median` y `mad` son invariantes ante permutaciones de multiconjuntos de números finitos | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D1 (mean)` | `mean` es invariante ante permutaciones en enteros de suma segura y dentro de tolerancia de redondeo IEEE-754 en flotantes acotados | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D2` | `median`, `mean` y `mad` nunca mutan el arreglo de entrada | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D3` | `median` de una lista finita no vacía acotada cae dentro de `[min, max]` | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D4` | `mad` de una lista finita no vacía es `>= 0` y vale `0` para valores iguales dentro de `[-MAX_VALUE / 2, MAX_VALUE / 2]` | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D4 (límite numérico conocido)` | `median` y `mad` desbordan a `Infinity` en listas constantes pares por encima de `MAX_VALUE / 2` | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D5` | `fitTrend` devuelve `null` para menos de dos muestras o para muestras sin dispersión temporal | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D6` | `fitTrend` recupera la pendiente de una serie lineal perfecta dentro de `1e-6` y reporta `r2 === 1` para pendientes no nulas | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `P1` | `predictThresholdCrossing` respeta `minSamples`, restricciones direccionales y ETA positivo acotado dentro del horizonte | [`packages/detection/tests/property/stats-and-trend.property.test.ts`](../packages/detection/tests/property/stats-and-trend.property.test.ts) |
| `D7` | Todo detector devuelve `null` o un `Finding` válido y nunca lanza excepciones ante arreglos arbitrarios, vacíos o de un elemento | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D8` | Todo detector es determinista cuando se inyecta `now` y no muta los arreglos de entrada | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D9` | Todo detector que produce un hallazgo estampa `detectedAt` a partir del `now` inyectado | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D10 (baseline anomaly)` | `detectBaselineAnomaly` devuelve `null` para menos de `minSamples` y para historiales planos (`MAD === 0`) | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D10 (traffic anomaly)` | `detectTrafficAnomaly` devuelve `null` en o por debajo del umbral y reporta `critical` solo en o por encima de `2x` el umbral | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D10 (LOS events)` | `detectLosEvents` sigue la escala de severidad según `criticalDelta`, `warningDelta` y regla de pico reciente | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D10 (optical degradation)` | `detectOpticalDegradation` prioriza banda de `bias` (`warning`) sobre techo de temperatura (`critical`) y devuelve `null` si está sano | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D10 (FEC degradation)` | `detectFecDegradation` prioriza delta no corregible (`critical`) sobre delta corregible (`warning`) | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D10 (flapping & reboot storm)` | `detectFlapping` y `detectRebootStorm` disparan si y solo si las transiciones o reinicios en ventana alcanzan el umbral | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |
| `D10 (signal & temperature drift)` | `detectSignalDrift` y `detectTemperatureDrift` devuelven `null` en tendencias opuestas o ya cruzadas y predicen dentro del horizonte | [`packages/detection/tests/property/detectors.property.test.ts`](../packages/detection/tests/property/detectors.property.test.ts) |

### `@ftth-copilot/shared`

| ID | Ley verificada | Archivo |
|---|---|---|
| `S-1` | `schema.parse(input)` hace round-trip en esquemas `.strict()`, en forma canónica para los 4 esquemas no estrictos y en `verdictCodesSchema` | [`packages/shared/tests/property/contracts.property.test.ts`](../packages/shared/tests/property/contracts.property.test.ts) |
| `S-2` | `schema.parse(schema.parse(input))` es idempotente incluso cuando esquemas no estrictos descartan claves desconocidas | [`packages/shared/tests/property/contracts.property.test.ts`](../packages/shared/tests/property/contracts.property.test.ts) |
| `S-3` | `tenantId` se preserva sin cambios ni valores por defecto y un `tenantId` vacío es rechazado | [`packages/shared/tests/property/contracts.property.test.ts`](../packages/shared/tests/property/contracts.property.test.ts) |
| `S-4` | Todos los esquemas `.strict()` rechazan cualquier clave desconocida adicional de primer nivel | [`packages/shared/tests/property/contracts.property.test.ts`](../packages/shared/tests/property/contracts.property.test.ts) |
| `S-5` | `topologyEdgeSchema` acepta `null`, omitido o `validTo > validFrom`, y rechaza `validTo <= validFrom` | [`packages/shared/tests/property/contracts.property.test.ts`](../packages/shared/tests/property/contracts.property.test.ts) |
| `S-9` | Los esquemas enum aceptan exactamente sus miembros declarados y rechazan cualquier cadena fuera del conjunto | [`packages/shared/tests/property/contracts.property.test.ts`](../packages/shared/tests/property/contracts.property.test.ts) |
| `S-6` | `investigationResultSchema` impone topes de colección (`evidenceRefs <= 64`, `hypotheses <= 8`, `forRefIds`/`againstRefIds <= 64`, `contradictions <= 16`, `missing <= 16`, `suggestedChecks <= 8`) y `0 < windowDays <= 30` | [`packages/shared/tests/property/investigation.property.test.ts`](../packages/shared/tests/property/investigation.property.test.ts) |
| `S-7` | `investigationFreeTextSchema` impone el límite de `4096` bytes UTF-8 incluso cuando el conteo de caracteres UTF-16 es `<= 4096` | [`packages/shared/tests/property/investigation.property.test.ts`](../packages/shared/tests/property/investigation.property.test.ts) |
| `S-8` | `investigationResultSchema` rechaza `windowEnd < windowStart` y `cutoffAt > producedAt`, aceptando igualdad en el borde | [`packages/shared/tests/property/investigation.property.test.ts`](../packages/shared/tests/property/investigation.property.test.ts) |
| IDs opacos de investigación | `investigationRunIdSchema`, `investigationVersionIdSchema` e `investigationFeedbackIdSchema` aceptan `[A-Za-z0-9_-]{1,64}` sin cambios y rechazan barras, espacios y `> 64` caracteres | [`packages/shared/tests/property/investigation.property.test.ts`](../packages/shared/tests/property/investigation.property.test.ts) |

### `@ftth-copilot/evidence`

| ID | Ley verificada | Archivo |
|---|---|---|
| `E-1` | `composeGroupIdentityKey` y `composeEdgeIdentityKey` incrustan `tenantId` y separan tenants distintos para la misma entidad | [`packages/evidence/tests/property/identity-and-reconciliation.property.test.ts`](../packages/evidence/tests/property/identity-and-reconciliation.property.test.ts) |
| `E-2` | `dedupGroups` preserva todos los grupos, mantiene la primera ocurrencia como canónica, apunta duplicados vía `duplicateOf` y registra `mergedGroupIds` | [`packages/evidence/tests/property/identity-and-reconciliation.property.test.ts`](../packages/evidence/tests/property/identity-and-reconciliation.property.test.ts) |
| `E-3` | `dedupGroups` no muta la entrada y es idempotente ante invocaciones repetidas y re-proyección de los grupos emitidos | [`packages/evidence/tests/property/identity-and-reconciliation.property.test.ts`](../packages/evidence/tests/property/identity-and-reconciliation.property.test.ts) |
| `E-4` | `reconcileGroups` nunca asocia un incidente de un tenant con un grupo de otro tenant | [`packages/evidence/tests/property/identity-and-reconciliation.property.test.ts`](../packages/evidence/tests/property/identity-and-reconciliation.property.test.ts) |
| `E-5` | `correlateByTopologyAndTime` aísla el tenant objetivo, referencia solo eventos de ese tenant y valida contra `topologyCorrelationGroupSchema` | [`packages/evidence/tests/property/topology-correlation.property.test.ts`](../packages/evidence/tests/property/topology-correlation.property.test.ts) |
| `E-6` | `correlateByTopologyAndTime` es independiente del orden bajo permutaciones arbitrarias de los eventos de entrada | [`packages/evidence/tests/property/topology-correlation.property.test.ts`](../packages/evidence/tests/property/topology-correlation.property.test.ts) |
| `E-7` | `collectInvestigationEvidence` aísla el tenant objetivo, devuelve IDs únicos válidos según esquema, ordena determinísticamente y acota a `MAX_INVESTIGATION_EVIDENCE_REFS` | [`packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts`](../packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts) |
| `E-8` | `collectInvestigationEvidence` rechaza `tenantId` en blanco, ventanas invertidas y ventanas que superan `MAX_INVESTIGATION_WINDOW_DAYS` | [`packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts`](../packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts) |
| `E-9` | `assessFreshness` es determinista para `nowMs` fijo y devuelve `error`/`future-sample` si alguna muestra supera la tolerancia de 60 s hacia el futuro | [`packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts`](../packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts) |
| `E-10` | `detectCounterReset` devuelve `null` para series no decrecientes y el índice exacto del primer decremento en caso contrario | [`packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts`](../packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts) |
| `E-11` | `retrieveRelevantIncidents` aísla por `tenantId`, respeta `limit`, ordena por relevancia descendente y rechaza `tenantId` vacío | [`packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts`](../packages/evidence/tests/property/evidence-collection-and-quality.property.test.ts) |

### `@ftth-copilot/alerts`

| ID | Ley verificada | Archivo |
|---|---|---|
| `A-1` *(pin `it.fails`)* | `correlateAlerts` nunca mezcla alertas de distintos tenants en un mismo incidente (defecto conocido en `packages/alerts/src/correlate.ts:27`) | [`packages/alerts/tests/property/correlate.property.test.ts`](../packages/alerts/tests/property/correlate.property.test.ts) |
| `A-2` | `correlateAlerts` exige `minKinds` tipos de hallazgo distintos no resueltos en un dispositivo y en caso contrario no emite incidente | [`packages/alerts/tests/property/correlate.property.test.ts`](../packages/alerts/tests/property/correlate.property.test.ts) |
| `A-3` | La severidad del incidente equivale a la severidad máxima entre sus alertas no resueltas | [`packages/alerts/tests/property/correlate.property.test.ts`](../packages/alerts/tests/property/correlate.property.test.ts) |
| `A-4` | `firstSeenAt` y `lastSeenAt` del incidente equivalen al mínimo `firstSeenAt` y al máximo `lastSeenAt` de sus alertas no resueltas | [`packages/alerts/tests/property/correlate.property.test.ts`](../packages/alerts/tests/property/correlate.property.test.ts) |
| `A-5` *(pin `it.fails`)* | `reconcile` nunca emite un registro cuyo `tenantId` difiera de `meta.tenantId` (defecto conocido en `packages/alerts/src/dedup.ts:74`) | [`packages/alerts/tests/property/dedup.property.test.ts`](../packages/alerts/tests/property/dedup.property.test.ts) |
| `A-7` | `findingKey` es estable e inyectiva sobre ternas distintas `(kind, deviceKind, deviceId)` | [`packages/alerts/tests/property/dedup.property.test.ts`](../packages/alerts/tests/property/dedup.property.test.ts) |
| `A-6` | `groupRows` es independiente del orden de filas (módulo ordenación canónica), descarta `null` y `STATUS` desconocidos, y aísla por clave de dispositivo | [`packages/alerts/tests/property/group.property.test.ts`](../packages/alerts/tests/property/group.property.test.ts) |
