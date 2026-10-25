# ADR 0014 — Ingesta durable con spool en disco y deduplicación por `ingestId`

**Estado:** Aceptada
**Fecha:** 2026-10-05 (`20261005120000_add_event_ingest_id`)

## Contexto

El plano SOC ingiere syslog por UDP. UDP **no entrega garantizada**: los datagramas se
pierden cuando el buffer del kernel se llena, cuando el proceso está en un GC largo, o
cuando el host se reinicia.

El sistema, sin embargo, necesita que un evento de syslog **no se procese dos veces**: los
detectores de seguridad (fuerza bruta, acceso tras fallos, cambio de configuración)
cuentan eventos, y un duplicado infla el conteo y puede disparar una alerta que no
corresponde. Al mismo tiempo, reintentar un evento que sí se procesó genera ruido
adicional.

El otro extremo: la ingesta de syslog es **densa** y la base no es el lugar adecuado para
absorberla. Escribir cada datagrama en Postgres de a uno, con sus índices, es caro; y si la
base está lenta, el socket UDP se llena y se pierden eventos.

## Decisión

Separar **recibir** de **persistir**, con un spool en disco entre ambas, y hacer la
deduplicación **en la base, por una clave de reintento**.

- El spool vive en disco, con la ruta en `EVENT_SPOOL_DIR`
  (`apps/web/lib/monitoring/event-ingest.ts:28`), por defecto `join(process.cwd(),
  '.spool')`.
- En producción el directorio es un **volumen nombrado**: `spool_data:/var/lib/ftth-copilot/spool`
  en `docker-compose.prod.yml`, con `EVENT_SPOOL_DIR=/var/lib/ftth-copilot/spool` (`:44-55`).
- La deduplicación usa la columna `DeviceEvent.ingestId String? @unique`
  (`schema.prisma:430`), con la migración `20261005120000_add_event_ingest_id`. Los NULL
  quedan distintos entre sí en Postgres, que es lo que permite que un `DeviceEvent`
  creado por otra vía no colisione.
- El receptor syslog además acota el daño en la entrada: `SYSLOG_MAX_MESSAGE_LENGTH`
  (2000) limita la longitud almacenada y `SYSLOG_MAX_EVENTS_PER_MINUTE` (1000) descarta los
  excedentes en una ventana de 60 s (`apps/web/lib/monitoring/syslog.ts:68`, `:70`).
- `SYSLOG_RECV_BUFFER_BYTES` (4 MB por defecto, `syslog.ts:54`) agranda el buffer de
  recepción del kernel, que en producción se configura por compose
  (`docker-compose.prod.yml:59-60`).

## Consecuencias

### Buenas

- **Un datagrama perdido deja de ser una pérdida**: el spool en disco permite reintentar.
- La deduplicación por `ingestId` **garantiza idempotencia en la base**, no en la
  aplicación: un reintento que llega dos veces no duplica el evento.
- El spool **desacopla el socket del costo de la base**: el receptor acepta rápido y la
  persistencia se hace aparte.
- El volumen nombrado hace que el spool **sobreviva a un redeploy**, que es el caso donde
  más se necesita.
- Los límites de longitud y de tasa **acotan el daño por DoS** desde la propia red del
  cliente, que es un vector real en un ISP.
- `ingestId` único global es una restricción fuerte: el mismo evento no puede existir dos
  veces en toda la instalación, ni entre tenants.

### Malas

- **El spool necesita disco y necesita atención**: si se llena y nadie lo purga, la ingesta
  se frena. No hay política de purga documentada.
- `ingestId` es único **global**, no por tenant: dos tenants con el mismo `ingestId` en el
  mismo instante colisionarían. Hoy el receptor syslog atribuye todo a un único
  `SYSLOG_TENANT_ID`, así que no se puede dar; el día que haya multi-tenant por fuente
  syslog, este unique habrá que cambiar.
- Los `NULL` en un `@unique` se consideran distintos entre sí: es el comportamiento
  deseado, pero es un detalle de Postgres que no es evidente.
- El spool **duplica datos en disco**: hay que garantizar que ese disco no es un backup
  con datos sensibles sin cifrar.
- `SYSLOG_MAX_EVENTS_PER_MINUTE` descarta eventos **sin registrar el descarte**: durante
  una inundación, el operador ve menos eventos y no sabe cuántos se perdieron.

### Abiertas

- No hay reconciliación entre el spool y la base: si el proceso muere entre el fsync del
  spool y el insert, el evento queda pendiente sin señal de que está ahí.
- La generación del `ingestId` no está documentada: si es un hash del contenido, dos
  eventos idénticos legítimos colisionarían.
- La purga del spool no está implementada en ninguna variable ni script.
