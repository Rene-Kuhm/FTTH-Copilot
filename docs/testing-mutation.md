# Mutation testing con StrykerJS

> **Principio:** la cobertura de líneas (`vitest --coverage`) mide qué código se ejecutó, no si los tests realmente detectarían un defecto. StrykerJS introduce mutaciones pequeñas en el código fuente (`>=` → `>`, `+` → `-`, condiciones invertidas) y verifica que la suite falle.

## 1. Alcance actual

El harness está configurado sobre tres paquetes núcleo (runner `vitest`, `@stryker-mutator/core` y `@stryker-mutator/vitest-runner` `^10.1.1` declarados únicamente como `devDependencies` de cada workspace):

| Paquete | Config | Mutación (`mutate`) | Estado línea base |
|---|---|---|---|
| `@ftth-copilot/detection` | [`packages/detection/stryker.config.mjs`](../packages/detection/stryker.config.mjs) | `src/**/*.ts` (sin `index.ts`, `types.ts`) | Medida (`72.43%`, `low: 72`) |
| `@ftth-copilot/evidence` | [`packages/evidence/stryker.config.mjs`](../packages/evidence/stryker.config.mjs) | `src/**/*.ts` (sin `index.ts`, `types.ts`) | Medida (`76.14%`, `low: 76`) |
| `@ftth-copilot/shared` | [`packages/shared/stryker.config.mjs`](../packages/shared/stryker.config.mjs) | `src/**/*.ts` (sin `index.ts`, `types.ts`, `contracts.ts`, `design-system/**`) | Medida (`59.28%`, `low: 59`) |

Los paquetes usan `disableTypeChecks: true` (la mutación valida comportamiento, los tipos se verifican con `pnpm typecheck`) y apuntan al `vitest.config.ts` existente de cada paquete.

Los reportes HTML y JSON se escriben en `reports/mutation/` dentro de cada paquete y los directorios temporales de Stryker en `.stryker-tmp/` (ambos excluidos en `.gitignore` y en `eslint.config.shared.mjs`).

## 2. Cómo correrlo

```bash
# Un paquete específico
pnpm --filter @ftth-copilot/detection test:mutation
pnpm --filter @ftth-copilot/evidence test:mutation
pnpm --filter @ftth-copilot/shared test:mutation

# Todos los paquetes configurados (vía Turborepo, sin caché)
pnpm test:mutation

# Cross-check sin análisis de cobertura por test
pnpm --filter @ftth-copilot/detection exec stryker run --coverageAnalysis off
pnpm --filter @ftth-copilot/evidence exec stryker run --coverageAnalysis off
pnpm --filter @ftth-copilot/shared exec stryker run --coverageAnalysis off
```

## 3. Caveat de cobertura con Vitest 4.1 (`stryker-js#5928`)

StrykerJS registró un bug de emparejamiento de cobertura por test con Vitest 4.1.x ([stryker-mutator/stryker-js#5928](https://github.com/stryker-mutator/stryker-js/issues/5928)) que puede producir falsos sobrevivientes o falsos `No coverage` bajo `coverageAnalysis: 'perTest'`.

Para validar las líneas base, los tres paquetes se ejecutaron en ambos modos (`perTest` y `off`):

| Paquete | Modo | Mutantes | Killed | Survived | Timeout | No cov | Errors | Score | Tiempo |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `@ftth-copilot/detection` | `perTest` | 555 | 402 | 153 | 0 | 0 | 0 | **72.43%** | 10 s |
| `@ftth-copilot/detection` | `off` | 555 | 402 | 153 | 0 | 0 | 0 | **72.43%** | 14 s |
| `@ftth-copilot/evidence` | `perTest` | 1463 | 1106 | 303 | 8 | 46 | 0 | **76.14%** | 47 s |
| `@ftth-copilot/evidence` | `off` | 1463 | 1106 | 303 | 8 | 46 | 0 | **76.14%** | 34 s |
| `@ftth-copilot/shared` | `perTest` | 1325 | 777 | 427 | 2 | 108 | 11 | **59.28%** | 42 s |
| `@ftth-copilot/shared` | `off` | 1325 | 777 | 427 | 2 | 108 | 11 | **59.28%** | 35 s |

En los tres paquetes (`detection`, `evidence` y `shared`) ambos modos coincidieron exactamente en el total, en todos los contadores y en cada archivo individual (0 discrepancias entre `perTest` y `off`). Aun así, ante cualquier `No coverage` inesperado o sobreviviente dudoso al agregar tests o paquetes nuevos, contrastar siempre con `--coverageAnalysis off`.

> En `@ftth-copilot/shared`, los `11` `RuntimeError` corresponden a mutaciones sobre constantes inicializadas al importar el módulo (`redaction.ts` y `laya-expert-system.ts`) que rompen la carga del archivo antes de correr los tests; Stryker los excluye del denominador del score.

## 4. Línea base medida — `@ftth-copilot/detection`

Medición ejecutada sobre 11 archivos fuente (`71` tests en `11` archivos de test):

| Archivo | Score | Total | Killed | Survived | Timeout | No cov | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| `src/anomaly.ts` | 64.10% | 39 | 25 | 14 | 0 | 0 | 0 |
| `src/fec.ts` | 66.67% | 60 | 40 | 20 | 0 | 0 | 0 |
| `src/flapping.ts` | 72.73% | 44 | 32 | 12 | 0 | 0 | 0 |
| `src/los.ts` | 73.26% | 86 | 63 | 23 | 0 | 0 | 0 |
| `src/optical.ts` | 70.59% | 68 | 48 | 20 | 0 | 0 | 0 |
| `src/reboots.ts` | 70.45% | 44 | 31 | 13 | 0 | 0 | 0 |
| `src/signal-drift.ts` | 69.57% | 23 | 16 | 7 | 0 | 0 | 0 |
| `src/stats.ts` | 78.95% | 76 | 60 | 16 | 0 | 0 | 0 |
| `src/temperature-drift.ts` | 54.55% | 22 | 12 | 10 | 0 | 0 | 0 |
| `src/traffic.ts` | 81.40% | 43 | 35 | 8 | 0 | 0 | 0 |
| `src/trend.ts` | 80.00% | 50 | 40 | 10 | 0 | 0 | 0 |
| **Total** | **72.43%** | **555** | **402** | **153** | **0** | **0** | **0** |

## 5. Mutantes sobrevivientes relevantes en `@ftth-copilot/detection`

Se listan los sobrevivientes que ocultan comportamiento real de negocio (umbrales, bordes de ventana, ordenamiento, cálculo estadístico, dirección o severidad); se omiten mutaciones puramente textuales de títulos/descripciones cuando no afectan la lógica de disparo.

### `src/anomaly.ts`
- `src/anomaly.ts:24`, `src/anomaly.ts:26` (`LogicalOperator`, `opts.minSamples ?? 10` → `&&`, `opts.now ?? Date.now()` → `&&`): los defaults cuando no se pasan opciones quedan sin cubrir.
- `src/anomaly.ts:28` (`ConditionalExpression` / `EqualityOperator`, `samples.length < minSamples`): no hay caso en el límite exacto `samples.length === minSamples`.
- `src/anomaly.ts:30` (`MethodExpression` / `ArrowFunction` / `ArithmeticOperator`, `.sort((a, b) => a.t - b.t)`): todos los fixtures entran ya ordenados; si llegan desordenados se evalúa una muestra incorrecta.
- `src/anomaly.ts:38` (`EqualityOperator`, `Math.abs(z) < thresholdZ` → `<=`): falta caso en la frontera exacta `|z| === thresholdZ`.
- `src/anomaly.ts:44` (`EqualityOperator`, `absZ > 5` → `>=`): frontera entre severidad `warning` y `critical`.
- `src/anomaly.ts:51` (`ArithmeticOperator`, `absZ / (2 * thresholdZ)`): `confidence` no se valida numéricamente.

### `src/fec.ts`
- `src/fec.ts:18-20` (`MethodExpression` / `ConditionalExpression` / `LogicalOperator` / `EqualityOperator` / `ArrowFunction` / `ArithmeticOperator`): el filtrado por ventana `[now - windowMs, now]` y ordenamiento por `t` en `selectWindow` no tiene tests con muestras fuera de ventana, futuras (`> now`), en el borde exacto o desordenadas.
- `src/fec.ts:25` (`ConditionalExpression` / `EqualityOperator`, `series.length < 2` → `false` / `<= 2`): falta borde con exactamente 2 muestras en `computeWindowDelta`.
- `src/fec.ts:49` (`LogicalOperator`, `opts.correctedDeltaThreshold ?? 100` → `&&`): no se verifica el umbral por defecto.
- `src/fec.ts:71` (`EqualityOperator`, `correctedWindow.length >= minSamples && correctedDelta > correctedDeltaThreshold`): bordes exactos de `minSamples` y `correctedDeltaThreshold`.

### `src/flapping.ts`
- `src/flapping.ts:28-30` (`MethodExpression` / `ArrowFunction` / `ArithmeticOperator` / `ConditionalExpression` / `EqualityOperator`): faltan tests con muestras desordenadas y en/fuera del límite `now - s.t <= windowMs`.
- `src/flapping.ts:31` (`ConditionalExpression` / `EqualityOperator`, `recent.length < 2` → `false` / `<= 2`): falta caso límite con 2 muestras.

### `src/los.ts`
- `src/los.ts:18-20` (`MethodExpression` / `ConditionalExpression` / `LogicalOperator` / `EqualityOperator` / `ArrowFunction` / `ArithmeticOperator`): `selectWindow` sin tests de muestras desordenadas, futuras o fuera de `[now - windowMs, now]`.
- `src/los.ts:58` (`EqualityOperator`, `delta >= criticalDelta` → `>`): frontera exacta `delta === criticalDelta`.
- `src/los.ts:71` (`EqualityOperator`, `window.length >= minSamples` → `>`): frontera de `minSamples` en rama `warning`.
- `src/los.ts:89-90` (`EqualityOperator`, `window.length >= 2` → `> 2` y `delta < warningDelta` → `<=`): fronteras de la detección temprana de incremento de LOS.

### `src/optical.ts`
- `src/optical.ts:23-25` (`MethodExpression` / `ConditionalExpression` / `LogicalOperator` / `EqualityOperator` / `ArrowFunction` / `ArithmeticOperator`): filtro `[now - windowMs, now]` y ordenamiento cronológico sin cobertura para entradas desordenadas o fuera de ventana.
- `src/optical.ts:44` (`LogicalOperator`, `opts.minSamples ?? 3` → `&&`): falta test usando el `minSamples` por defecto.
- `src/optical.ts:52` (`EqualityOperator`, `biasAvg < biasMin` → `<=`, `biasAvg > biasMax` → `>=`): límites exactos de la banda de corriente de bias.
- `src/optical.ts:66` (`ConditionalExpression` / `EqualityOperator`, `tempAvg !== null && tempAvg > tempMax` → `true` / `>=`): si `tempAvg` es `null` o igual a `tempMax` dentro de la banda normal de bias, la condición mutada dispara una falsa alarma de temperatura alta.

### `src/reboots.ts`
- `src/reboots.ts:28-30` (`MethodExpression` / `ArrowFunction` / `ArithmeticOperator` / `ConditionalExpression` / `EqualityOperator`): faltan muestras desordenadas y fuera de ventana.
- `src/reboots.ts:31` (`ConditionalExpression` / `EqualityOperator`, `recent.length < 2` → `false` / `<= 2`): frontera de 2 muestras.
- `src/reboots.ts:35` (`EqualityOperator`, `recent[i]!.uptimeSeconds < recent[i - 1]!.uptimeSeconds` → `<=`): dos muestras consecutivas con igual uptime dispararían un falso reinicio.
- `src/reboots.ts:42` (`StringLiteral`, `severity: 'warning'` → `""`): la severidad devuelta no se aserta en los tests.

### `src/signal-drift.ts`
- `src/signal-drift.ts:4`, `src/signal-drift.ts:36` (`ArithmeticOperator`, `DAY_MS` y `prediction.etaMs / DAY_MS` → `* DAY_MS`): no se aserta el valor calculado en días ni la estimación temporal en la salida.

### `src/stats.ts`
- `src/stats.ts:7`, `src/stats.ts:15` (`ConditionalExpression`, `values.length === 0` → `false`): faltan tests de arreglo vacío para `median` y `mad`.
- `src/stats.ts:39` (`EqualityOperator`, `samples.length < 2` → `<= 2`): `linearTrend` con exactamente 2 muestras.
- `src/stats.ts:40` (`MethodExpression` / `ArrowFunction` / `ArithmeticOperator`): `linearTrend` sin muestras desordenadas por `t`.
- `src/stats.ts:62`, `65`, `68`, `69`, `71` (`ArithmeticOperator` / `BlockStatement` / `AssignmentOperator` / `ConditionalExpression` / `EqualityOperator`): el cómputo de `r2` (`yMean`, bucle `ssTot`/`ssRes` y `ssTot === 0 ? 1 : 1 - ssRes / ssTot`) sobrevive sin daño porque ningún test verifica valores exactos de `r2` en series no lineales ni en series constantes (`ssTot === 0`).

### `src/temperature-drift.ts`
- `src/temperature-drift.ts:29` (`StringLiteral`, `direction: 'above'` → `""`): ningún test aserta el rechazo o aceptación dependiente de dirección sin pasar por la rama implícita.
- `src/temperature-drift.ts:32` (`LogicalOperator`, `opts.minR2 ?? 0.5` → `&&`): falta test con `minR2` por defecto.
- `src/temperature-drift.ts:4`, `36`, `49` (`ArithmeticOperator`, `LogicalOperator`): faltan aserciones sobre `etaDays` y el fallback `opts.now ?? Date.now()`.

### `src/traffic.ts`
- `src/traffic.ts:31` (`EqualityOperator` / `ConditionalExpression`, `s.t >= now - windowMs && s.t <= now`): faltan muestras en el borde de la ventana y futuras (`> now`).
- `src/traffic.ts:35` (`EqualityOperator`, `avg <= threshold` → `<`): frontera exacta `avg === threshold`.
- `src/traffic.ts:40` (`EqualityOperator`, `avg >= threshold * 2` → `>`): frontera exacta entre `warning` y `critical`.

### `src/trend.ts`
- `src/trend.ts:32` (`ConditionalExpression`, `if (!fit) return null` → `false`): falta caso donde `linearTrend` devuelve `null`.
- `src/trend.ts:33` (`EqualityOperator`, `fit.r2 < opts.minR2` → `<=`): frontera exacta `r2 === minR2`.
- `src/trend.ts:35` (`MethodExpression` / `ArrowFunction` / `ArithmeticOperator`): `lastValue` depende de muestras ya ordenadas.
- `src/trend.ts:38`, `40` (`EqualityOperator`): fronteras de pendiente nula (`slopePerDay === 0`) y `lastValue === threshold` en ambas direcciones (`below` y `above`).
- `src/trend.ts:45` (`EqualityOperator`, `etaMs > opts.horizonDays * DAY_MS` → `>=`): frontera exacta `etaMs === horizonDays * DAY_MS`.

## 6. Línea base medida — `@ftth-copilot/evidence`

Medición ejecutada sobre 12 archivos fuente (`288` tests en `16` archivos de test; `282` ejecutados en el dry-run de Stryker):

| Archivo | Score | Total | Killed | Survived | Timeout | No cov | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| `src/abstention-policy.ts` | 93.68% | 95 | 89 | 6 | 0 | 0 | 0 |
| `src/bm25-lite.ts` | 57.35% | 136 | 78 | 58 | 0 | 0 | 0 |
| `src/edge-identity.ts` | 77.92% | 154 | 120 | 24 | 0 | 10 | 0 |
| `src/evidence-collector.ts` | 64.47% | 228 | 147 | 71 | 0 | 10 | 0 |
| `src/evidence-quality.ts` | 80.47% | 169 | 136 | 29 | 0 | 4 | 0 |
| `src/groups-reconciler.ts` | 80.70% | 57 | 46 | 11 | 0 | 0 | 0 |
| `src/investigation-enrichment.ts` | 69.39% | 49 | 34 | 15 | 0 | 0 | 0 |
| `src/pending-incident.ts` | 100.00% | 37 | 37 | 0 | 0 | 0 | 0 |
| `src/relevant-incidents.ts` | 88.72% | 133 | 118 | 15 | 0 | 0 | 0 |
| `src/topology-correlation.ts` | 61.50% | 187 | 115 | 59 | 0 | 13 | 0 |
| `src/topology.ts` | 84.50% | 129 | 101 | 12 | 8 | 8 | 0 |
| `src/truth-gate.ts` | 95.51% | 89 | 85 | 3 | 0 | 1 | 0 |
| **Total** | **76.14%** | **1463** | **1106** | **303** | **8** | **46** | **0** |

## 7. Mutantes sobrevivientes relevantes en `@ftth-copilot/evidence`

Se excluyen mutaciones puramente cosméticas sobre textos de mensajes o entradas individuales de la lista de stopwords cuando no alteran la lógica de negocio ni de ranking.

### `src/abstention-policy.ts`
- `src/abstention-policy.ts:195` (`ConditionalExpression` / `BlockStatement`, `if (reason !== 'incomplete')` → `false` / `{}`): falta verificar qué ocurre cuando `reason === 'incomplete'` y la rama `IDENTIFIER_HINT` no debería correr para otras razones.
- `src/abstention-policy.ts:198` (`MethodExpression`, `toolsAffected.some(...)` → `toolsAffected.every(...)`): ningún test mezcla una herramienta con hint de identificador y otra sin hint en `toolsAffected`.

### `src/bm25-lite.ts`
- `src/bm25-lite.ts:25` (`Regex`, `/[^a-záéíóúñ0-9]+/` → `/[^a-záéíóúñ0-9]/`): sin secuencias consecutivas de separadores, dividir por un solo carácter equivale al cuantificador `+`.
- `src/bm25-lite.ts:83` (`ConditionalExpression` / `LogicalOperator`, `queryTokens.length === 0 || docTokens.length === 0` → `false` / `&&`): faltan tests de `bm25Score` con consulta vacía o documento vacío.
- `src/bm25-lite.ts:86` (`ConditionalExpression` / `EqualityOperator`, `avgDocLen > 0 ? avgDocLen : docLen` → `true` / `>= 0`): falta borde `avgDocLen === 0`.
- `src/bm25-lite.ts:97` (`ConditionalExpression`, `if (tf === 0) continue` → `false`): falta verificar que términos ausentes del documento no alteren la suma o el score cuando `tf === 0`.
- `src/bm25-lite.ts:112` (`ConditionalExpression`, `if (docs.length === 0) return []` → `false`): `rankBm25` sin caso explícito para corpus vacío.

### `src/edge-identity.ts`
- `src/edge-identity.ts:166-167`, `319` (`MethodExpression` / `ArrayDeclaration`, `.sort()` sobre `beforeIds`, `afterIds` y `preservedIdentityHashes`): los tests pasan IDs/hashes ya ordenados, ocultando regresiones de determinismo.
- `src/edge-identity.ts:184`, `194`, `203`, `205`, `208`, `211`, `218`, `221` (`LogicalOperator` / `ConditionalExpression` / `MethodExpression`): detección de colisiones y claves con `connectionId === null` vs no nulo, y filtrado por `tuple` sin fixtures que mezclen múltiples tuplas en `args.before`/`args.after`.
- `src/edge-identity.ts:232` (`NoCoverage` / `Survived`, `reports.sort(...)`): ordenamiento determinista de `reports` por `identityHash` sin cobertura ni aserción de orden cuando hay múltiples colisiones.
- `src/edge-identity.ts:293-301`, `312` (`ArrayDeclaration` / `BlockStatement` / `MethodExpression`, `allPresent = bucket.ids.every((id) => afterIds.has(id))` → `.some(...)`): falta caso donde solo una parte de los IDs duplicados permanece en `after` (`preserved` vs `split`).

### `src/evidence-collector.ts`
- `src/evidence-collector.ts:111`, `119-128` (`NoCoverage` / `Survived`, validación de `tenantId`, timestamps `NaN`, `endMs < startMs`, `windowDays > MAX_INVESTIGATION_WINDOW_DAYS`): faltan tests de timestamps inválidos (`NaN`) y de fronteras exactas `endMs === startMs` y `windowDays === MAX_INVESTIGATION_WINDOW_DAYS`.
- `src/evidence-collector.ts:138`, `181`, `206`, `229`, `252` (`ConditionalExpression` / `LogicalOperator` / `EqualityOperator`): guardas de arreglos vacíos/ausentes (`metrics`, `events`, `topologyHops`, `confirmedIncidents`, `feedbacks`).
- `src/evidence-collector.ts:149`, `155`, `158`, `171`, `196` (`EqualityOperator` / `LogicalOperator` / `NoCoverage`): búsqueda de política por fuente, fallback de `source` por defecto (`'smartolt.poll'`, `'syslog'`), muestra futura (`t > cutoffMs + 60_000`) y frontera exacta `ageMs === policy.ttlMs`.
- `src/evidence-collector.ts:164`, `190`, `211`, `234`, `257` (`MethodExpression`, `.slice(0, 64)` en `refId`): ningún test supera los 64 caracteres en los sufijos de ID.
- `src/evidence-collector.ts:187`, `209`, `232`, `255` (`EqualityOperator` / `ConditionalExpression`, `t < startMs || t > endMs`, `tenantId !== tenantId`): fronteras exactas `t === startMs` / `t === endMs` y filtrado estricto por `tenantId` en `topologyHops`, `confirmedIncidents` y `feedbacks`.
- `src/evidence-collector.ts:280`, `282` (`ConditionalExpression` / `EqualityOperator`): desempate por `kindDiff` cuando dos evidencias comparten marca temporal.

### `src/evidence-quality.ts`
- `src/evidence-quality.ts:128-132` (`NoCoverage` / `Survived`): parsing de `Date`, `number` e invalid string (`NaN`) en `toMs`.
- `src/evidence-quality.ts:170`, `214` (`EqualityOperator`, `t > nowMs + 60_000` → `>=`, `gap > policy.maxGapMs` → `>=`): fronteras exactas de muestra futura y de hueco máximo (`maxGapMs`).
- `src/evidence-quality.ts:176`, `187`, `204`, `220`, `233`, `257`, `267` (`BooleanLiteral`, `policyApplied: true` → `false`): el flag `policyApplied` no se aserta en varios veredictos.
- `src/evidence-quality.ts:226` (`MethodExpression` / `LogicalOperator` / `EqualityOperator`, `x.t >= window.startMs && x.t <= window.endMs`): faltan muestras fuera o en el borde exacto de `window`.
- `src/evidence-quality.ts:243`, `246`, `282-283` (`EqualityOperator` / `ConditionalExpression`): borde de `samples.length === 2`, desorden con timestamps iguales (`<` vs `<=`), y monotonicidad de contadores cuando hay valores `null` o iguales consecutivos (`v < prev` vs `<=`).
- `src/evidence-quality.ts:316-326` (`StringLiteral`): mapeos `insufficient`/`error` hacia `incomplete` y `warning`/`critical` sin aserción directa.

### `src/groups-reconciler.ts`
- `src/groups-reconciler.ts:81` (`StringLiteral`, `.join('|')` → `""`): clave de deduplicación sin test donde concatene valores ambiguos sin separador.
- `src/groups-reconciler.ts:175-180` (`BlockStatement` / `MethodExpression` / `ArithmeticOperator`, `bucket.sort(...)` por `createdAt`): incidentes entregados ya ordenados cronológicamente.
- `src/groups-reconciler.ts:187` (`EqualityOperator`, `gap <= windowMs && gap < bestGap` → `< windowMs` / `<= bestGap`): frontera exacta `gap === windowMs` y empate `gap === bestGap` entre dos incidentes candidatos.

### `src/investigation-enrichment.ts`
- `src/investigation-enrichment.ts:110` (`ConditionalExpression` / `EqualityOperator`, `inc.deviceKind !== 'OLT' && inc.deviceKind !== 'ONU'`): faltan incidentes de tipos distintos a `'OLT'`/`'ONU'` o exactamente `'OLT'` para probar el filtro.
- `src/investigation-enrichment.ts:114`, `126` (`LogicalOperator` / `ConditionalExpression`, `hop.kind === args.ancestorKind && hop.id === args.ancestorId`): no hay casos donde coincida `kind` pero no `id` (o viceversa) en el camino de ancestros.
- `src/investigation-enrichment.ts:138-139` (`MethodExpression`, `.sort()` en `affectedObserved` y `knownHealthy`): los IDs en los fixtures ya llegan ordenados.

### `src/pending-incident.ts`
- `0` sobrevivientes y `0` sin cobertura (`100.00%`, `37/37` mutantes muertos).

### `src/relevant-incidents.ts`
- `src/relevant-incidents.ts:60`, `117`, `119` (`ConditionalExpression` / `BooleanLiteral`): peso cuando `confirmedBy` no es string y fallback cuando `hint` es `undefined` o coincide parcialmente solo en `deviceId` o `deviceKind`.
- `src/relevant-incidents.ts:164` (`EqualityOperator` / `ConditionalExpression`, `args.retractedIncidentIds && args.retractedIncidentIds.length > 0`): lista vacía de incidentes retractados.
- `src/relevant-incidents.ts:171` (`EqualityOperator`, `Date.parse(row.resolvedAt) >= cutoff` → `>`): frontera exacta `resolvedAt === cutoff`.
- `src/relevant-incidents.ts:196`, `199`, `204` (`EqualityOperator` / `MethodExpression`, `MIN_SPARSESCORE` y `.slice(0, topK)`): fronteras exactas `=== MIN_SPARSESCORE` y corte de resultados cuando hay más de `topK` candidatos.

### `src/topology-correlation.ts`
- `src/topology-correlation.ts:33-38`, `50`, `59` (`MethodExpression` / `ArithmeticOperator` / `EqualityOperator` / `NoCoverage`): ordenamiento inicial de eventos (incluidos desempates por `deviceId` y `sourceEventId`) y frontera exacta de ventana temporal `evTime - clusterStartTime === timeWindowMs`.
- `src/topology-correlation.ts:75`, `92`, `94`, `108`, `120` (`ConditionalExpression` / `LogicalOperator` / `EqualityOperator`): desempate por `specificityRank` entre ancestros candidatos (`CTO` vs `SPLITTER` vs `PON_PORT` vs `OLT`) y guarda de población `totalPopulation === 0`.
- `src/topology-correlation.ts:124`, `149`, `152-155`, `170-171`, `198-202` (`MethodExpression` / `ArithmeticOperator` / `EqualityOperator`): ordenamiento de `affectedDeviceIds`, `healthyDeviceIds`, `contributingEvents` y `groups`; cálculo de `percentage = Math.round(affectedRatio * 100)` (`*` vs `/`) y casing `candidate.kind.toLowerCase()` en `groupId`.
- `src/topology-correlation.ts:219-242` (`MethodExpression` / `EqualityOperator` / `ConditionalExpression`): aislamiento de aristas y eventos por `tenantId` en `correlateAcrossTenants` y ordenamiento multi-tenant por `tenantId` y ventana.

### `src/topology.ts`
- `src/topology.ts:33-45`, `53` (`NoCoverage` / `Survived`, `isEdgeActiveAt`): comportamiento cuando `asOf` es `Date` vs `string` vs `NaN` y aristas con `validTo === null` vs `undefined`.
- `src/topology.ts:85`, `93`, `96`, `135`, `138` (`ArrayDeclaration` / `ConditionalExpression` / `CallExpression`, `visited.add(...)` en BFS): sin un grafo con diamantes o ciclos que requieran filtrar `visited` o chequear `parentKind`/`childKind`, la eliminación de `visited.add` sobrevive.
- `src/topology.ts:104`, `167` (`MethodExpression`): ordenamiento de `onuIds` y orden `.reverse()` en la cadena de ancestros.

### `src/truth-gate.ts`
- `src/truth-gate.ts:18`, `123-124` (`ObjectLiteral` / `ConditionalExpression` / `NoCoverage`): desempate por `SEVERITY_RANK` cuando `codeDelta === 0` entre dos veredictos distintos (las colisiones existentes siempre difieren en código).
- `src/truth-gate.ts:92` (`StringLiteral`, `case 'complete':` → `""`): la rama `'complete'` no altera el resultado por defecto porque coincide con la salida `ok` al caer fuera del `switch`.

## 8. Línea base medida — `@ftth-copilot/shared`

Medición ejecutada sobre 9 archivos fuente (`447` tests en `16` archivos de test; `231` ejecutados en el dry-run de Stryker; se excluyen `index.ts`, `types.ts`, `contracts.ts` y `design-system/**`):

| Archivo | Score | Total | Killed | Survived | Timeout | No cov | Errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| `src/injection.ts` | 46.74% | 92 | 43 | 49 | 0 | 0 | 0 |
| `src/laya-client.ts` | 39.53% | 344 | 136 | 126 | 0 | 82 | 0 |
| `src/laya-expert-system.ts` | 76.06% | 151 | 108 | 34 | 0 | 0 | 9 |
| `src/laya-integration.ts` | 66.43% | 140 | 93 | 41 | 0 | 6 | 0 |
| `src/laya-metrics.ts` | 58.77% | 114 | 67 | 35 | 0 | 12 | 0 |
| `src/laya-shadow.ts` | 71.61% | 155 | 111 | 38 | 0 | 6 | 0 |
| `src/learning.ts` | 86.67% | 15 | 13 | 2 | 0 | 0 | 0 |
| `src/logger.ts` | 81.97% | 183 | 148 | 32 | 2 | 1 | 0 |
| `src/redaction.ts` | 44.96% | 131 | 58 | 70 | 0 | 1 | 2 |
| **Total** | **59.28%** | **1325** | **777** | **427** | **2** | **108** | **11** |

## 9. Mutantes sobrevivientes relevantes en `@ftth-copilot/shared`

Se listan los sobrevivientes que afectan lógica real de seguridad, routing, métricas, circuit breaker o clasificación; se omiten entradas individuales de listas de keywords/claves cuando no representan un comportamiento distinto ni errores de carga a nivel módulo.

### `src/injection.ts`
- `src/injection.ts:39` (`ConditionalExpression`, `typeof value === 'string' && INJECTION_KINDS.includes(value)` → `true`): falta test negativo en el guard `isInjectionKind` con valores no string o inválidos.
- `src/injection.ts:76-81` (`MethodExpression` / `Regex` / `StringLiteral`, normalización de texto): `.trim()`, colapso de espacios `\s+` y reemplazo de puntuación por `' '` vs `''` sin casos con espacios múltiples o signos alrededor del payload.
- `src/injection.ts:100`, `104`, `109`, `123`, `127` (`Regex` / `StringLiteral`, patrones de `direct-override`, `role-reassignment` y `system-injection`): cuantificadores `\s*` / `{0,60}` / `s?` y variantes (`<system>`, `[INST]`, `### system`, `system:`) no probados en sus límites ni validando `kind`.
- `src/injection.ts:143-152` (`LogicalOperator` / `ConditionalExpression` / `ArithmeticOperator` / `MethodExpression`): validación de entrada no string / vacía y cálculo de ventana de evidencia (`start`/`end` con `EVIDENCE_RADIUS` y `.slice(start, end).trim()`).

### `src/laya-client.ts`
- `src/laya-client.ts:62`, `68-69` (`NoCoverage` / `Survived`): fallback de `LAYA_MODEL` y manejo de configuración inválida en `loadLayaConfig`.
- `src/laya-client.ts:184-198` (`NoCoverage` / `Survived`, `CircuitBreaker`): transiciones `closed`/`open`/`half-open` y frontera exacta `Date.now() - state.lastFailureTime >= config.resetTimeoutMs` (`>=` vs `>`).
- `src/laya-client.ts:262-282` (`NoCoverage` / `Survived`, `recordLayaCallOutcome`): acumuladores `fallbackTotal++`, `confidenceSum +=`, `shadowTotal++`, `timeoutsTotal++` y condición `isShadow && shadowAgreement !== undefined`.
- `src/laya-client.ts:374`, `382-406` (`NoCoverage` / `Survived`, `callLaya`): resolución de URL (`layaConfig.url ?? process.env.LAYA_URL ?? 'http://localhost:8080'`), disparo real de `AbortController` por timeout, manejo de `!response.ok` y detección de `error.name === 'AbortError'`.
- `src/laya-client.ts:447-523` (`NoCoverage` / `Survived`, `normalizeLayaResponse`): ramas del formato plano (`flatEventClass` y demás campos), mapeo de respuesta legacy anidada (sin cobertura) y fallback de campos faltantes.
- `src/laya-client.ts:540-545`, `560-683`, `693-743` (`NoCoverage` / `Survived`): `isOperational()`, `getConfig()`, rama activa (no shadow) de `decide()`, `decideBatch()` (enteramente `NoCoverage` en circuit open, error y fail-open, además de escalado de timeout `timeoutMs * Math.min(events.length, 10)`) y `healthCheck()`.

### `src/laya-expert-system.ts`
- `src/laya-expert-system.ts:130-180` (`ArrayDeclaration` / `StringLiteral` / `BooleanLiteral`): patrones de `NORMAL`/`UNKNOWN`, severidad/scope por defecto de `UNKNOWN` y flags `requiresInvestigation` por clase de evento sin aserciones por cada clase.
- `src/laya-expert-system.ts:221`, `228-229` (`EqualityOperator` / `LogicalOperator` / `ConditionalExpression`): desempate por `classPriority` cuando dos clases empatan en `score` (`score === bestScore && classPriority < bestPriority`).
- `src/laya-expert-system.ts:251` (`MethodExpression` / `ArithmeticOperator`, `Math.min(0.95, 0.5 + (bestScore / maxPossibleMatches) * 0.45)`): fórmula exacta y techo `0.95` de `confidence` no verificados numéricamente.
- `src/laya-expert-system.ts:274-275` (`BlockStatement` / `ConditionalExpression`, `getExpertClassifier()`): singleton sin cobertura de retorno consistente.

### `src/laya-integration.ts`
- `src/laya-integration.ts:61`, `101` (`LogicalOperator` / `ConditionalExpression`): `isEnabled()` con `enabled: true` + `mode: 'disabled'` y rama temprana cuando está deshabilitado.
- `src/laya-integration.ts:131`, `136`, `141` (`EqualityOperator` / `ConditionalExpression`): fronteras exactas `confidence === confidenceThresholdHigh` (`>=` vs `>`) y `confidence === confidenceThresholdLow` (`<` vs `<=`).
- `src/laya-integration.ts:146`, `156-175` (`NoCoverage` / `Survived`, `requiresInvestigationFallback`): umbrales `eventClass < 0.75`, `CRITICAL` con `confidence.severity < 0.9`, y `confidence.eventClass < 0.5 || confidence.severity < 0.5` en fronteras `===` y ramas OR/AND.
- `src/laya-integration.ts:227-249`, `273-283` (`NoCoverage` / `Survived`): validación de evento inválido en `shouldUseLaya`, condición `config.mode === 'disabled'` y fronteras `>= high` / `< low` / `>= low` en el cálculo de ruta.

### `src/laya-metrics.ts`
- `src/laya-metrics.ts:50-52`, `63` (`NoCoverage` / `Survived`, `arr.length > 1000` → `arr.shift()`): nunca se prueba el límite de retención de 1000 muestras en histogramas de latencia o confianza.
- `src/laya-metrics.ts:84-100` (`MethodExpression` / `ArithmeticOperator` / `LogicalOperator`): ordenamiento de muestras en `getSummary()`, cálculo de cuantiles `p95`/`p99` (`sorted.length * 0.95` vs `/`) y `min`/`max` de confianza (`Math.min`/`Math.max` intercambiados).
- `src/laya-metrics.ts:126-151` (`NoCoverage` / `Survived`, `toPrometheusFormat`): formateo de labels (`eventClass` → `event_class`, `suggestedRoute` → `suggested_route`), filtrado de `undefined`, y líneas Prometheus de `latencies` y `confidences` (completamente `NoCoverage`).
- `src/laya-metrics.ts:162`, `182-184` (`CallExpression` / `ConditionalExpression`, `reset()` y `recordDecision`): `this.histograms.clear()` sin validar tras `reset()`, y rama `latencyMs !== undefined`.

### `src/laya-shadow.ts`
- `src/laya-shadow.ts:226-227` (`ConditionalExpression` / `EqualityOperator`): parsing de variables de entorno `LAYA_SUGGEST_ROUTE` y `LAYA_ALLOW_DIRECT_ROUTING`.
- `src/laya-shadow.ts:238-240` (`MethodExpression` / `ArrayDeclaration`, `layaConfigSchema`): validación de rangos `minConfidence` (`min(0).max(1)`) y enum `mode`.
- `src/laya-shadow.ts:278-281`, `401` (`LogicalOperator` / `EqualityOperator`): fronteras exactas `confidence === config.minConfidence` (`>=` vs `>`) y combinación `enabled && mode === 'automatic' && allowDirectRouting`.
- `src/laya-shadow.ts:297-298`, `311` (`ConditionalExpression` / `LogicalOperator`): defaults de `model`/`modelVersion` y flag `shadow: config.mode === 'shadow'`.
- `src/laya-shadow.ts:351`, `382-386` (`NoCoverage` / `Survived`, `setLayaLogHandler`): registro e invocación segura de `_logHandler` con captura de errores.

### `src/learning.ts`
- `src/learning.ts:39`, `87` (`ConditionalExpression`, `typeof value === 'string' && ...includes(value)` → `true`): faltan casos negativos en los type guards `isFeedbackLabel` e `isLearningMode`.

### `src/logger.ts`
- `src/logger.ts:94`, `99` (`Regex`, redacción de `community`): variantes de espacios y lookahead negativo en cadenas con `community=...` o `community ...`.
- `src/logger.ts:117`, `132-133` (`NoCoverage` / `Survived`): fallback cuando `raw` está vacío (`'info'`) y nivel `'silent'` en threshold/mensaje.
- `src/logger.ts:158-180` (`ConditionalExpression` / `EqualityOperator` / `ArrowFunction`, `serializable`): truncamiento exacto `stack.length > MAX_STACK_CHARS` (`>` vs `>=`), propagación de `cause` y serialización de arrays anidados.
- `src/logger.ts:230`, `284` (`ConditionalExpression` / `MethodExpression`): resolución de campos en `merged` y `.trim()` de headers en `extractTraceContext`.

### `src/redaction.ts`
- `src/redaction.ts:41-46`, `100-110` (`Regex` / `ArrayDeclaration` / `BlockStatement` / `ConditionalExpression`): patrones de `BEARER_REGEX`, `BASIC_AUTH_REGEX`, `URL_CREDENTIALS_REGEX` (`http://` vs `https://`), `API_KEY_PATTERNS` (tokens hex de 32-64 chars y prefijos `sk`/`pk`/`mm`/`ghp`/`gho`) y rama de reemplazo condicional para hex tokens.
- `src/redaction.ts:53`, `83`, `85`, `88` (`MethodExpression` / `ArrayDeclaration` / `NoCoverage`): normalización de claves (`toLowerCase` vs `toUpperCase`), defaults de `extraKeys`/`extraPatterns` y guarda `isSensitiveKey` con clave vacía o no string.
- `src/redaction.ts:96`, `127`, `131`, `145` (`ConditionalExpression` / `EqualityOperator` / `ArithmeticOperator`): guarda `depth > 10` (`>` vs `>=`) y recursión `depth + 1` (mutado a `depth - 1`, lo que solo falla si la profundidad supera 10).

## 10. Plan de ratchet (Incremento 1 → Incremento 2)

1. **Incremento 1 (actual):** `thresholds.break` permanece en `null` en los tres paquetes (`high: 80` en todos) y `thresholds.low` queda fijado en el piso entero de la línea base medida:
   - `@ftth-copilot/detection`: `thresholds: { high: 80, low: 72, break: null }` (medido `72.43%`)
   - `@ftth-copilot/evidence`: `thresholds: { high: 80, low: 76, break: null }` (medido `76.14%`)
   - `@ftth-copilot/shared`: `thresholds: { high: 80, low: 59, break: null }` (medido `59.28%`)
   El gate **no bloquea** CI todavía (`break: null`).
2. **Cierre de sobrevivientes (T3–T5):** agregar tests deterministas para matar los mutantes relevantes listados por paquete (fronteras de ventana temporal, desorden de muestras, cálculos estadísticos y cuantiles, bordes `===` en umbrales, circuit breaker/batch de Laya, regex de inyección/redacción y ramas `null`/`NoCoverage`).
3. **Incremento 2 (ratchet):** una vez cerrados los sobrevivientes en las tareas siguientes, fijar `thresholds.break` en el piso entero medido tras cerrar esos sobrevivientes (por debajo de `low`/`high` alcanzados), de modo que cualquier regresión por debajo de la línea medida rompa el build en CI.
