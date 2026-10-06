# Event Ingest Durability

**Status**: In Progress
**Created**: 2026-10-05
**Scope**: PR 1 de 2 (syslog). SNMP queda para el PR siguiente.

## Problema

Requisito del dominio: **en un NOC no se pueden perder traps SNMP ni syslog
entrantes**. Hoy el codigo no lo cumple. Hay tres vias silenciosas de perdida en
`apps/web/lib/monitoring/syslog.ts`:

1. **`ingestEvent(...).catch(...)` descarta el evento de forma permanente.** Si
   falla la escritura a Postgres, el datagrama ya se consumio del socket y no
   queda en ningun lado. Solo se registra un error en el health registry. No hay
   retry ni spool.
2. **El rate counter descarta en silencio.** Con
   `SYSLOG_MAX_EVENTS_PER_MINUTE=1000`, un flap que genere miles de mensajes en
   un minuto pierde la mayoria sin dejar rastro de cuanto se perdio.
3. **No hay tuning del buffer del socket.** UDP no tiene control de flujo. Si la
   DB va lenta, el receive buffer del kernel se llena y el kernel descarta
   datagramas en silencio, sin error ni evento.

A esto se suma un problema de throughput: `ingestEvent` hace **un INSERT por
datagrama**, sin batching. Una rafaga satura el pool de conexiones.

El mismo modo de fallo aplica al receptor SNMP
(`apps/web/lib/monitoring/snmp.ts`): `onNotification` captura el error y lo
registra, pero el trap se pierde.

## Decision de diseno

**Spool en filesystem, no tabla staging en Postgres.** El spool existe justamente
para sobrevivir a que la base de datos este no disponible: una tabla staging
fallaria en el escenario que tiene que proteger. El snapshot debevivir sin la DB.

**Al menos una vez + `ingestId`.** El spool asigna un identificador unico al
recibir y se persiste en una columna con indice unico; el drainer usa
`createMany` con `skipDuplicates`. Si el drainer crashea tras insertar pero antes
de avanzar el offset, el reintento no duplica.

Se descarto deduplicar por clave natural (hash de sourceIp+mensaje+timestamp):
syslog suele tener resolucion de un segundo, asi que dos mensajes identicos en el
mismo segundo se colapsarian en uno y se perderia senal real.

## Arquitectura

```
datagrama UDP
   |
   | 1. parse + classify (en memoria, rapido)
   v
spool append (writeSync, sincronico, sin DB)
   |
   | 2. drainer en background
   v
createMany(skipDuplicates) ---> Postgres
   |                             |
   |                             +-- exito: avanzar offset
   +-- fallo: retry con backoff
                |
                +-- tras N intentos: dead-letter file
```

Puntos clave:

- El camino caliente nunca toca la base de datos.
- El drainer agrupa en lotes, lo que ademas mejora el rendimiento en rafagas.
- El offset se persiste despues del insert exitoso. Si se pierde, el reintento
  re-procesa y el dedup lo neutraliza.
- Se eliminan las perdidas silenciosas: cada drop queda contado y expuesto.

## Tareas

- [x] T1 Migracion Prisma: columna `ingestId` con indice unico en `DeviceEvent`
- [x] T2 Modulo de spool: append sincrono, lectura, offset, dead-letter
- [x] T3 Drainer: lotes con `createMany`, retry con backoff, dead-letter
- [x] T4 Cablear el receptor de syslog al spool
- [x] T5 Observabilidad: drops y backlog expuestos en `/api/health`
- [x] T6 `setRecvBufferSize` para absorber rafagas
- [x] T7 Tests: spool, drainer y camino de syslog

## Implementacion

Archivos nuevos:

- `apps/web/lib/monitoring/event-spool.ts`: cola durable generica. JSONL
  append-only con descriptor abierto entre llamadas (`appendFileSync` reabre el
  archivo en cada escritura). Rotacion atomica por `rename`, offset persistido
  con escritura temporal mas `rename`, y dead-letter aparte.
- `apps/web/lib/monitoring/event-drainer.ts`: drena a Postgres en lotes.
- `apps/web/lib/monitoring/event-ingest.ts`: une spool y drainer, compartido por
  syslog y (proximamente) SNMP.

Archivos modificados:

- `packages/soc/src/ingest.ts`: `ingestEvents` por lotes con `skipDuplicates`.
- `apps/web/lib/monitoring/syslog.ts`: el camino caliente ya no toca la base.
- `apps/web/app/api/health/route.ts`: expone `ingest` y degrada el estado si
  hubo perdida.
- `docker-compose.prod.yml`: volumen `spool_data`. Sin el, recrear el
  contenedor pierde los eventos bufferizados.

## Detalles de operacion

- `EVENT_SPOOL_DIR`: ubicacion del spool (por defecto `.spool/` bajo el cwd).
- `SYSLOG_RECV_BUFFER_BYTES`: buffer de recepcion (por defecto 4 MB).
- Backoff del drainer: 1s, 5s, 15s, 30s, 60s.
- Tras 10 lotes fallidos consecutivos el lote va a dead-letter. No se pierde: el
  archivo `.dlq.jsonl` conserva los datos para reproducir cuando la base
  vuelva.
- `.spool/` esta en `.gitignore` y es volumen persistente en produccion.

## Fuera de alcance

- Receptor SNMP (PR siguiente, replica el patron sobre otra forma de entrada).
- SEC-008 (rate limiting distribuido). Queda para el despliegue en hardware
  propio del NOC.
- Migracion de los sockets de otros servicios.

## Criterio de cierre

Un evento que no se puede escribir en Postgres queda persistido en disco y se
procesa cuando la base vuelve, sin perdida ni duplicado. Y toda perdida que
occurra sigue siendo visible en `/api/health`.