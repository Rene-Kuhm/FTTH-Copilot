# Learning Loop — memoria que aprende sin derivar

**Status**: Planned
**Created**: 2026-10-31
**Scope**: Cerrar el bucle de aprendizaje de FTTH-Copilot: que el sistema mejore
con cada diagnóstico confirmado o refutado por un operador, en tres capas
(recall denso, baselines calibrados por dispositivo, reranker aprendido), siempre
como **contexto y nunca como evidencia**, por tenant, versionado y con release
controlado por eval.
**Depende de**: `odd/tasks/backend-extraction.md` Fases 1-2 (cola BullMQ +
`services/worker`): el entrenamiento, el reindexado y la calibración corren como
jobs del worker, nunca en el request path.
**Relacionadas (specs vigentes)**: `confirmed-incident-memory`, `eval-harness`,
`eval-metrics`, `injection-defense`, `truth-gate-classification`,
`evidence-provenance`, `strict-mode-abstention`, `tenant-policy`,
`temporal-topology`.

---

## Problema

FTTH-Copilot ya junta la materia prima de un sistema que aprende, pero no
aprende. Cada pieza existe por separado y nada cierra el ciclo:

| Pieza | Dónde | Qué hace hoy | Qué le falta |
|---|---|---|---|
| Señal humana | `InvestigationFeedback` (`schema.prisma:746`), rutas `api/investigations/[runId]/…/feedback` | El técnico marca `confirmed` / `incorrect` / `insufficient_data` por versión de investigación | Nadie la consume para mejorar nada; solo la exporta el nightly como métrica |
| Memoria | `ConfirmedIncident` (`schema.prisma:482`) + `retrieveRelevantIncidents` (`packages/evidence/src/relevant-incidents.ts`) | BM25 sobre `searchTokens`, RRF con `RRF_K=60`, top-5, ventana 90 días, inyectado pre-LLM como "contexto, no evidencia" | Solo léxico: "corte de fibra" no encuentra "LOS en todo el PON". La columna `embedding Bytes?` está reservada y vacía ("Phase 2 pgvector deferred") |
| Auto-confirmación | `PendingIncidentCandidate` → promoción a las 24 h (`promote-pending-incidents.ts`) | Cada run limpio en live propone un incidente; se promueve si el incidente quedó resuelto | El sistema se confirma a sí mismo: entra a la misma KB y con el mismo peso que un operador |
| Detección | `packages/detection/src/signal-drift.ts:26` | `thresholdDbm ?? -27` fijo para todas las ONUs de todos los ISPs | Un umbral global ignora que cada ONU tiene su propio presupuesto óptico y su propia deriva térmica diaria |
| Medición | `packages/eval` (gate 100% anti-injection), nightly `eval-metrics` | Mide abstención, cobertura, falsos positivos del gate | Precisión en `TBD`; no hay métrica de calidad de retrieval ni de alertas |
| Linaje | `InvestigationVersion.rulesetVersion/promptVersion/modelVersion` | Versiona reglas, prompt y modelo de cada investigación | No versiona nada aprendido: si mañana la memoria cambia, una investigación vieja no es reproducible |

Consecuencia: el producto repite errores que un técnico ya corrigió, no reconoce
un incidente que ya vio con otras palabras, y alerta con el mismo umbral a una ONU
a 3 km del splitter que a una a 18 km.

### Por qué no alcanza con "agregarle embeddings"

Un bucle de aprendizaje mal hecho es peor que no tenerlo. Estos son los modos de
falla concretos que este repo, tal como está, produciría si se agrega aprendizaje
sin las salvaguardas de esta tarea:

1. **Envenenamiento por la KB.** `rootCause`, `fix` y `summary` son texto libre
   del operador (`api/incidents/[id]/confirm/route.ts`) que termina en el prompt
   vía la superficie `retrieval-block` (una de las 7 de `corpus-schema.ts:44`).
   Hoy un texto malicioso o simplemente equivocado se recupera solo cuando hay
   coincidencia léxica. Con recall semántico se recupera **mucho más seguido**: el
   aprendizaje amplifica el daño de una sola fila mala.
2. **Bucle de auto-confirmación.** Una fila `confirmedBy: 'agent'` nace de lo que
   el agente dijo. Si esa fila entrena el reranker o sesga el recall, el sistema
   aprende a darse la razón (confirmation bias estructural). Incidente resuelto
   ≠ diagnóstico correcto: un incidente se resuelve aunque la causa raíz que dijo
   el agente fuera falsa.
3. **Contexto que mata la abstención.** El agente se abstiene cuando faltan datos
   (`strict-mode-abstention`, `shouldAbstain`). Si le mostramos incidentes
   parecidos muy convincentes, el LLM tiende a "completar" con la historia en vez
   de abstenerse. La memoria puede bajar la tasa de abstención justo en los casos
   donde abstenerse era lo correcto. Eso es una regresión de seguridad invisible
   para el gate actual.
4. **Fuga temporal en la evaluación.** Un corte en un splitter genera 32
   incidentes casi idénticos (uno por ONU). Si se separa train/test al azar, el
   modelo "acierta" porque vio el gemelo en entrenamiento. La métrica miente y se
   promueve un modelo que no generaliza.
5. **Etiquetas en conflicto.** `InvestigationFeedback` guarda historial: la clave
   única es `(tenantId, runId, versionId, authorUserId, label)`, así que un mismo
   técnico puede tener `confirmed` **y** `incorrect` sobre la misma versión, y dos
   técnicos pueden discrepar. Entrenar sobre filas crudas mete ruido
   contradictorio.
6. **Etiqueta degradada en el export.** `feedback-export.ts` mapea `incorrect →
   low_confidence` para reusar `VerdictCode`. Es correcto para métricas, pero si
   el entrenamiento lee el export pierde la diferencia entre "el diagnóstico era
   falso" y "la evidencia era débil".
7. **Umbral aprendido que alerta tarde.** Si la calibración por ONU "aprende" que
   una ONU vive en -26,5 dBm y sube su umbral a -29, alerta **después** del punto
   donde el hardware empieza a perder tramas. Un baseline aprendido nunca puede
   aflojar la seguridad física.
8. **Mezcla entre tenants.** Un índice vectorial global con filtro posterior
   (`WHERE tenantId`) puede devolver vecinos de otro ISP antes de filtrar, o
   perder recall por el filtro. La memoria de un ISP no puede influir en otro.
9. **Irreproducibilidad.** Si la memoria cambia, una investigación de la semana
   pasada no se puede reconstruir. Rompe la promesa de "evidencia verificable" y
   cualquier auditoría.

## Qué se hace

Un bucle cerrado de seis etapas, cada una con dueño y contrato:

```
 operador / agente
       │ feedback + confirmaciones
       v
 [1] Señal curada ──── resolución de etiquetas, pesos de confianza, retracciones
       │
       v
 [2] Dataset versionado ── snapshot inmutable, split temporal + por evento
       │
       v
 [3] Artefactos aprendidos (por tenant, en el worker)
       ├── L1 recall denso      (embeddings + RRF con BM25)
       ├── L2 baselines/umbral  (por dispositivo, acotados)
       └── L3 reranker          (solo etiquetas de operador)
       │
       v
 [4] Gate de release ──── offline eval vs. baseline + eval gate + abstención
       │
       v
 [5] Shadow → activo por tenant (TenantPolicy.learningMode)
       │
       v
 [6] Linaje + observabilidad ── versión del artefacto en cada InvestigationVersion
```

Concretamente:

1. **Señal curada.** Una función pura resuelve las etiquetas de cada versión de
   investigación (última etiqueta por autor → consenso → conflicto se excluye),
   asigna peso de confianza por origen (`operator > system > agent`) y respeta
   retracciones. Esa es la única entrada permitida a cualquier entrenamiento.
2. **Dataset versionado.** Un job del worker congela un snapshot del tenant
   (hash de contenido, ventana temporal, versión del código) y lo separa en
   train/eval **por tiempo y por evento topológico** (incidentes con ancestro
   común en `TopologyEdge` dentro de una ventana cuentan como un solo evento).
3. **Tres capas de aprendizaje**, de menor a mayor riesgo:
   - **L1 — Recall denso.** Embeddings de `ConfirmedIncident` en la columna ya
     reservada (pasa a `vector` de pgvector), fusionados con el BM25 existente
     mediante el RRF que el código ya prevé ("Phase 2 merges a dense list with the
     same K").
   - **L2 — Baselines calibrados por dispositivo.** Baseline robusto por ONU
     (mediana/MAD, la misma estadística de `anomaly.ts`) con componente diaria
     (deriva térmica) a partir de `MetricSample`, que ajusta *cuándo* avisa
     `detectSignalDrift`, dentro de límites físicos fijos.
   - **L3 — Reranker aprendido.** Un modelo liviano que reordena los incidentes
     recuperados según lo que los operadores confirmaron como útil. Se entrena
     **solo** con etiquetas de operador.
4. **Gate de release.** Ningún artefacto se activa si no le gana al baseline
   actual en evaluación offline con significancia, si baja la tasa de abstención
   en casos sin datos, o si rompe el eval gate (attack-pass-rate 100%).
5. **Rollout por tenant**: `off → shadow → active`, con pinning de versión y
   kill switch.
6. **Linaje**: cada `InvestigationVersion` registra qué versión de cada artefacto
   aprendido participó, así toda investigación se puede reproducir.

## Por qué / para qué

- **Para que el producto no repita errores ya corregidos.** Un `incorrect` de un
  técnico baja el peso de ese patrón en el reranker; el siguiente diagnóstico
  parecido ya no lo trae primero.
- **Para reconocer incidentes por significado y no por palabras.** "LOS en todo
  el PON 3" y "corte de troncal en la caja 12" son el mismo tipo de evento; el BM25
  no lo ve, el recall denso sí.
- **Para alertar antes y con menos ruido.** Un baseline por ONU detecta la deriva
  respecto de *su* normal, no respecto de un -27 universal: avisa antes en la ONU
  que se está degradando y deja de molestar con la que siempre vivió cerca del
  límite pero estable.
- **Para que aprender no cueste confianza.** La pared con el Truth Gate, el gate
  de release y el linaje hacen que cada mejora sea medible, reversible y
  auditable — la misma promesa del producto ("evidencia verificable") aplicada al
  propio aprendizaje.
- **Para tener un diferencial defendible.** Muchos productos dicen que su IA
  aprende; muy pocos pueden mostrar que aprende sin derivar, por tenant, con
  métricas y rollback. Este repo ya tiene el eval gate y la provenance para
  sostenerlo.

## Invariantes (no negociables, cada uno con test)

Todo PR de esta tarea DEBE mantener verdaderos estos invariantes. Cada uno tiene
un test que lo rompe a propósito (RED) antes de implementar.

- **I1 — Pared del Truth Gate.** Ningún artefacto aprendido entra a
  `evidence.provenance.v1`, `TruthGate.classify`, `shouldAbstain` ni
  `abstention.v1`. Los umbrales del Truth Gate (`confidence < 0.3`) siguen fijos y
  sin modo. Test: grafo de imports — `packages/evidence/src/truth-gate*` y el
  módulo de abstención no pueden importar nada de `packages/learning`.
- **I2 — Contexto, no evidencia.** Todo lo que L1/L3 aporta al prompt sale por
  `formatRelevantIncidentsBlock` bajo `RELEVANT_INCIDENTS_HEADING`, sin cambiar el
  heading (snapshot byte a byte vigente).
- **I3 — Aislamiento por tenant.** Todo artefacto (embedding, baseline, modelo,
  snapshot) está keyed por `tenantId`. La consulta vectorial filtra por tenant
  **antes** de buscar vecinos. Test: dos tenants con incidentes idénticos; el
  recall de uno nunca devuelve filas del otro, incluso con el índice lleno.
- **I4 — Demo == live.** En `mode: 'demo'` todas las capas devuelven el
  comportamiento sin aprendizaje (hoy `retrieveRelevantIncidents` devuelve `[]`).
- **I5 — Nada de auto-entrenamiento circular.** Las filas `confirmedBy: 'agent'`
  pueden ser *recuperadas* (con peso reducido) pero nunca son etiqueta positiva
  de entrenamiento para L3 ni ancla de calibración para L2.
- **I6 — Seguridad física asimétrica (L2).** El umbral efectivo de una ONU vive en
  `[UMBRAL_TEMPRANO_MAX, UMBRAL_FISICO]` y **nunca** es menos exigente que el
  umbral físico por defecto (-27 dBm hoy, o el de la clase óptica configurada).
  Aprender puede adelantar una alerta, jamás atrasarla.
- **I7 — Abstención preservada.** En el corpus de casos sin datos suficientes, la
  tasa de abstención con aprendizaje activo es ≥ la tasa sin aprendizaje.
- **I8 — Determinismo y reproducibilidad.** Dado `(snapshotHash,
  artifactVersion, input)`, la salida es idéntica byte a byte. Cada
  `InvestigationVersion` guarda las versiones de artefacto que usó.
- **I9 — Batch, nunca online.** Ningún request de chat modifica un artefacto. El
  aprendizaje ocurre solo en jobs del worker y solo se publica vía gate.
- **I10 — Insuficiencia honesta.** Si una métrica no tiene muestra mínima, se
  reporta `insuficiente`, nunca un número (regla 1.6 del roadmap, ya aplicada en
  `computeFeedbackSummary`). Un artefacto sin muestra mínima no se puede
  promover.

## Non-goals (de esta tarea)

- **No hay auto-remediación.** El sistema sigue sin ejecutar cambios en la red;
  aprender cambia lo que *sugiere* y *cuándo avisa*, nunca lo que *hace*.
- **No se toca el Truth Gate** ni sus umbrales, ni la abstención (ver I1).
- **No hay fine-tuning del LLM.** Se aprende alrededor del modelo (memoria,
  ranking, baselines), no dentro. Cambiar de proveedor de LLM no invalida lo
  aprendido.
- **No hay aprendizaje online** por request (ver I9).
- **No se comparte texto crudo entre tenants.** Priors globales para tenants
  nuevos, si existen, son solo estadísticos agregados y opt-in (fuera de alcance
  de esta tarea salvo los defaults actuales).
- **No se reescribe el BM25.** Se queda como la mitad sparse del híbrido; no se
  reemplaza.
- **No se agregan servicios SaaS de terceros** para guardar o procesar texto de
  tenants (coherente con la restricción self-hosted del repo).

## Decisiones de diseño

### D1 — Resolución de etiquetas: última por autor, después consenso

Por cada `(tenantId, versionId)`:

1. Para cada `authorUserId`, quedarse con la fila de `submittedAt` más reciente
   (el historial se conserva en la tabla, pero solo cuenta la última opinión de
   cada técnico).
2. Si todos los autores coinciden → esa etiqueta.
3. Si discrepan → `conflicted`, **excluido** del entrenamiento y contado aparte
   como métrica (una tasa alta de conflicto es señal de que el diagnóstico es
   ambiguo, útil por sí misma).
4. `insufficient_data` nunca es positivo ni negativo para L3: es una etiqueta de
   abstención correcta y alimenta el corpus de I7.

Se descartó "gana el de mayor rol": convierte la jerarquía del NOC en verdad
técnica y esconde el desacuerdo, que es justamente la información valiosa.

Las etiquetas se leen de `InvestigationFeedback` directo, **no** del export
`ftth.investigation-feedback-export.v1` (ver falla 6).

### D2 — Peso por origen y retracciones (KB inmutable, no borrable)

`ConfirmedIncident` es inmutable por diseño (su comentario lo dice). Para
corregirla sin romper eso:

- Peso de recuperación por `confirmedBy`: `operator = 1.0`, `system = 0.8`,
  `agent = 0.5` (valores iniciales; se calibran en Fase 4 y quedan en
  `TenantPolicy`). Se aplica igual que hoy se aplica `DEVICE_HINT_BOOST`.
- **Retracción**: nueva tabla `ConfirmedIncidentRetraction` (append-only:
  `incidentId`, `tenantId`, `reason`, `retractedByUserId`, `createdAt`). Una fila
  retractada queda fuera del recall, del entrenamiento y del índice, pero sigue en
  la base para auditoría. Se crea cuando un operador marca `incorrect` una
  investigación cuyo diagnóstico ya había sido promovido, o a mano desde admin.
- Se descartó borrar o editar la fila: rompería I8 (una investigación vieja que la
  usó ya no sería reproducible).

### D3 — Saneamiento en escritura, no en lectura

El texto libre se sanea **al confirmar** (en la ruta `confirm` y en la
promoción), antes de persistir y antes de generar el embedding: normalización
Unicode NFKC, remoción de caracteres invisibles y de control, cap de bytes (como
`FREE_TEXT_MAX_BYTES`), y detección de patrones de instrucción reusando el
clasificador de la superficie `retrieval-block` del eval. Una fila marcada no se
rechaza en silencio: queda `quarantined` y requiere revisión humana para entrar a
la KB.

Por qué en escritura: el embedding se calcula una vez; si el texto malicioso entra
al vector, sanear en lectura llega tarde. Además el saneamiento queda auditado en
el momento en que hay un humano responsable.

### D4 — Embeddings locales, en el worker

El modelo de embeddings corre **dentro de `services/worker`** (ONNX Runtime para
Node, CPU), multilingüe (el contenido es español rioplatense con jerga técnica en
inglés). Candidatos a medir en el spike T2.1: `multilingual-e5-small` y `bge-m3`.

Por qué local y no una API:
- **Residencia de datos**: el texto de los tenants (nombres de cajas, clientes en
  `summary`) no sale de la infraestructura del ISP.
- **Determinismo (I8)**: el mismo modelo pinneado por hash da el mismo vector;
  una API puede cambiar el modelo por debajo.
- **Costo y disponibilidad**: el reindexado completo no depende de cuotas
  externas.

Cada fila guarda `embeddingModel` + `embeddingModelHash`. Vectores de modelos
distintos **nunca** se comparan: cambiar de modelo dispara un reindexado completo
por tenant (job del worker) y la búsqueda densa se desactiva para ese tenant hasta
que termina, cayendo a BM25 puro (degradación segura, no error).

### D5 — pgvector con filtro por tenant antes del vecino

La columna `embedding Bytes?` pasa a `vector(<dim>)` vía migración con
`CREATE EXTENSION IF NOT EXISTS vector`. Para cumplir I3 sin perder recall:

- El corpus por tenant es chico (cientos a pocos miles de filas). Primero se
  mide en T2.3 si la búsqueda exacta (`ORDER BY embedding <=> $q` con `WHERE
  "tenantId" = $t`, sin índice ANN) entra en presupuesto de latencia. Si entra, se
  usa exacta: recall perfecto y cero riesgo de mezcla.
- Si no entra, índice HNSW con escaneo iterativo filtrado (verificar en T2.3 que la
  versión de pgvector del stack lo soporte) o índices parciales por tenant
  grande. Nunca índice global con filtro posterior.

Prisma no tipa `vector`: el acceso va por `$queryRaw` encapsulado en un único
módulo con tipos propios y tests de contrato, no repartido por el código.

### D6 — Fusión híbrida: el RRF que ya existe, con pesos

`retrieveRelevantIncidents` hoy hace RRF sobre una sola lista. Se extiende a dos
listas (sparse + dense) con el mismo `RRF_K = 60`, y el peso de origen (D2) se
aplica antes del ranking. Se mantienen `MIN_SPARSESCORE`, la normalización por
`(RRF_K + 1)` documentada en el archivo, el `limit` y `sinceDays` con la misma
precedencia (`args ?? tenantPolicy ?? default`). Sin aprendizaje activo, la salida
es **byte-idéntica** a la actual (test de no-regresión sobre el snapshot de Fase
D).

Una fila que solo aparece en la lista densa necesita un umbral de similitud mínimo
propio (`MIN_DENSE_SIMILARITY`); sin él, el denso siempre devuelve "algo" aunque
no haya nada parecido, y eso es contexto falso.

### D7 — L2: baseline robusto + estacionalidad diaria, acotado

Por ONU, sobre `MetricSample` (`RX_POWER_DBM`) de los últimos N días:
- nivel = mediana; dispersión = MAD × `ROBUST_SIGMA` (1,4826, ya en
  `anomaly.ts`);
- componente diaria por franja horaria (la temperatura mueve la potencia óptica
  durante el día; sin esto, cada tarde calurosa es una "anomalía").

El umbral de alerta efectivo de `detectSignalDrift` es:

```
umbralEfectivo = clamp(
  nivel − k · dispersión,           // "salió de su normal"
  min = UMBRAL_FISICO,              // nunca más laxo que -27 (I6)
  max = UMBRAL_TEMPRANO_MAX         // no alertar por una ONU sana
)
```

y `detectSignalDrift` recibe ese valor por `opts.thresholdDbm` (la firma ya lo
admite), cableado desde `packages/alerts/src/runner.ts`. Sin baseline suficiente
(menos de N días o muestras), usa el default actual: arranque en frío seguro.

Se descartó un modelo de series temporales complejo (ARIMA, redes recurrentes):
no hay volumen etiquetado para validarlo, y un estadístico robusto se puede
explicar al técnico en una línea ("esta ONU suele estar en -21,3 ± 0,4; hoy está
en -23,1").

### D8 — L3: reranker liviano, solo operador, explicable

Modelo: regresión logística (o gradient boosting chico) sobre features
interpretables del par (consulta, incidente candidato): score BM25, similitud
densa, coincidencia de `deviceKind`/`deviceId`, distancia topológica (vía
`TopologyEdge`), antigüedad, peso de origen, tasa histórica de "útil" del
incidente.

Etiquetas: un incidente recuperado se considera útil cuando la investigación que
lo usó recibió `confirmed` de un operador, e inútil cuando recibió `incorrect`.
Requiere registrar qué incidentes se mostraron en cada investigación (impresión
→ resultado); hoy no se registra, se agrega en T5.1.

Por qué liviano: pocas miles de etiquetas por tenant no alcanzan para un modelo
profundo; una logística es calibrable, sus pesos se pueden mostrar, y su peor caso
es "ordenar como hoy".

Exposure bias: el modelo solo ve resultados de lo que se mostró. Para no
congelarse en su propio ranking, en shadow se registra también la posición que le
habría dado a incidentes que no se mostraron, y la evaluación offline usa solo
pares observados.

### D9 — Split temporal + por evento

Train = antes de `T`, eval = después de `T`. Dentro de cada lado, los incidentes
que comparten ancestro en `TopologyEdge` (vigente en `observedAt`) en una ventana
de 2 h se agrupan como un evento y nunca quedan partidos entre train y eval. Nunca
split aleatorio.

### D10 — Release: shadow, comparación, promoción por tenant

`TenantPolicy` suma `learningMode: off | shadow | active` (default `off`) y
`learningArtifactPins Json?`. Mismo patrón que la capa Laya ya usa (`laya-shadow`):

- `shadow`: el artefacto calcula su salida y se registra junto a la salida
  actual, pero el usuario ve la actual.
- La promoción a `active` exige, contra el baseline vigente y en el split de eval:
  - **L1/L3**: mejora de `recall@5` y `MRR` con intervalo de confianza bootstrap
    que excluye 0, y sin caída de la tasa de abstención (I7);
  - **L2**: más anticipación media antes de LOS reales y tasa de falsas alarmas
    no peor;
  - eval gate verde (attack-pass-rate 100%, cobertura de las 7 superficies);
  - muestra mínima (I10).
- Rollback = volver el pin a la versión anterior o `learningMode: off`. Efecto
  inmediato, sin deploy.

### D11 — Linaje en cada investigación

`InvestigationVersion` suma `learningLineage Json` con
`{ l1: {artifactVersion, embeddingModelHash}, l2: {...}, l3: {...},
snapshotHash, learningMode }`. Junto con `rulesetVersion`, `promptVersion` y
`modelVersion` existentes, cierra la reproducibilidad (I8). Si `learningMode` es
`off`, se guarda explícito, no ausente.

## Arquitectura

```
                         apps/web (request path, solo lectura de artefactos)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │ chat route ── retrieveRelevantIncidents(sparse ⊕ dense ⊕ rerank) ──┐     │
  │                     │ (lee artefacto pinneado por tenant)          │     │
  │                     v                                              v     │
  │        formatRelevantIncidentsBlock ("contexto, no evidencia")   LLM     │
  │                                                                    │     │
  │ Truth Gate / shouldAbstain  <── evidence.provenance (SIN aprendizaje)    │
  │                                                                          │
  │ feedback routes ──> InvestigationFeedback ──┐   confirm ──> sanitize ──┐ │
  └─────────────────────────────────────────────┼──────────────────────────┼─┘
                                                v                          v
                                   Postgres: feedback, ConfirmedIncident(+vector),
                                   Retraction, Impressions, MetricSample, Artifacts
                                                ^
                                                │ escribe artefactos versionados
  ┌─────────────────────────────────────────────┴────────────────────────────┐
  │ services/worker (jobs BullMQ, batch)                                     │
  │  learning.embed       → embebe filas nuevas/saneadas (ONNX local)        │
  │  learning.reindex     → reembebe tenant al cambiar de modelo             │
  │  learning.snapshot    → dataset congelado + split temporal/evento        │
  │  learning.calibrate   → baselines L2 por ONU                             │
  │  learning.train       → reranker L3 (solo etiquetas de operador)         │
  │  learning.evaluate    → offline vs baseline + abstención + eval gate     │
  │  learning.shadowReport→ métricas shadow a VictoriaMetrics                │
  └──────────────────────────────────────────────────────────────────────────┘
```

Nuevo package **`packages/learning`** (puro, sin Prisma, como
`packages/evidence`): resolución de etiquetas, pesos, split, features, scoring del
reranker, cálculo de baselines, métricas. El worker es el shell de persistencia;
la web solo lee artefactos publicados.

## Tareas

Cada tarea cierra en una sesión, entra como commit con sus tests (RED→GREEN) y
pasa `pnpm typecheck && pnpm lint && pnpm test` + eval gate. Ninguna fase cambia
lo que ve el usuario hasta la Fase 6.

### Fase 0 — Verdad de base (sin cambio de comportamiento)
- [ ] **T0.1** Crear `packages/learning` (puro, strict, vitest, cobertura
  80/80/70 como el núcleo). Test de grafo de imports para I1.
- [ ] **T0.2** `resolveLabels(rows)` según D1: última por autor, consenso,
  `conflicted`, tratamiento de `insufficient_data`. Casos: mismo autor con dos
  etiquetas, dos autores en desacuerdo, fila huérfana de versión.
- [ ] **T0.3** `groupIntoEvents(incidents, topology, windowMs)` y
  `temporalSplit(events, T)` según D9. Test de fuga: dos ONUs del mismo splitter
  nunca quedan en lados distintos.
- [ ] **T0.4** `sampleSufficiency(...)` reutilizando el umbral de
  `computeFeedbackSummary`; toda métrica devuelve `insuficiente` bajo umbral
  (I10).
- [ ] **T0.5** Job `learning.snapshot` en el worker: congela dataset por tenant con
  `snapshotHash` (contenido + ventana + versión de código). Reproducible: dos
  corridas sobre los mismos datos → mismo hash.

### Fase 1 — Salvaguardas antes del aprendizaje
- [ ] **T1.1** `TenantPolicy.learningMode` (`off` default) + `learningArtifactPins`;
  migración Prisma; resolver con precedencia como `retrievalLimit`.
- [ ] **T1.2** Tabla `ConfirmedIncidentRetraction` + exclusión en
  `retrieveRelevantIncidents` (D2). Test: fila retractada nunca se recupera.
- [ ] **T1.3** Peso por `confirmedBy` en el ranking (D2), con `learningMode: off`
  ⇒ salida byte-idéntica a hoy.
- [ ] **T1.4** Saneamiento en escritura + estado `quarantined` en la ruta
  `confirm` y en la promoción (D3).
- [ ] **T1.5** Corpus red nuevo para la superficie `retrieval-block` con filas
  envenenadas en la KB (instrucciones, role-reassignment, smuggling de nombre de
  cliente); el eval gate debe seguir en 100%.
- [ ] **T1.6** Corpus de abstención para I7: casos sin datos suficientes con
  incidentes históricos muy parecidos en la KB. Línea base de abstención
  registrada.

### Fase 2 — L1 recall denso (shadow)
- [ ] **T2.1** Spike: medir `multilingual-e5-small` vs `bge-m3` en ONNX/CPU sobre un
  set de pares español técnico; elegir por recall@5, latencia y RAM del worker.
  Resultado escrito en esta tarea.
- [ ] **T2.2** Migración pgvector: extensión, columna `vector(dim)`,
  `embeddingModel`, `embeddingModelHash`. Módulo único `$queryRaw` tipado.
- [ ] **T2.3** Medir búsqueda exacta filtrada por tenant vs HNSW con filtro
  iterativo (D5); decidir y documentar. Test de I3 con índice lleno.
- [ ] **T2.4** Jobs `learning.embed` (filas nuevas, solo saneadas) y
  `learning.reindex` (cambio de modelo, con caída segura a BM25 mientras corre).
- [ ] **T2.5** Fusión híbrida en `retrieveRelevantIncidents` (D6) +
  `MIN_DENSE_SIMILARITY`. Snapshot de Fase D intacto con aprendizaje apagado.
- [ ] **T2.6** Modo shadow: registrar ranking híbrido junto al actual por
  investigación; métricas a VictoriaMetrics.

### Fase 3 — L2 baselines calibrados (shadow)
- [ ] **T3.1** `computeBaseline(samples)` en `packages/learning`: mediana, MAD,
  componente diaria; mínimo de días/muestras o `null`.
- [ ] **T3.2** `effectiveThreshold(baseline, bounds)` con clamp asimétrico (I6).
  Test de propiedad: para cualquier baseline, el umbral nunca es más laxo que el
  físico.
- [ ] **T3.3** Job `learning.calibrate` por tenant; artefacto versionado.
- [ ] **T3.4** Cableado en `packages/alerts/src/runner.ts` vía
  `opts.thresholdDbm`, solo en `active`; en `shadow` calcula y registra qué alerta
  *habría* disparado y cuándo.
- [ ] **T3.5** Métrica de anticipación: tiempo entre alerta (real o shadow) y el
  LOS real posterior; tasa de falsas alarmas.

### Fase 4 — L3 reranker (shadow)
- [ ] **T4.1** Registro de impresiones: qué incidentes se mostraron en cada
  investigación y en qué posición (prerequisito de D8).
- [ ] **T4.2** `extractFeatures(query, candidate, context)` puro y determinista.
- [ ] **T4.3** Job `learning.train`: solo etiquetas de operador resueltas (I5),
  split de Fase 0, artefacto con pesos visibles.
- [ ] **T4.4** Scoring en el request path leyendo el artefacto pinneado; peor
  caso = orden actual.
- [ ] **T4.5** Shadow con registro de posiciones contrafactuales (exposure bias).

### Fase 5 — Gate de release y linaje
- [ ] **T5.1** Job `learning.evaluate`: recall@5, MRR, anticipación, falsas
  alarmas, abstención (I7), con bootstrap; reporte `insuficiente` bajo muestra.
- [ ] **T5.2** Regla de promoción de D10 como función pura testeada; el job no
  puede promover si cualquier criterio falla.
- [ ] **T5.3** `InvestigationVersion.learningLineage` (D11), siempre poblado
  (incluso `off`).
- [ ] **T5.4** Test de reproducibilidad: reconstruir una investigación pasada con
  su linaje da el mismo bloque de contexto byte a byte (I8).

### Fase 6 — Activación y explicabilidad
- [ ] **T6.1** Activación por tenant (`shadow → active`) desde admin, con
  auditoría (quién, cuándo, qué versión).
- [ ] **T6.2** UI "por qué": en la tarjeta de investigación, qué incidentes se
  recordaron y por qué (sparse/dense/rerank), y para L2 el baseline de la ONU en
  una línea.
- [ ] **T6.3** Alertas operativas: caída de calidad shadow vs activo, tasa de
  conflicto de etiquetas, tasa de retracciones, filas en cuarentena.
- [ ] **T6.4** Docs: modelo mental del bucle, runbook de rollback, cómo leer las
  métricas.

## Plan de rollback

1. **Todo nace apagado.** `learningMode` default `off`: desplegar el código no
   cambia nada hasta activar un tenant.
2. **Rollback sin deploy.** Volver el pin del artefacto a la versión anterior o
   pasar el tenant a `off` tiene efecto inmediato.
3. **Degradación segura por capa.** Sin embeddings válidos → BM25 puro. Sin
   baseline suficiente → umbral físico por defecto. Sin modelo L3 → orden actual.
   Ninguna falta de artefacto produce error de cara al usuario.
4. **Migraciones aditivas.** Columnas y tablas nuevas, ninguna destructiva. La
   columna `embedding` se convierte de `Bytes?` (hoy siempre nula) a `vector`; el
   down-migration la devuelve a `Bytes?` sin pérdida porque no había datos.
5. **KB intacta.** Las retracciones son append-only; nada se borra ni edita en
   `ConfirmedIncident`, así que revertir esta tarea deja la KB igual que antes.

## Quality gates (por tarea, antes de cada commit)

```
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @ftth-copilot/eval run test     # attack-pass-rate 100%
```

Además, según la fase: tests de invariantes I1-I10 afectados, snapshot de Fase D
intacto con aprendizaje apagado, y suite de integración contra Postgres con
pgvector desde la Fase 2.

## Preguntas abiertas (se resuelven en su tarea, no antes)

- **Clase óptica por ONU** (B+ vs C+): define el umbral físico de I6. Si el
  connector no la expone, se usa -27 para todas hasta que se pueda configurar
  (T3.2).
- **Volumen real de feedback** por tenant: decide si L3 es viable en el corto
  plazo o queda en shadow indefinido. Lo responde T0.4 con datos.
- **Modelo de embeddings**: lo decide el spike T2.1 con números, no esta tarea.
