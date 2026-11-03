# Backend Extraction

**Status**: In progress
**Created**: 2026-10-31
**Scope**: Sacar el trabajo de fondo (polling, ingesta, scheduler) fuera del
proceso Next.js hacia un servicio `worker` propio, con cola durable. La API HTTP
queda en `apps/web` como BFF delgado (su extracción es una tarea futura).
**Relacionadas**: `odd/tasks/event-ingest-durability.md`,
`odd/tasks/snmp-ingest.md`, `odd/tasks/enterprise-observability-completion.md`

---

## Problema

Hoy el backend no es un backend: son loops de fondo y un socket UDP colgados del
servidor web. El acoplamiento está en un archivo concreto:

- `apps/web/instrumentation.ts` → `register()` arranca, **dentro del proceso
  Node de Next.js**, el loop de polling de métricas, el de auditoría de
  firmware, el de colección FEC, el receptor de syslog y (detrás de
  `SNMP_RECEIVER_ENABLED`) el receptor de traps SNMP + el event drainer.
- `apps/web/lib/monitoring/scheduler.ts` corre el trabajo recurrente con timers
  en proceso (`setInterval` + single-flight), leyendo y escribiendo Postgres vía
  `@ftth-copilot/db` en el **mismo event loop que atiende el HTTP**.
- 61 handlers `route.ts` bajo `apps/web/app/api/**` cargan la API en el mismo
  deployable.

Esto produce cuatro modos de fallo, cada uno grave para un producto NOC cuya
regla de dominio es *"no se pueden perder traps SNMP ni syslog"*
(`event-ingest-durability.md`):

1. **El monitoreo muere en cada deploy/reinicio de la web.** El poller y el
   socket UDP comparten el ciclo de vida del proceso web. Un redeploy de front
   corta el polling de OLTs y tira los traps en vuelo.
2. **Escalar en horizontal duplica el trabajo.** Dos réplicas web corren los
   `setInterval` dos veces: la NMS se polea doble, el firmware se audita doble, y
   el puerto UDP solo puede bindear en una — la otra crashea o no hace nada en
   silencio. El tier web, por diseño, **no puede escalar**.
3. **No hay aislamiento de carga.** Un pico de tráfico en el dashboard compite
   por el mismo event loop que la ingesta de traps y el polling; un poll lento
   bloquea el HTTP y viceversa.
4. **No hay retry ni backpressure durable.** El trabajo programado son timers
   fire-and-forget: sin cola, sin retry con backoff, sin dead-letter, sin
   garantía at-least-once — justo lo que la durabilidad de ingesta necesita.

## Qué se hace

Extraer el backend a su propio deployable **`services/worker`** dentro del
monorepo, gobernado por una **cola de trabajos durable**, dejando `apps/web`
como UI + BFF delgado. **No es reescritura de lenguaje ni framework**: es
TypeScript importando los packages que ya tienen la lógica.

1. **Nuevo `services/worker`** (TypeScript, Node 22): proceso de larga duración
   dueño de todo el trabajo de fondo — polling de OLTs, auditoría de firmware,
   colección FEC, recepción de syslog y SNMP, event drainer. Importa
   `@ftth-copilot/monitoring`, `@ftth-copilot/soc`, `@ftth-copilot/analytics`,
   `@ftth-copilot/db` **sin tocarlos**.
2. **BullMQ + Redis** como cola (self-hosted en el stack compose, sin SaaS,
   coherente con la restricción del proyecto). Los loops recurrentes pasan a
   jobs repetibles; la recepción de syslog/SNMP encola jobs de ingesta que
   drenan con at-least-once + retry + dead-letter.
3. **`apps/web/instrumentation.ts` deja de arrancar loops.** El deployable web ya
   no polea, ni audita, ni bindea UDP, ni programa nada. Sirve HTTP y el stream
   SSE, leyendo de Postgres el estado que produce el worker.
4. **La API HTTP queda estable en su contrato.** Las 61 rutas mantienen sus
   contratos; donde una ruta hoy dispara trabajo de fondo inline, ahora **encola
   un job**.

## Por qué / para qué

- **Para que el producto siga monitoreando durante un deploy de la web.** La
  ingesta y el polling viven en un proceso con su propio ciclo de vida;
  redeployar la UI no deja ciego al NOC.
- **Para que el tier web escale en horizontal** — los loops corren una sola vez,
  en el worker, sin importar cuántas réplicas web haya.
- **Para que la durabilidad de ingesta sea estructural, no best-effort** —
  at-least-once, retry con backoff y dead-letter cumplen la regla de dominio de
  que traps y syslog no se pierden, y le dan a `event-ingest-durability` y
  `snmp-ingest` un hogar real.
- **Para aislar la carga** — un pico del dashboard ya no puede frenar la ingesta
  de traps, y un poll lento de la NMS ya no puede frenar el HTTP.
- **Para que el sistema sea operable** — profundidad de cola, latencia de jobs,
  retries y dead-letters pasan a ser señales de primera clase, exportadas al
  stack VictoriaMetrics que ya existe.

## Non-goals (de esta tarea)

- No se agrega motor de persistencia nuevo. Postgres se queda; la pregunta de
  series temporales (Timescale vs. el camino VictoriaMetrics existente) queda
  fuera de alcance.
- Nada de SaaS gestionado, ni Grafana, ni librería de charts externa — coherente
  con `enterprise-observability-completion`.
- No se parte todavía la API HTTP a su propio servicio (queda en `apps/web` como
  BFF delgado; una tarea de seguimiento puede extraerla).
- No se tocan los connectors, el runtime de agent-core, el eval gate, ni la capa
  de decisión Laya.
- No se reescribe ningún package en otro lenguaje. El mirror Python
  `services/laya` no se toca aquí (su de-duplicación es otra tarea).

## Decisión de diseño

**BullMQ + Redis, no un broker pesado.** BullMQ es TypeScript puro,
self-hostable en el compose, con repeatable jobs, retry/backoff, rate limiting y
dead-letter de fábrica. Cubre el 100% de lo que hoy hacen los `setInterval` y le
da a la ingesta las garantías que le faltan. Temporal / RabbitMQ / Kafka se
descartan por ahora: resuelven workflows durables largos o streaming de alto
volumen que este producto todavía no tiene, a cambio de operar un sistema
distribuido extra. Si los flujos "ONU degradándose → confirmar → escalar" se
vuelven máquinas de estado largas, se reevalúa Temporal en otra tarea.

**El worker importa los packages, no los duplica.** Toda la lógica ya vive en
`packages/*`. El worker es un *host de ejecución*: traduce jobs de la cola a
llamadas a `pollConnections`, `runFirmwareAudit`, `startSnmpReceiver`, etc. Cero
lógica de dominio nueva, así el riesgo de regresión es de cableado, no de
comportamiento.

**Recepción ≠ procesamiento.** El receptor UDP (syslog/SNMP) solo spoolea al
store durable (ya definido en `event-ingest-durability`) y encola un job de
drenado. Bindear el socket y drenar a Postgres se desacoplan: un drainer lento
nunca hace que el kernel descarte datagramas.

**Flag de corte `BACKEND_MODE`.** `embedded` (comportamiento de hoy) vs.
`worker` (extraído). Permite dual-run y rollback sin revertir código. El camino
embedded solo se borra en la última fase, cuando el worker corrió verde en
staging.

**Idempotencia de jobs repetibles.** Cada loop recurrente usa un `jobId` estable
por ventana (p. ej. `poll:<connId>:<minuto>`) para que, aun con dos workers,
BullMQ no ejecute el mismo tick dos veces.

## Arquitectura

```
          ANTES                                  DESPUÉS
  ┌──────────────────────┐            ┌──────────────────────┐
  │  apps/web (Next.js)  │            │  apps/web (Next.js)  │
  │                      │            │   UI + BFF (SSE)     │
  │  HTTP 61 rutas       │            │   HTTP 61 rutas  ────┼──enqueue──┐
  │  + instrumentation:  │            │   (sin loops)        │           │
  │    setInterval loops │            └──────────┬───────────┘           │
  │    UDP syslog/SNMP   │                       │ lee estado            │
  │    event drainer     │                       v                       v
  └──────────┬───────────┘            ┌──────────────────┐      ┌─────────────────┐
             │ mismo event loop       │     Postgres     │<─────│  Redis (BullMQ) │
             v                        │  (Prisma)        │      └────────┬────────┘
       ┌──────────┐                   └──────────────────┘               │ jobs
       │ Postgres │                              ^                        v
       └──────────┘                              │ escribe     ┌──────────────────────┐
                                                 └─────────────│  services/worker     │
                                                               │  - poll / firmware   │
                                      UDP syslog/SNMP ─────────▶│  - FEC collection    │
                                                               │  - UDP recv + spool  │
                                                               │  - event drainer     │
                                                               └──────────────────────┘
```

Puntos clave:
- El web deja de tener loops y socket; solo HTTP/SSE y encolado.
- Redis es el único componente de infraestructura nuevo; vive en el compose.
- El worker es el único que bindea UDP y el único que corre jobs recurrentes.
- Postgres sigue siendo la fuente de verdad del estado que la UI lee.

## Specs

Requisitos normativos de esta feature. Cada `S#` es verificable y cada tarea
de la tabla de abajo referencia al menos uno.

- **S1** — `services/worker` es un deployable TypeScript sobre Node 22, dueño de
  todo el trabajo de fondo: polling de OLTs, auditoría de firmware, colección
  FEC, recepción de syslog y SNMP, y event drainer. Importa
  `@ftth-copilot/monitoring`, `@ftth-copilot/soc`, `@ftth-copilot/analytics` y
  `@ftth-copilot/db` **sin tocarlos**.
- **S2** — La cola es **BullMQ + Redis**, self-hosted en el stack compose.
  Cero SaaS.
- **S3** — Los loops recurrentes pasan a jobs repetibles; la recepción de
  syslog/SNMP encola jobs de ingesta que drenan con **at-least-once + retry +
  dead-letter**.
- **S4** — Bajo `BACKEND_MODE=worker`, `apps/web/instrumentation.ts` **no**
  arranca polling, auditoría, FEC, syslog, SNMP ni drainer. Bajo `embedded`, el
  comportamiento es idéntico a hoy.
- **S5** — La API HTTP queda estable: las 61 rutas de `apps/web/app/api/**`
  mantienen su contrato; donde hoy disparan trabajo de fondo inline, ahora
  **encolan un job**.
- **S6** — El flag `BACKEND_MODE` selecciona `embedded` (comportamiento de hoy)
  vs `worker` (extraído), y permite dual-run y rollback **sin revertir código**.
- **S7** — Cada loop recurrente es idempotente por ventana: con dos workers,
  BullMQ **no ejecuta el mismo tick dos veces**.
- **S8** — Recepción ≠ procesamiento: el receptor UDP solo spoolea al store
  durable y encola un job de drenado. Un drainer lento nunca hace que el kernel
  descarte datagramas.
- **S9** — No se agrega motor de persistencia nuevo. Postgres se queda.
- **S10** — Nada de SaaS gestionado, ni Grafana, ni librería de charts externa.
- **S11** — La API HTTP **no** se parte a su propio servicio: queda en
  `apps/web` como BFF delgado.
- **S12** — No se tocan los connectors, el runtime de agent-core, el eval gate ni
  la capa de decisión Laya.
- **S13** — Ningún package se reescribe en otro lenguaje. El mirror Python
  `services/laya` no se toca.
- **S14** — El worker **importa** los packages, no los duplica: cero lógica de
  dominio nueva. El riesgo de regresión es de cableado, no de comportamiento.
- **S15** — Rollback: `BACKEND_MODE=embedded` + no desplegar el worker. El
  default queda `embedded` hasta T15. Sin revert de código, sin migración de
  datos.
- **S16** — La pérdida de Redis es sobrevivible: el worker falla cerrado y
  alerta; como la recepción spoolea al store durable antes de encolar, ningún
  trap se pierde — se reproduce al volver Redis.
- **S17** — Quality gate por tarea, antes de cada commit:
  `pnpm typecheck && pnpm lint && pnpm test`. Cuando aplique, también
  `pnpm --filter @ftth-copilot/eval run test` y los tests de durabilidad de la
  Fase 4.
- **S20** — Toda investigación iniciada termina en un estado final: `ready`
  con su versión persistida, o `failed`. Una investigación `pending` más vieja
  que `INVESTIGATION_PENDING_TTL_MS` pasa a `expired`, y el incidente se puede
  volver a investigar. El pipeline corre **una sola vez** por `runId`+`versionId`
  (el id fijo del job lo garantiza), tanto si excede el presupuesto HTTP de 8 s
  como si falla.
- **S19** — Los eventos que fueron al dead-letter se pueden **reprocesar**:
  un comando `replay:dead-letter` los vuelve a encolar. Como el `ingestId` es
  único y se inserta con `skipDuplicates`, el replay no puede duplicar un
  evento que ya se había guardado. Sin esto, el dead-letter guarda los datos
  pero en la práctica es pérdida: nadie puede recuperarlos.
- **S18** — Observabilidad: profundidad de cola, latencia de job, retries y
  dead-letters se exportan al stack VictoriaMetrics existente.

## Tasks

Ruta: `inline` = el orquestador lo implementa; `worker` = subagente con
superficie de edición acotada. `Commit` se completa con el hash que sostiene la
tarea.

| ID  | Spec                | Route   | Commit  | Tarea |
| --- | ------------------- | ------- | ------- | ----- |
| T1  | S2, S14             | inline  | `32abc93`, `6eeced2` | Crear `packages/jobs`: setup de BullMQ (conexión Redis desde env), definición tipada de colas y nombres de job, helpers `enqueue`/`defineWorker`. Un único punto tipado para la cola, reusable por web y worker. |
| T2  | S2, S6, S9          | inline  | `chore(infra)` | Añadir servicio `redis` a `docker-compose.yml` / `docker-compose.demo.yml` / `docker-compose.prod.yml` y variables en `.env.example` (`REDIS_URL`, `BACKEND_MODE=embedded`). |
| T3  | S3                 | inline  | `6eeced2` | RED→GREEN: tests de `packages/jobs` (encolar, consumir, retry, dead-letter) contra Redis real, siguiendo la convención del repo (suite gated por env, config de integración aparte). Sin tocar la web aún. |
| T4  | S1, S14            | inline  | `82eb4e9` | Crear `services/worker` (package TS + `Dockerfile` + entrypoint) que levanta un `Worker` BullMQ vacío y expone `/healthz` + métricas. Tener el proceso desplegable y observable antes de moverle trabajo. |
| T5  | S1, S17            | inline  | `chore(infra)` | Servicio `worker` en los compose files; CI: job de build+test del worker; `BACKEND_MODE` documentado. |
| T6  | S3, S7, S14        | inline  | `01f6ca5` | Convertir `startPollingLoop` en productor de jobs repetibles (`jobId` estable por ventana) + handler en el worker que llama `pollConnections`. Idempotente ante doble réplica. |
| T7  | S3, S7, S14        | inline  | `01f6ca5` | Igual para `startFirmwareAuditLoop` y `startFecCollectionLoop`. |
| T8  | S4, S6             | inline  | `ce8eb5b` | Bajo `BACKEND_MODE=worker`, `instrumentation.ts` NO arranca estos loops. Bajo `embedded`, comportamiento idéntico a hoy. RED→GREEN del selector. |
| T9  | S3, S8             | inline  | `0a65327`, `24672cf` | Mover el bind del receptor syslog al worker; recepción → spool durable (reusa `event-ingest-durability`) → encola job de drenado. La web ya no bindea UDP en modo worker. |
| T10 | S3, S8             | inline  | `e2c6cb7`, `chore(infra)` | Igual para el receptor SNMP + el event drainer como worker BullMQ (reemplaza `startEventDrainer` en proceso). |
| T11 | S3, S16            | inline  | `b1313ee`, `0b8d5a4`-equivalente | Tests de durabilidad end-to-end: con Redis caído, el spool retiene y reproduce al volver; at-least-once verificado con `ingestId`. |
| T12 | S5, S20            | inline  | `d376289` (unidades 8-11) | Inventariar las rutas `app/api/**` que hoy hacen trabajo de fondo inline y cambiarlas a `enqueue`, manteniendo el contrato de respuesta. **Hecha**: el inventario (L26/L27) dejó un solo candidato real, `incidents/[id]/investigate`, y la unidad 8 lo movió a la cola `ftth-investigation` con claim por advisory lock. |
| T13 | S5                | inline  | unidad 11 | Tests de contrato: las respuestas de esas rutas no cambian de forma observable; el efecto ahora ocurre vía job. **Hecha**: la unidad 11 los cubre (presupuesto, error, pending viejo, pedidos simultáneos, tenant ajeno, espera acotada). |
| T14 | S15               | inline  | `#361`, `#363`, `#364`, `#365` | Correr en staging con `BACKEND_MODE=worker` y validar: poll, firmware, FEC, syslog, SNMP y drenado funcionan, con web escalada a 2 réplicas sin duplicar trabajo. **Hecha**: los seis planos quedaron validados contra un Postgres real en la VPS `vps-casa`, con la web en dos réplicas detrás de Caddy. La evidencia y lo que quedó abierto están en L35. |
| T15 | S4, S6, S15        | pending | pending | Flip del default a `BACKEND_MODE=worker`; borrar el camino embedded de `instrumentation.ts` y el scheduler en proceso. **Es irreversible en código**: por eso espera a que T14 haya corrido verde. |
| T16 | S18               | inline  | `0f63836`, `feafc26`, `8d5c4b5`, `fec08a2` | Observabilidad: exportar a VictoriaMetrics profundidad de cola, latencia de job, retries y dead-letters; panel/alertas mínimas. |
| T18 | S19                | inline  | `replay:dead-letter` | Comando `replay:dead-letter`: devuelve los eventos del `events.dlq.jsonl` al spool (o los encola directo), con `dry-run`, filtro por tenant y conteo de recuperados/duplicados. Reusa el `ingestId` como clave de idempotencia, así que un replay repetido no duplica nada. |
| T17 | S1, S17            | inline  | `40909a7` | Docs: `README`/deploy actualizados con la nueva topología (web + worker + redis), diagrama y runbook de rollback. |

## Plan de rollback

El cambio va detrás de `BACKEND_MODE` y aterriza en pasos reversibles:

1. **Dual-run.** Worker y loops en proceso son mutuamente excluyentes vía
   `BACKEND_MODE`. Default queda `embedded` hasta T15. Rollback = poner
   `BACKEND_MODE=embedded` y no desplegar el worker. Sin revert de código, sin
   migración de datos.
2. **Sin cambio de schema en el camino crítico.** Los jobs llevan payload en
   Redis; las lecturas/escrituras a Postgres son las mismas filas que los loops
   ya tocan, así que el rollback deja la DB en una forma que el camino embedded
   entiende.
3. **Revert por fase.** Cada fase es un commit con sus tests; cualquier fase se
   revierte sola porque el camino embedded recién se borra en T15, tras correr
   verde en staging.
4. **Pérdida de Redis sobrevivible.** Si Redis no está, el worker falla cerrado y
   alerta; como la recepción spoolea al store durable antes de encolar (per
   `event-ingest-durability`), ningún trap se pierde — se reproduce al volver
   Redis.

## Quality gates (por tarea, antes de cada commit)

```
pnpm typecheck && pnpm lint && pnpm test
```
Más, cuando aplique: `pnpm --filter @ftth-copilot/eval run test` (el eval gate no
debe romperse) y los tests de durabilidad de las fases 4.

## Log

- **L1** (2026-10-31) — Plan de la feature redactado en este documento
  (origen: sesión de planificación). No quedó registrada una petición textual
  del usuario más allá de este documento; el documento es la especificación.
- **L2** (2026-10-31) — Petición de arranque del usuario, textual:
  `revisa esto /home/tecnodespegue/proyectos/FTTH-Copilot/odd/tasks/backend-extraction.md  y comencemos a trabajar en esto`
- **L3** (2026-10-31) — Verificación de entorno antes de implementar: Redis
  disponible (mise `redis 8.10.2` y Docker `redis:8.10.2-alpine` ya descargado),
  `bullmq` latest = **6.5.3** (la línea v6 **eliminó** `repeat`,
  `getRepeatableJobs` y la clase `Repeat`; los loops recurrentes deben usar
  **Job Schedulers** → `upsertJobScheduler`). `ioredis` latest = 6.0.0; se fija
  `^5.11.1` (última v5 estable) porque BullMQ lo declara como peer
  `>=5.0.0` y v6 es muy reciente. `pnpm-workspace.yaml` **no** incluye
  `services/*` → hay que agregarlo para que `services/worker` sea paquete de
  turbo.
- **L4** (2026-10-31) — Convención de tests con dependencia externa: el repo ya
  la tiene (`packages/db`, `packages/alerts`): suite gated por env
  (`const suite = X ? describe : describe.skip`) + config de integración
  aparte + job de CI con service container. `packages/jobs` la replica: unit
  tests herméticos en `test`, integración contra Redis real en
  `test:integration`, y el job `test-integration` de CI levanta Redis.
- **L5** (2026-10-31) — Decisión de diseño: la idempotencia por ventana de S7 se
  implementa con `upsertJobScheduler` (id de scheduler estable → el upsert es
  idempotente por construcción y BullMQ entrega cada job a un único worker) en
  vez de `jobId` por ventana, que ya no es la primitiva de BullMQ v6 para
  recurrentes. El `jobId` estable por ventana se reserva para los jobs
  one-shot de ingesta (`ingest-drain:<ingestId>`), donde sí aporta dedupe real.
- **L6** (2026-10-31) — API de BullMQ v6 verificada contra el paquete
  instalado (`node_modules/bullmq@6.5.3`), no contra la memoria:
  - `jobId` con `:` es rechazado (`Custom Id cannot contain :`), y tampoco
    el nombre de la cola. Por eso los ids usan `-` y no el `:` que sugería el
    ejemplo original del diseño.
  - `JobSchedulerTemplateOptions = Omit<JobsOptions, 'jobId' | 'repeat' |
    'delay' | 'deduplication'>`: un job programado no puede llevar `jobId`
    propio ni delay propio.
  - `Queue<DataTypeOrJob, …>` deriva el nombre de job aceptado de
    `ExtractNameType<DataTypeOrJob, Default>`. Con un payload genérico esa
    derivación queda diferida y TypeScript la rechaza incluso como anotación
    de tipo dentro de una interfaz. Por eso `JobQueue` usa la unión concreta
    de payloads y el acople nombre↔payload queda en `enqueueJob`, que es
    donde el llamador lo ve. `packages/jobs/src/queue.ts` lo documenta.
- **L7** (2026-10-31) — `REDIS_URL` y `BACKEND_MODE` no pudieron escribirse en
  `.env.example`: el sandbox bloquea esa ruta por política, incluso con
  autorización explícita del usuario. Se documentaron en
  `docs/demo-env-template.md` (template no sensible) y en `docs/worker.md`, que
  deja el snippet exacto pendiente de agregar a `.env.example`.
- **L8** (2026-10-31) — El servicio `worker` va detrás de un profile de
  compose (`--profile worker`). La única combinación dañina del diseño es
  `BACKEND_MODE=embedded` **con** el worker desplegado: la web correría sus
  loops y el worker correría los suyos, con doble polling a la NMS y doble
  bind del socket UDP. Un profile hace que esa combinación exija una acción
  explícita.
- **L9** (2026-10-31) — Estrategia de entrega (slices de commit). La feature
  se entrega en commits revisables, cada uno verde por sí solo:
  1. `docs(odd)` — este plan y su mirror (commit `c5fac53`).
  2. `feat(jobs)` — vocabulario tipado de la cola (nombres, payloads, ids de
     ventana, `BACKEND_MODE`) + sus tests unitarios.
  3. `feat(jobs)` — runtime productor/consumidor (BullMQ) + tests de
     integración contra Redis real.
  4. `feat(worker)` — servidor de salud y métricas del worker + sus tests.
  5. `feat(worker)` — arranque del proceso (entrypoint, workers, registro de
     handlers).
  6. `chore(infra)` — Redis y worker en el compose, CI con Redis, y
     documentación de `BACKEND_MODE`.

  El límite de slice del harness se registra acá porque el plan completo
  supera el corte de ~400 líneas: cada commit se mantiene por debajo con
  tests y documentación al lado del comportamiento.
- **L10** (2026-10-31) — Fase 3: el obstáculo real no es la cola, es que el
  código del loop vive en `apps/web` y el worker no puede importar de una app
  Next. Dos unidades se mudan a packages, sin cambiar una línea de lógica:
  - `buildConnectorFromConnection` → `packages/connectors/factory`
    (`@ftth-copilot/connectors-factory`). No puede vivir en `connectors-core`:
    los tres connectors implementados dependen de `core`, así que la fábrica
    ahí invertiría la dependencia.
  - `runScheduledPoll` / `runScheduledFirmwareAudit` / `runScheduledFecCollection`,
    los helpers de lock y el registro de health → `packages/scheduler`
    (`@ftth-copilot/scheduler`).
  La web conserva su API pública re-exportando desde los packages: ningún call
  site del web cambia, y el worker importa los packages (S14).
- **L11** (2026-10-31) — Quién agenda el loop recurrente: el WORKER, no la
  web. S4 exige que el deployable web "no polea, ni audita, ni bindea UDP, ni
  programa nada", así que la web no crea schedules; el worker los registra al
  arrancar con `upsertJobScheduler` (idempotente por `schedulerId`) y encola
  el primer tick al instante, para no perder el warm-up de 5 s que hoy hace
  el loop en proceso. Esto resuelve la tensión entre la redacción de T6
  ("convertir `startPollingLoop` en productor de jobs repetibles") y S4: el
  loop deja de ser un `setInterval` y pasa a ser un job; quién lo agenda lo
  decide el flag, no la forma del código.
- **L12** (2026-10-31) — T8 mueve SOLO los tres loops recurrentes. Los
  receptores de syslog y SNMP siguen en la web hasta T9/T10: el worker todavía
  no los recibe, y sacarlos antes dejaría la ingesta de syslog sin destino
  (traps y syslog no se pueden perder — regla de dominio).
- **L13** (2026-10-31) — Comportamiento REAL del Job Scheduler de BullMQ
  6.5.3, medido contra Redis y no asumido (esto corrigió un defecto real de
  la primera implementación de T6):
  - Sin `startDate`, el scheduler `every` produce su primer job **de
    inmediato** (`waiting: 1, delay: 0` tras el upsert). El one-shot del
    primer tick que se había implementado encima producía **dos polls en
    cada arranque**.
  - `startDate` sí difiere el primer tick, pero el Lua lo lee con `tonumber`:
    hay que pasar **milisegundos epoch**, no un `Date` (un `Date` serializa a
    string, `tonumber` devuelve nil y el tick sale inmediato igual). Medido
    con valor numérico: `delay: 4998` para un arranque en +5 s.
  - `offset` no sirve para diferir el primer tick: alinea la grilla
    (`floor(now/every)*every + offset`), no retrasa el arranque.
  - La cadencia es estable y no deriva: la iteración siguiente es
    `prevMillis + every`. Medido: ticks a 4 ms, 5050 ms y 10059 ms con
    `every: 5000`.
  - El re-upsert **no** resetea la grilla: una segunda réplica que registra el
    mismo schedule no produce un tick extra (medido: tras el re-upsert queda
    un job pendiente y el consumo no cambia). Esto es lo que sostiene S7 sin
    necesitar un `jobId` por ventana.
  Corrección aplicada: se eliminó el one-shot del primer tick y el schedule
  arranca en `now + WARMUP_MS` (5 s), que reproduce el warm-up del loop en
  proceso con un único tick.
- **L14** (2026-10-31) — El handler de cada loop llama a la unidad ejecutable
  a través de `tryStart`, igual que el loop en proceso: se conservan el
  single-flight, el lock consultivo y el registro de health, y el error se
  traga como antes. Consecuencia: el `attempts: 3` de la cola es una red de
  seguridad (un error de cableado sí se reintenta), no el mecanismo de retry
  de los loops. El retry con backoff y el dead-letter llegan con la ingesta
  (T9-T11), que es donde la regla de dominio los exige.

- **L15** (2026-10-31) — T9 (syslog al worker) y las tres trampas de la
  infraestructura, medidas y no asumidas:
  - **IP de origen.** Medido en Docker 29.9.2: en una red definida por
    usuario — que es lo que usa compose — Docker levanta `docker-proxy` para
    el puerto UDP publicado, y el proxy reescribe la IP de origen al gateway
    del bridge. El receptor de syslog atribuye por la IP del cuerpo del
    mensaje y cae al `rinfo.address` cuando el cuerpo no trae una, así que
    todas las OLT se verían como la misma fuente y los detectores de fuerza
    bruta volverían a fusionar ataques distintos (el bug que
    `packages/security/src/source-ip.ts` existe para evitar). En el bridge por
    defecto no hay proxy (DNAT) y la IP se preserva, pero ese bridge no da
    resolución de nombres de servicio. Decisión: el worker usa
    `network_mode: host`. Consecuencia: alcanza Postgres y Redis por los
    puertos publicados del host, y su servidor de salud queda en
    `WORKER_HOST=127.0.0.1` para no escuchar en las interfaces públicas.
    Verificación: `pnpm verify:syslog-source-ip` manda un datagrama **sin IP
    en el cuerpo** (el único camino que depende de la IP de origen) y
    comprueba que el evento guardado lleva la dirección real.
  - **Spool en volumen.** El spool debe vivir en un volumen persistente: en
    el filesystem del contenedor, un reinicio borraría justo los eventos que
    se bufferingaron y todavía no se escribieron en Postgres. El worker
    monta `spool_data` y apunta `EVENT_SPOOL_DIR` ahí.
  - **Nunca los dos a la vez.** En modo worker la web no bindea el socket de
    syslog (el kernel entrega cada datagrama a un solo socket) ni publica el
    puerto: el mapeo `5514` sale del servicio `app` en el mismo commit que el
    selector de `instrumentation.ts`.
- **L16** (2026-10-31) — T9 incluye el handler del job de drenado, aunque el
  plan lo ubicaba en T10: un job encolado sin consumidor se acumularía en la
  cola sin efecto. T10 queda con el receptor SNMP y el drainer en proceso
  como última etapa.
- **L17** (2026-10-31) — Dos bloqueantes reportados por la revisión de las
  Fases 1-2 y T9, y lo que se aprendió al arreglarlos:
  - **Redis abierto a internet.** El compose lo publicaba en todas las
    interfaces y sin contraseña; los puertos publicados por Docker no pasan
    por el firewall del host. Ahora se publica solo en `127.0.0.1`, arranca
    con `--requirepass` y `REDIS_PASSWORD` es obligatoria (el compose falla
    cerrado si falta), con `REDIS_URL` construida a partir de ella en un
    único lugar.
  - **Productor que colgaba.** Medido: con el retry por defecto de ioredis,
    un productor con Redis inalcanzable (o con la contraseña mal) se quedaba
    esperando en vez de fallar. Ahora el productor tiene
    `maxRetriesPerRequest: 3` y falla.
  - **Spool compartido.** La web y el worker montaban el mismo volumen y el
    spool es un solo `events.jsonl` con un solo `events.offset`: dos
    procesos avanzarían el mismo offset y cualquiera podría rotar el archivo
    mientras el otro escribía. Ahora cada proceso tiene su subdirectorio
    (`spool/web`, `spool/worker`) y el spool **rechaza** un directorio que ya
    tiene otro proceso vivo, en vez de corromperlo en silencio.
- **L18** (2026-10-31) — El guard de exclusión del spool necesitó dos
  correcciones que solo aparecieron corriendo el worker en Docker:
  - **El pid no es identidad.** En un contenedor el proceso es siempre PID 1,
    así que tras un reinicio `kill(pid, 0)` decía "vivo" y el lock viejo
    bloqueaba el directorio para siempre: todos los drains fallaban con
    "already owned by process 1". Ahora el lock registra la **identidad del
    proceso** (`startTicks` de `/proc/<pid>/stat` campo 22 + `boot_id` del
    kernel) y compara: mismo pid con distinto start time = pid reciclado =
    lock rancio. En plataformas sin `/proc` cae a `kill(pid, 0)`.
  - **Formato versionado.** Un lock sin identidad no se puede verificar.
    Lleva `v: 2`; sin `v` se reclama con un warning (el guard y la identidad
    viajan juntos, así que un lock sin versión es de una versión previa). Un
    `readOwner` que no copiaba el campo `v` hacía que **todo** lock se viera
    como legacy y se reclamara: los tests de exclusión lo detectaron.
- **L19** (2026-10-31) — Hallazgo para T11 (no se arregla acá, es del código
  movido): un `connectionId` inválido en `SNMP_SENDER_REGISTRY_JSON` hace
  fallar el drenado con un FK constraint, y como el drenado **se detiene en
  el primer lote fallido**, ese evento bloquea a todos los siguientes —
  incluidos los de senders válidos — hasta que la causa se arregle. Medido:
  el backlog volvió a 0 solo cuando la fila referenciada existió. Es la
  contrapartida de "retry rápido no, para no mandar eventos vivos al
  dead-letter"; una política de dead-letter por evento (no por lote) es el
  candidato natural para T11.
- **L20** (2026-10-31) — T11: el dead-letter del spool pasa a ser **por
  evento y solo para fallos permanentes**. El defecto que tenía: al pasar un
  umbral de lotes fallidos se mandaba **el lote entero** al dead-letter, así
  que (a) una caída de Postgres de unos minutos habría perdido el backlog
  completo — lo contrario de durable — y (b) un solo evento inválido quedaba
  primero en la cola y hacía fallar a todos los siguientes, incluidos los de
  remitentes sanos. La política ahora es:
  - **Pasajero** (store no disponible o clasificación no concluyente): nunca
    va al dead-letter. Los eventos se quedan en disco y se reintentan. **Todo
    lo no reconocido es pasajero**: equivocarse hacia el retry solo retrasa la
    escritura; equivocarse hacia el dead-letter la pierde.
  - **Permanente** (Prisma `P2000/P2003/P2005/P2006/P2023/P2025`,
    `PrismaClientValidationError`, SQLSTATE `22*`/`23*`/`42*`): el lote se
    reintenta **evento por evento**, mandando al dead-letter solo los que
    fallan por ese motivo, y se sigue con los demás. Si en el medio aparece un
    error pasajero, se corta y el resto queda en disco.
  La cuarentena por umbral desapareció junto con su opción
  (`maxConsecutiveFailures`), que dejó de significar algo.
- **L21** (2026-10-31) — Dos datos medidos que cambiaron decisiones de
  infraestructura en los hallazgos de la revisión:
  - Con Docker 29.9.2 **dos contenedores distintos reportan el mismo id de
    namespace de pids** (`pid:[4026534096]`), así que el namespace solo no
    distingue contenedores. La identidad del candado exige namespace **y**
    hostname; con uno solo, dos contenedores con el mismo directorio se
    confundían con el mismo proceso.
  - `redis-cli ping` sin autenticar responde `NOAUTH` y **sale con código 0**:
    el healthcheck reportaba sano un Redis que nadie podía usar.
- **L22** (2026-10-31) — T11 se hizo inline: el subagente de escritura falló
  sin dejar cambios parciales (se reporta como no disponible, no se reintenta).
- **L23** (2026-10-31) — Dos ajustes finales al dead-letter, de la revisión de
  T11. El drenado pasa a resolverse en **dos fases**: como las escrituras son
  idempotentes (el `ingestId` único absorbe un duplicado), primero se prueba
  todo el lote sin comitear nada y recién con el panorama completo se decide.
  Sin eso no se distingue "este evento está roto" de "la base todavía no está
  lista", y confundirlas es lo que mandaba el backlog entero al dead-letter.
  - **Fallo compartido.** Si nada se guardó y todos fallaron con el mismo
    código, el problema es de la base o del código (una migración que no
    corrió: `42P01`/`42703`; un permiso faltante: `42501`; una columna
    obligatoria nueva: `23502`), no de los eventos. No se manda nada al
    dead-letter, el lote entero queda en disco y se alerta
    (`onSharedFailure` → línea `ALERT` en el log del worker).
  - **Error no reconocido.** Antes se reintentaba para siempre, así que un
    evento con un error que nadie clasificó (un código nuevo de Prisma, un
    `TypeError` al mapear un payload) frenaba a todos los de atrás — el mismo
    bloqueo de L19. Ahora, si el mismo evento falla K veces (5 por defecto) con
    un error no reconocido **mientras otros se guardan**, va al dead-letter con
    motivo `unclassified-exhausted`. Combinado con la regla anterior, si todos
    fallan nunca va nada al dead-letter.
  Consecuencia de diseño aceptada: en un lote que falla se escriben dos veces
  los eventos que sí se pueden guardar (lote primero, evento por evento
  después). Es idempotente, así que cuesta una escritura repetida, no datos.
- **L24** (2026-10-31) — La regla de "fallo compartido" miraba solo el lote, y
  eso reintroducía el bloqueo de L19 en su forma más probable: una OLT con un
  `connectionId` inválido en `SNMP_SENDER_REGISTRY_JSON` manda 250+ traps
  seguidos en una tormenta de LOS, el lote queda 100% envenenado con el mismo
  código de foreign key, la regla lo lee como "la base no está lista" y no
  manda nada al dead-letter; el lote siguiente es idéntico, y todo lo que venga
  de cualquier otra OLT queda trabado para siempre.
  Arreglo: los permanentes se separan por **alcance**.
  - `scope: 'event'` — el dato de ese evento no entra en el esquema
    (`P2000/P2003/P2005/P2006/P2023/P2025`, `PrismaClientValidationError`,
    SQLSTATE `22*`, `23503`/`23505`/`23514`). Es de ese evento por naturaleza y
    va al dead-letter **aunque fallen todos juntos**.
  - `scope: 'store'` — el esquema o la configuración de la base (`P2021/P2022`,
    SQLSTATE `42*`, `23502`, y los transitorios). Es el único cubo al que se le
    aplica la regla de no perder nada cuando falla todo junto.
  - `scope: 'unclassified'` — nadie sabe; también entra en la regla.
  Test: 300 traps con FK inválida seguidos de eventos válidos → los 300 al
  dead-letter y los válidos guardados.
- **L25** (2026-10-31) — Se agrega S19/T18 (Fase 6): sin un replay, el
  dead-letter guarda los datos pero no los devuelve, así que en la práctica es
  pérdida. Cuando el operador corrige el registro de la OLT, los traps tienen
  que poder volver, y el `ingestId` único hace que el replay sea idempotente.
- **L26** (2026-10-31) — T12, inventario de las 61 rutas de `app/api/**`. El
  plan suponía que varias rutas disparaban trabajo de fondo inline; el código
  no lo confirma. Clasificadas por lo que realmente hacen:
  - **Lectura con datos ya persistidos** (la mayoría): no hay nada que
    encolar.
  - **Lectura que va a la NMS en el momento**: `dashboard` (GET con
    `getNetworkOverview`/`listOlts`/`listOnus`), `alerts` y `chat` sólo
    construyen el conector (descifrar + instanciar, sin red). El `dashboard`
    no es trabajo de fondo sino una lectura que el usuario espera: sacarlo de
    la ruta es leer el estado que el poller ya persiste, no encolar.
  - **Acción interactiva**: `connectors/[id]/test` (el usuario pide el ping y
    espera la respuesta) y `chat` (las tools del agente llaman a la NMS dentro
    de la conversación). Deben seguir respondiendo en el momento.
  - **Trabajo de fondo inline, candidato real a T12**: `incidents/[id]/investigate`.
    Corre `runInvestigationPipeline` en el proceso web con un `Promise.race`
    contra 8 s; si se pasa, devuelve **202 "pending"** y el pipeline sigue
    corriendo como promesa suelta — sin retry, sin durabilidad, y se muere con
    el proceso. Es exactamente el caso de T12, y se puede arreglar **sin
    cambiar el contrato**: el 202 ya existe, sólo cambia quién ejecuta el
    pipeline después del presupuesto.
  - **Candidato blando**: `maintenance-windows/[id]/reevaluate` recorre todos
    los incidentes activos con escrituras y notificaciones en el request.
  Bloqueante para encolar `investigate`: `runInvestigationPipeline` vive en
  `apps/web/lib/investigations/` y el worker no puede importar de la app; hay
  que mudarlo a un package, igual que se hizo con el scheduler y el ingest.
- **L27** (2026-10-31) — Alcance de T12 decidido: **sólo** `investigate`.
  `reevaluate` queda afuera (cambia lo que recibe el cliente para ganar poco) y
  `dashboard` leyendo estado persistido también (toca lo que ve el NOC en el
  primer minuto, merece su propio plan ODD).
- **L28** (2026-10-31) — Al revisar `investigate` para confirmar el alcance
  apareció un bug que ya está en `main`, más grave que el del inventario:
  1. Si el pipeline pasa los 8 s, la ruta devuelve 202 pero **el resultado se
     tira**: `persistInvestigationVersion` sólo se llama en el camino rápido.
     La promesa sigue corriendo (y gastando LLM) y nadie guarda nada.
  2. La investigación queda `pending` para siempre: ningún camino la pasa a
     `failed` ni a `expired`.
  3. No se puede reintentar: el chequeo de "hay un pending" corre antes que el
     de refresh, así que cada intento nuevo devuelve 202 eternamente.
  4. Cualquier error del pipeline que no sea `P2002` se relanza y también deja
     el run en `pending`.
  Consecuencia: cualquier investigación de más de 8 s, o que falle, inutiliza
  el botón "investigar" de ese incidente sin vuelta atrás. Por eso T12 no es un
  refactor: es un arreglo, y suma la spec S20 (todo run termina en un estado
  final; el barrido de `pending` viejos es necesario aunque no hubiera bug,
  porque en producción ya puede haber filas trabadas).
- **L29** (2026-10-31) — Unidad **7b**: dos bugs de carrera en el cierre de
  investigaciones, encontrados en la revisión de la unidad 7. La causa común:
  `InvestigationRun` es **una sola fila por incidente** y se reutiliza entre
  versiones, así que `requestedAt` (que sólo se escribe al crear) y los updates
  por `(tenantId, runId)` no sirven como control de concurrencia.
  1. El barrido expiraba un run **que estaba corriendo**: un incidente
     investigado hace días y relanzado ahora queda `pending` con un
     `requestedAt` viejo, el barrido lo expira en plena ejecución y el usuario
     puede lanzar otro → dos pipelines en paralelo (viola S20).
  2. Un intento viejo **pisaba el estado del nuevo**: si v1 termina tarde marca
     `ready` (o `failed`) mientras corre v2.
  Arreglo:
  - Migración **aditiva** en `InvestigationRun`: `currentVersionId String?` (el
    intento vigente) y `attemptStartedAt DateTime?` (su arranque).
  - La ruta setea ambas cada vez que pone el run en `pending`, al crear y al
    relanzar.
  - El barrido filtra por `attemptStartedAt`. **Es nullable**, así que tiene que
    ver también las filas `pending` que ya existen (backfill
    `attemptStartedAt = updatedAt` en la migración, u `OR` con `requestedAt`
    cuando es null); si no, las trabadas de producción quedan trabadas para
    siempre.
  - `completeInvestigation` / `failInvestigation` cambian el estado sólo con
    `updateMany where { tenantId, runId, status: 'pending', currentVersionId }`.
    Si el intento ya no es el vigente, la versión puede quedar como historia
    pero el estado del run no se toca.
  - `completeInvestigation` en una `$transaction` (versión + `AgentActionLog` +
    estado): si el proceso muere a la mitad, hoy queda la versión guardada y el
    run `pending`.
  - `failInvestigation` registra `AgentActionLog` con
    `toolName: '__investigation_failed__'` y el motivo, en vez de dejarlo sólo
    en la consola.
  Momento del deploy, aceptado: un pipeline corriendo en modo `embedded` al
  momento de la migración no va a poder cerrar (su fila no tiene
  `currentVersionId`) y va a terminar expirando. Con el código actual ese
  resultado se perdía igual.
  Tests: (a) un run viejo relanzado **no** se expira mientras corre; (b) un
  intento viejo que termina tarde **no** pone `ready` al run del intento nuevo;
  (c) uno que falla tarde **no** pone `failed`; (d) una fila `pending` vieja
  **sin** `attemptStartedAt` se expira.
- **L30** (2026-10-31) — Unidad 7b **hecha**. Migración
  `20261031180000_investigation_attempt` (aditiva: `currentVersionId`,
  `attemptStartedAt`, índice `(status, attemptStartedAt)`, backfill de
  `attemptStartedAt = updatedAt` para las filas `pending` existentes; sin drift
  contra el schema). Hallazgo al implementar: `persistInvestigationVersion`
  (packages/db) **también** ponía `ready` sin condición dentro de su propia
  transacción, así que el bug 2 vivía en dos lugares. Se separó
  `insertInvestigationVersion(tx, …)`, que inserta sin tocar el estado, y
  `completeInvestigation` hace versión + `AgentActionLog` + transición
  condicional en una sola `$transaction`. `beginInvestigationAttempt` es el
  único punto que pone un run en `pending` con su intento. El barrido usa
  `attemptStartedAt` con fallback a `requestedAt` cuando es nulo.
  Evidencia: integración contra Postgres real 12/12; prueba de mutación — sin
  la condición de `currentVersionId` fallan (b), (c) y el de "expirado no vuelve
  a ready"; con el barrido por `requestedAt` falla (a); sin el fallback falla
  (d). packages/db integración 15/15; `turbo --force` 67/67, 0 en caché.
- **L31** (2026-10-31) — Unidades **8-11 hechas** (T12 cerrada).
  - **8** (d376289): cola `ftth-investigation`, job id
    `investigation-<runId>-<versionId>`, `executeInvestigationAttempt` en
    `@ftth-copilot/investigations` (re-verifica que el incidente sea del tenant
    del payload, saltea sin correr el pipeline un intento que ya no es el
    vigente, reintenta solo errores pasajeros — Prisma P1xxx/P2024/P2028,
    sockets, HTTP 429/5xx — con tope 3, y si no, `failInvestigation`). Barrido
    `ftth-investigation-sweep` como loop del worker sin flag (red de seguridad,
    como el drenado).
  - **Hallazgo nuevo**: la unicidad de `InvestigationRun` es
    `(tenantId, runId)`, no por incidente. Dos pedidos simultáneos veían los dos
    "no hay run", creaban dos filas y corrían dos pipelines.
    `claimInvestigationAttempt` decide bajo `pg_advisory_xact_lock` por
    `(tenantId, incidentId)`, sin cambio de schema (un índice único por
    incidente fallaría con duplicados existentes). Test con 4 pedidos
    simultáneos → 1 intento, 1 fila; con la ventana ensanchada por un punto de
    prueba, **sin** el lock el test falla (verificado).
  - **9**: la ruta usa el claim. Modo `worker`: encola y espera el resultado
    consultando Postgres hasta el presupuesto (201/202/500); si no puede
    encolar, marca el intento `failed` y responde 503. Modo `embedded`: corre el
    pipeline y engancha el cierre a ESA promesa (`.then(complete)` /
    `.catch(fail)`); pasado el presupuesto responde 202 y la misma promesa cierra
    el intento, mantenida viva con `after()` de Next. Nunca se lanza dos veces.
    Prueba de mutación: relanzar el pipeline tras el 202 rompe 2 tests; correr
    el pipeline en modo worker rompe 1.
  - **10**: barrido también en modo `embedded` (intervalo en proceso,
    `unref`), `INVESTIGATION_PENDING_TTL_MS` (15 min) e
    `INVESTIGATION_SWEEP_INTERVAL_MS` (60 s) en `.env.example` y `turbo.json`.
  - **11**: tests — >presupuesto termina con la versión guardada (misma
    promesa); error → `failed` y reintentable; pending viejo → `expired`;
    pedidos simultáneos → una ejecución; tenant ajeno rechazado sin correr el
    pipeline; espera acotada (`awaitAttemptOutcome`).
  Evidencia: `turbo --force` 67/67, 0 en caché (web 565, worker 65, jobs 36);
  integración real: investigations 30, db 15, jobs 6, worker 15 (Postgres +
  Redis levantados).
- **L32** (2026-11-02) — T18 hecha: comando `replay:dead-letter`
  (`scripts/replay-dead-letter.ts`, sobre
  `packages/ingest/src/dead-letter-replay.ts`).
  - Devuelve al spool los eventos del `events.dlq.jsonl` **conservando su
    `ingestId`**. Eso es lo que hace el replay idempotente: el `ingestId` es
    la clave de idempotencia del insert (`DeviceEvent.ingestId` es único y
    `ingestEvents` usa `createMany` con `skipDuplicates`), así que un evento
    que ya se guardó vuelve con el mismo id y la base lo absorbe en vez de
    duplicarlo. Con un id nuevo, el replay crearía una fila por evento.
    Por eso el spool tiene un método nuevo (`requeue`) que escribe una
    entrada conservando su id: `append` genera uno nuevo.
  - Lo que reprocesó **sale** del archivo del dead-letter: el spool es
    durable, así que una vez que el evento está ahí, consumir la línea no lo
    pierde. Con `--keep` queda.
  - `--dry-run` no abre el spool: funciona con el worker corriendo, que es
    el dueño del directorio. Para reprocesar de verdad hay que parar el
    worker (dos procesos sobre el mismo offset perderían o duplicarían
    eventos); el error lo dice.
  - `--tenant` filtra por el `tenantId` del payload; las líneas ilegibles se
    cuentan y se dejan en el archivo (nadie las va a recuperar, pero borrar
    evidencia sin que nadie lo decida tampoco).
  - El conteo de duplicados (los que la base ya tenía) es **opt-in**
    (`--count-duplicates`): necesita `DATABASE_URL` y, con la base caída,
    su ruido no debe tapar el replay, que es justamente lo que hace falta
    cuando la base está caída.
  - Evidencia: `packages/ingest` 29/29 (8 del replay); end-to-end con un
    dead-letter de prueba (3 entradas: 2 recuperables y 1 ilegible) — el
    filtro por tenant recuperó 1 y dejó 2, el spool quedó con los
    `ingestId` originales y el archivo conservó la línea ilegible.
- **L33** (2026-11-02) — Unidades **T16 y T17 hechas** (observabilidad de la cola
  y topología documentada).
  - **La profundidad de la cola se lee del lado productor.** Un `Worker` de BullMQ
    no puede contar los jobs que siguen esperando: hace falta un `Queue`, que es
    el mismo objeto que usa la web para encolar. `packages/jobs` expone
    `readQueueDepth`, que recibe el contador como argumento (el test no
    necesita Redis) y devuelve las colas que **no** se pudieron leer aparte: una
    cola incountable queda ausente del reporte, en cero, y un
    `ftth_copilot_worker_queue_depth_readable` dice que ese cero es "no sé" y no
    "está vacía".
  - **BullMQ 6 no expone la latencia de los jobs** (`getJobLatencies` era de v5):
    el worker la mide con `processedOn` y `finishedOn` del job, y la expone como
    histograma de Prometheus. Los buckets son acumulativos y un job más lento
    que el último bucket pertenece al `+Inf`, no al último bucket finito.
  - **El retry se decide con la misma regla de BullMQ**: `attemptsMade <
    attempts` y el error no es `UnrecoverableError`. `attemptsMade` ya viene
    incrementado en el evento `failed`, porque BullMQ lo suma antes de
    emitirlo.
  - **VictoriaMetrics single-node lee UN solo `-promscrape.config`**: la última
    bandera gana (medido contra v1.153.0), así que el job del worker es un
    FRAGMENTO que el entrypoint concatena al fichero de la web, no un segundo
    fichero. Y solo se concatena cuando hay un target: un despliegue sin worker
    no puede mostrar un target caído para siempre.
  - **El worker corre en la red del host y el contenedor de VictoriaMetrics en
    la del compose**: para que se alcancen hace falta una dirección del host
    (no `127.0.0.1`), y el firewall del host puede cortar ese tráfico. Medido
    en esta máquina: el contenedor no llega al puerto publicado del host, y sí
    al servicio por nombre. Por eso el target es opt-in y hay que documentar la
    receta.
  - **El compose de demo apuntaba al worker a Redis por nombre de servicio**
    (`redis:6379`) cuando el worker corre en la red del host, donde ese nombre
    no resuelve: el worker no podía arrancar. Corregido a `127.0.0.1`.
  Evidencia: `turbo --force` 70/70; scripts 87/87; docs-test 365 bloques, 0
  errores; `check:observability` OK (23 reglas, 40 métricas). Verificado contra
  Redis real y contra VictoriaMetrics real: 17 familias `ftth_copilot_worker_*`
  en la TSDB, y las 8 alertas del grupo `ftth-copilot-worker` evaluando (las
  de fallos y retries en `pending` porque el worker de verificación realmente
  falló jobs). El check nuevo (`pnpm check:observability`) ata cada alerta con
  las métricas que alguien exporta: una alerta sobre una métrica inexistente
  queda INACTIVE para siempre y el operador cree que tiene cobertura.
- **L34** (2026-11-02) — **Entorno de staging decidido** (T14 sigue pendiente de
  ejecutarse; lo decidido es *dónde* y *con qué*).
  - **Dónde: un VPS Linux** (Ubuntu 24.04 LTS, Docker Engine + Compose v2, IPv4
    público). Descartados: **Vercel** (no hay worker de larga vida, ni UDP, ni
    `network_mode: host`), **los PaaS con containers** (el worker necesita la red
    del host para conservar la IP de origen del datagrama syslog; el proxy de
    usuario de Docker para UDP la reescribe a la gateway del bridge y todos los
    OLTs parecerían el mismo origen) y **el servidor local** (el firewall del
    host bloquea contenedor→host, que es el camino que usa el worker para
    llegar a Redis y Postgres por `127.0.0.1`).
  - **Redis: self-hosted en el mismo VPS** (`redis:8.10.2-alpine`, con
    password, AOF y puerto sólo en loopback). Es lo que ya hace el compose de
    producción. Una Redis gestionada obligaría a cambiar la URL, salir a
    internet en cada comando y sumar TLS: para un entorno de pruebas sale más
    caro que el VPS entero.
  - **Postgres: self-hosted en el mismo VPS** (`postgres:16-alpine`, puerto sólo
    en loopback, backup diario). El staging no es un sistema de registro: sus
    datos son desechables. Una base gestionada agrega un salto de red por
    consulta y una dependencia externa, y el worker necesitaría TLS.
  - **Una sola Redis para las dos cosas** que la usan: la cola de BullMQ y el
    rate limiter global de las rutas que mutan estado (SEC-008, PR #351). La
    misma `REDIS_URL` las alcanza a las dos.
  - **La web escala a 2 réplicas con Caddy delante**: `app` no publica puerto
    (si lo publicara, `--scale app=2` no podría arrancar) y
    `reverse_proxy app:3001` balancea por round-robin. **No hace falta sticky
    session**: la sesión es un JWT validado contra la fila `Session` de
    Postgres y el CSRF es double-submit, así que no hay estado en el proceso.
  - **El spool no se pisa entre las dos réplicas**: en modo `worker` la web no
    arranca los receptores ni el drainer, así que no escribe en el spool (que es
    del worker, y el worker es uno solo).
  - Archivos: `docker-compose.staging.yml` (override del de producción),
    `Caddyfile.staging`, `.env.staging.example` y
    `docs/how-to/desplegar-en-staging.md`.
- **L35** (2026-11-03) — **T14 validada en `vps-casa`** (el despliegue en sí y
  lo que encontró).
  - **Los seis planos, con evidencia de la base y no sólo de los logs**:
    - *Poll*: el tick del worker consultó el NMS y guardó 4 muestras
      (`metric_samples`), 0 errores por conexión.
    - *Firmware* y *FEC*: sus jobs se ejecutaron (2 y 3 ciclos completados en
      la cola de BullMQ).
    - *Syslog*: un datagrama UDP al `5514` terminó en `device_events` con su
      `sourceIp` y su mensaje.
    - *SNMP*: un trap v2c al `1162` terminó en `device_events` normalizado
      (`link_down`, `OLT-MOCK-1`).
    - *Drenado*: el spool del worker quedó sin pendientes y los eventos
      llegaron a Postgres.
  - **Sin trabajo duplicado**: `ingestId` repetidos = 0, muestras con el
    mismo dispositivo+métrica+momento = 0, las cuatro colas con 0 jobs en
    espera, un solo worker consumiendo y dos réplicas de la web que no
    arrancan ningún loop (`Background loops and receivers run in the worker`
    en el log de instrumentación de las dos).
  - **Lo que el despliegue destapó** (todo con su propio PR):
    - `#363`: la imagen del worker no copiaba `packages/learning`, así que el
      worker **no arrancaba en ningún despliegue**, tampoco en producción.
    - `#364`: el registro de salud es process-local y Next.js empaqueta la
      instrumentación y los route handlers por separado, así que la web no
      podía ver los loops del worker: `/api/health` los lista ahora desde el
      snapshot que el worker publica en Redis.
    - `#365`: el buffer del receptor syslog se agrandaba antes del bind (y
      nunca crecía), el worker no decía que sus loops eran esperados (y un
      loop que no se espera no se vigila), y los receptores se contaban como
      loops muertos porque no tienen tick.
  - **Lo que queda abierto** (no se arregla acá, por ser un cambio del
    producer de jobs con riesgo de duplicar trabajo en la misma tarea que valida
    que no se duplique):
    - **El tick de calentamiento no ocurre tras un reinicio.** El
      `upsertJobScheduler` de BullMQ no reprograma un schedule que ya existe,
      así que el job que el log anuncia como `firstTickAt` (arranque + 5 s) no
      se produce: el primer tick real es el siguiente turno natural (poll 15
      min, FEC 1 h, firmware 24 h). El log afirma una hora que no se cumple.
    - **El registro de salud se vacía en cada reinicio**, así que el health
      queda degradado hasta que el loop de intervalo largo haya tickeado
      alguna vez. Es la misma causa que el punto anterior.
    - **El poll se traga los errores de construcción de conector**
      (`catch {}` sin log): si una conexión no se puede construir, no se polea
      y no se dice nada. El health decía "polling OK" mientras no poleaba nada.
    - **El staging necesita un NMS**: el seed crea una conexión SmartOLT sin
      `baseUrl`, que ningún loop puede usar. Para la prueba se levantó el mock
      NMS del propio repo (`smartoltMockResponse`) y se habilitaron las
      excepciones de la política SSRF (`NMS_ALLOW_HTTP`, `NMS_ALLOWED_PORTS`,
      `NMS_ALLOW_PRIVATE_NETWORKS`, `NMS_ALLOWED_HOSTS`).

- **L36** (2026-11-03) — **El health del worker después de un reinicio** (la
  primera mitad de lo que L35 dejó abierto).
  - **El tick de calentamiento ocurre de verdad.** El
    `upsertJobScheduler` de BullMQ no reprograma una rejilla que ya existe,
    así que el `firstTickAt` que el log anunciaba (arranque + 5 s) no se
    producía después de un reinicio: el primer tick real era el siguiente
    turno natural (poll 15 min, FEC 1 h, firmware 24 h). El worker compara
    ahora el próximo tick de la rejilla con el reloj y, cuando está lejos,
    fuerza un tick de calentamiento cinco segundos después del arranque.
  - **Sin duplicar trabajo.** El id de ese job sale de la ranura de la
    rejilla (`warmup-<scope>-<slot>`): dos workers que arrancan a la vez
    calculan el mismo id y BullMQ encola uno solo, y un reinicio dentro de
    la misma ranura no repite el calentamiento. El test de integración
    levanta dos registros a la vez contra un Redis real y cuenta un único
    tick de calentamiento por loop.
  - **El registro de salud ya no se vacía en cada reinicio.** El registro
    acepta el plazo del próximo tick (`nextRunAt`) y la cadencia
    (`intervalMs`) del loop, que son los que sabe el dueño de la rejilla y
    el registro no. Un loop que todavía no tickeó está *calentando* —con la
    hora de su próximo tick— y no degrada el sistema; uno cuyo tick
    esperado no llegó está *colgado*. `/api/health` publica el estado de
    cada servicio (`ok`, `warming`, `error`, `hung`, `inactive`).
  - **El poll ya no se traga los errores de construcción del conector.** Una
    conexión sin `baseUrl`, con credenciales que no descifran o con una URL
    que la política de SSRF rechaza no se puede consultar; antes el `catch {}`
    sin log lo saltaba y el health decía "polling OK" sin haber consultado
    nada. El fallo se levanta al final del ciclo, con el motivo y el id de
    la conexión, y queda como error del loop `polling`. Las conexiones que
    sí se pueden consultar se consultan igual.
  - **Lo que sigue abierto** (va en su propio PR, porque toca el entorno y
    no el código de los loops): el staging necesita un NMS de verdad —el
    seed crea una conexión SmartOLT sin `baseUrl`—, las excepciones de la
    política SSRF que el staging necesita hoy no están declaradas en
    `.env.staging.example` y la política de producción no las rechaza, y
    los `container_name` fijos de `docker-compose.prod.yml` impiden que
    producción y staging convivan en un mismo host.
||||||| parent of 273e388 (docs(odd): el staging reproducible y lo que queda para la revalidación)
- **L37** (2026-11-03) — **El staging quedó reproducible** (`#367`: el mock NMS
  como servicio del compose, las excepciones SSRF declaradas y acotadas, la
  convivencia de producción y staging en un mismo host, y la guía que levanta
  todo desde cero).
  - **El staging tiene un NMS declarado**: el compose declara el mock que ya
    está en el repo (`smartoltMockResponse`) detrás del profile `mock-nms`,
    servido por HTTP en `127.0.0.1:18080`, y el seed crea la conexión con esa
    URL (`DEMO_NMS_BASE_URL`). Sin URL base el conector no se puede construir:
    el poll no consultaba nada y el health decía "polling OK" sin polear.
  - **Las excepciones de la política SSRF están declaradas y acotadas**: viven
    en `.env.staging.example`, y el web y el worker se niegan a arrancar con
    ellas activadas cuando `NODE_ENV=production` y sin `DEPLOY_ENV=staging`.
  - **Producción y staging conviven en un host**: se fueron los `container_name`
    fijos (`ftth_prod_*`) del compose de producción y el staging declara su
    proyecto (`ftth-staging`).
  - **La guía levanta el stack de cero a arriba**, y una regla de CI ata la
    guía al compose para que no vuelva a quedar atrás.
  - **Lo que encontró la revisión independiente del PR** (todo corregido en el
    mismo PR, antes de que se mergee):
    - **El seed pisaba la conexión del operador**: tomaba cualquier conexión
      SmartOLT del tenant y le sobrescribía la `baseUrl` con el
      `DEMO_NMS_BASE_URL` del staging. Ahora la conexión del seed es la suya
      (la de su id) y las de otros no se tocan.
    - **Los puertos del staging se pisaban con los de producción** (Redis en
      el 6379, el health del worker en el 8081, syslog en el 5514 y SNMP en
      el 1162). La plantilla del staging trae puertos propios (5434, 6380,
      8082, 5515 y 1163) y una regla de CI lo verifica.
    - **La marca `DEPLOY_ENV=staging` no estaba atada a nada**: es lo único
      que permite las excepciones SSRF con `NODE_ENV=production`, así que si
      desaparecía de la plantilla el staging dejaba de levantar sin que el
      CI lo notara. Ahora hay una regla que la exige.
    - **La receta de la guía rompía un staging que ya estaba montado**
      (copiaba la plantilla encima y regeneraba los secretos). Ahora hay un
      camino de upgrade que sólo agrega las variables nuevas.
    - **El worker no tenía ninguna regla que lo atara** a la comprobación
      SSRF: ahora la hay (lee su `index.ts` y comprueba que la comprobación
      ocurre antes de que arranquen los workers).
  - **Lo que sigue abierto**:
    - **La revalidación de T14 en la VPS con la imagen nueva**: hace falta que
      `#366` (el health tras un reinicio y el tick de calentamiento) y este PR
      estén mergeados para poder desplegar. Después: reiniciar el worker,
      comprobar que el health **no** se degrada (estado `warming` con su
      `nextRunAt`), que hay **un** tick de calentamiento y que no hay ticks
      duplicados.
    - **El proyecto del compose del staging cambió de nombre** (`ftth-staging`):
      en `vps-casa` hay que bajar el stack viejo (`ftth-copilot-*`) antes de
      levantar el nuevo, o los dos stacks quedan con nombres distintos y el
      puerto `8080` queda tomado por el viejo. Los volúmenes también cambian
      de nombre (Compose los nombra con el proyecto), así que el stack nuevo
      ve una base vacía: es un staging, se vuelve a sembrar.
    - **El `.env.staging` de la VPS es anterior a este PR**: le faltan la
      marca `DEPLOY_ENV=staging`, las cuatro excepciones SSRF, las variables
      del mock NMS y los puertos nuevos. El camino está en la guía
      (`docs/how-to/desplegar-en-staging.md`, §3.2).
    - **`~/ftth-staging.sh` no levanta el profile `mock-nms`**: el mock es un
      servicio del compose detrás del profile, así que el script tiene que
      levantarlo (`--profile mock-nms up -d mock-nms`) o queda levantado a mano.
