# AGENTS.md — `@ftth-copilot/worker`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md) y el contrato operativo en [`docs/worker.md`](../../docs/worker.md).

## Qué es

El proceso de trabajo de fondo: consume las colas durables (BullMQ + Redis), es **el único dueño del
trabajo de fondo** —el poll, la auditoría de firmware, el barrido FEC, la fila del spool de ingesta y
el stream de eventos de SmartOLT viven acá— y publica su salud y sus métricas.

No tiene lógica de dominio: importa los paquetes que ya la tienen y sólo traduce un evento, un tick o
un trabajo de la cola en una llamada a ellos.

## Qué invariantes cuida

- **Un solo dueño.** Si un loop empieza a correr también en la web, hay dos pollers, dos barridos
  FEC y dos escrituras de la misma muestra. Los loops nacen acá.
- **La salud dice la verdad.** Cada loop que se enciende se registra en el registro de
  `@ftth-copilot/scheduler` (`markExpected`), y el worker lo publica en Redis
  (`ftth:worker:scheduler-health`) para que la web lo lea. Un loop apagado **no** se registra: un
  servicio que no existe no puede figurar como colgado.
- **Todo es tenant-aware.** Cada muestra, cada señal degradada y cada línea de log lleva el
  `tenantId` (y el `connectionId`) de la conexión que la produjo.
- **Las credenciales no se loguean.** Ni el `X-Token` de SmartOLT, ni el token de la URL del stream,
  ni el contenido descifrado de una API key.
- **Apagado por default.** Los loops nuevos entran detrás de una bandera (`SMARTOLT_EVENTS_ENABLED`)
  para que una instalación que no la pidió se comporte igual que antes.
- **El apagado es ordenado.** `SIGTERM`/`SIGINT` cortan los sockets, el publisher, los schedules y
  los streams antes de salir.

## Los loops y quién los enciende

| Loop | Dónde vive | Bandera | Intervalo |
|---|---|---|---|
| Poll de métricas | `@ftth-copilot/scheduler` (`runScheduledPoll`) | `METRICS_POLLER_ENABLED` | `METRICS_POLL_INTERVAL_MS` (15 min) |
| Auditoría de firmware | `@ftth-copilot/scheduler` | `FIRMWARE_AUDIT_ENABLED` | `FIRMWARE_AUDIT_INTERVAL_MS` (24 h) |
| Barrido FEC | `@ftth-copilot/scheduler` (`runScheduledFecCollection`) | `FEC_COLLECTION_ENABLED` | `FEC_COLLECTION_INTERVAL_MS` (1 h) |
| Drenaje del spool | `src/schedules.ts` | siempre (red de seguridad) | `INGEST_DRAIN_INTERVAL_MS` (30 s) |
| Barrido de investigaciones | `src/schedules.ts` | siempre (red de seguridad) | `INVESTIGATION_SWEEP_INTERVAL_MS` (60 s) |
| Snapshot de aprendizaje | `src/schedules.ts` | `LEARNING_SNAPSHOT_ENABLED` | `LEARNING_SNAPSHOT_INTERVAL_MS` (24 h) |
| Receptor syslog | `src/syslog.ts` | `SYSLOG_RECEIVER_ENABLED` + `SYSLOG_TENANT_ID` | socket UDP |
| Receptor SNMP | `src/snmp.ts` | `SNMP_RECEIVER_ENABLED` | socket UDP |
| **Stream de eventos SmartOLT** | `@ftth-copilot/scheduler` (`startSmartoltEventStreams`), arrancado por `src/events.ts` | `SMARTOLT_EVENTS_ENABLED` | un stream por conexión, reconexión con backoff |

## El stream de eventos de SmartOLT

- Un loop por conexión `SMARTOLT` en estado `connected`; tope de 15 streams por cuenta
  (`SMARTOLT_EVENT_MAX_STREAMS`, el tope del proveedor).
- Las muestras se guardan por **el mismo camino que el poll**: `onuEventPoints` arma `MetricPoint`s
  y `persistSamples` de `@ftth-copilot/analytics` los inserta. No hay tabla nueva.
- Las ONUs que el evento marca degradadas (estado LOS/Power fail, caída de señal de 2 dB o más,
  banda mala, recepción bajo -27 dBm) se anotan en el registro de `degraded-onus` del scheduler, que
  es lo que prioriza el barrido FEC.
- No hace detección: escribe muestras y el trabajo de detección programado las lee.
- **La liveness es de cada conexión.** El proveedor manda un `: ping` cada 25 s; si una conexión
  pasa `SMARTOLT_EVENT_LIVENESS_MS` (120 s) sin un solo frame, el watchdog corta ESE stream y el
  loop lo vuelve a abrir con backoff acotado (`SMARTOLT_EVENT_BACKOFF_INITIAL_MS` →
  `..._MAX_MS`). El ping de una conexión sana no tapa a la que dejó de mandar nada, y la salud
  publica el plazo de la conexión más próxima a vencer: el loop figura colgado sólo si una conexión
  pasó su propio plazo. La reconexión pide una URL nueva (gasta el presupuesto del endpoint) y no
  reenvía `Last-Event-ID`, porque el generador del cliente arranca de cero: lo que se perdió durante
  el corte lo cubre el poll programado, igual que después de un `resync`.
- **Sin conexiones vivas el loop queda inactivo, no colgado.** Con la bandera encendida y cero
  conexiones SmartOLT (o después de un final terminal), el loop se publica como `inactive` con el
  motivo en `lastError`: `inactive` es el estado que ya existe y que `/api/health` dibuja, y es
  preferible a un plazo sin dueño que reporte el loop como colgado para siempre.
- **`disabled` es terminal y una key rotada necesita un worker nuevo.** Si SmartOLT deshabilita o
  cambia la API key, esa conexión sale del stream y queda `inactive` con el motivo en `lastError`.
  El poll sigue cubriendo la conexión con la key vigente en el tick siguiente, pero el stream no
  vuelve hasta **reiniciar el worker**: la key se descifra al arrancar y rotarla en la base no
  alcanza. El detalle está en
  [`packages/connectors/smartolt/AGENTS.md`](../../packages/connectors/smartolt/AGENTS.md).
- **El apagado corta los sockets.** `stop()` aborta cada stream, el pedido de URL en vuelo y la
  espera entre reintentos, así que `SIGTERM` no espera 60 s de backoff antes de cerrar.

| Variable | Default | Qué hace |
|---|---|---|
| `SMARTOLT_EVENTS_ENABLED` | `false` | Enciende el loop. Apagado no abre sockets ni aparece en la salud |
| `SMARTOLT_EVENT_TYPES` | todos | Lista de tipos separados por coma (`onu.status_changed`, …) |
| `SMARTOLT_EVENT_LIVENESS_MS` | `120000` | Sin frames en este tiempo, el watchdog corta la conexión y la reconecta |
| `SMARTOLT_EVENT_MAX_STREAMS` | `15` | Tope de streams abiertos por cuenta |
| `SMARTOLT_EVENT_STREAM_ENDPOINT_PER_HOUR` | `60` | Pedidos de URL del stream por hora y por cuenta |
| `SMARTOLT_EVENT_BACKOFF_INITIAL_MS` | `1000` | Primera espera tras una falla |
| `SMARTOLT_EVENT_BACKOFF_MAX_MS` | `60000` | Tope de espera entre reintentos |
| `FEC_RATE_LIMIT_PER_HOUR` | `600` | Presupuesto del barrido FEC (deja 400 de las 1.000 de la cuenta para el resto) |
| `FEC_FAN_OUT_PER_CYCLE` | la parte del presupuesto del tick (600 con ticks de 1 h) | ONUs por tick del barrido FEC |

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/worker test
```

La suite es hermética: no necesita Redis. Los loops se prueban en `@ftth-copilot/scheduler` con las
fronteras (Prisma, el stream, la persistencia) inyectadas; acá se prueba el arranque, el apagado y la
publicación de la salud.

## Qué no tocar

- La forma del snapshot de salud (`WORKER_HEALTH_KEY`, `health-snapshot.ts`): lo lee la web.
- El contrato de la cola (`@ftth-copilot/jobs`): la web produce los mismos trabajos.
- `packages/db/prisma/migrations/`: superficie protegida.
