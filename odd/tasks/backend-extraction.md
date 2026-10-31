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
| T11 | S3, S16            | inline  | `T11` (este commit) | Tests de durabilidad end-to-end: con Redis caído, el spool retiene y reproduce al volver; at-least-once verificado con `ingestId`. |
| T12 | S5                | pending | pending | Inventariar las rutas `app/api/**` que hoy hacen trabajo de fondo inline y cambiarlas a `enqueue`, manteniendo el contrato de respuesta. |
| T13 | S5                | pending | pending | Tests de contrato: las respuestas de esas rutas no cambian de forma observable; el efecto ahora ocurre vía job. |
| T14 | S15               | pending | pending | Correr en staging con `BACKEND_MODE=worker` y validar: poll, firmware, FEC, syslog, SNMP y drenado funcionan, con web escalada a 2 réplicas sin duplicar trabajo. |
| T15 | S4, S6, S15        | pending | pending | Flip del default a `BACKEND_MODE=worker`; borrar el camino embedded de `instrumentation.ts` y el scheduler en proceso. |
| T16 | S18               | pending | pending | Observabilidad: exportar a VictoriaMetrics profundidad de cola, latencia de job, retries y dead-letters; panel/alertas mínimas. |
| T17 | S1, S17            | pending | pending | Docs: `README`/deploy actualizados con la nueva topología (web + worker + redis), diagrama y runbook de rollback. |

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
