# Habilitar NOC y SOC

**Objetivo:** encender los dos planos de vigilancia del sistema —el proactivo (NOC:
métricas, alertas, incidentes) y el de seguridad (SOC: syslog, brute force, firmware)—
con los flags de entorno correctos, y confirmar que quedaron corriendo.

Todos los planos están **apagados por defecto**. Ninguno corre sin un flag explícito. Los
flags que **encienden** un loop (`METRICS_POLLER_ENABLED`, `FIRMWARE_AUDIT_ENABLED`,
`SYSLOG_RECEIVER_ENABLED`, `FEC_COLLECTION_ENABLED`) se leen una sola vez, cuando arranca
el proceso Node (`apps/web/instrumentation.ts`). Los del canal de notificación
(`ALERT_WEBHOOK_URL`, `TELEGRAM_*`) se releen en cada tick del poller, pero el loop tiene
que existir primero.

## Requisitos

- Un `.env` (o `.env.prod`) con `DATABASE_URL`, `JWT_SECRET` y `KMS_MASTER_KEY` cargados.
- Al menos un conector NMS en estado `connected` (ver
  [Conectar un NMS real](conectar-un-nms-real.md)); sin él el poller no tiene nada que
  muestrear.
- Para el plano SOC: un tenant existente cuyo `id` vas a usar como `SYSLOG_TENANT_ID`.

## 1. Activar el poller de métricas (plano NOC)

En `.env`:

```env
METRICS_POLLER_ENABLED=true
METRICS_POLL_INTERVAL_MS=900000
METRICS_RETENTION_DAYS=30
```

| Variable | Default | Qué hace |
|---|---|---|
| `METRICS_POLLER_ENABLED` | `false` | Tiene que ser el literal `true`. Es lo único que enciende el loop (`startPollingLoop` en `apps/web/lib/monitoring/scheduler.ts`) |
| `METRICS_POLL_INTERVAL_MS` | `900000` (15 min) | Cadencia del poll. El primer tick corre ~5 s después del arranque (warm-up) |
| `METRICS_RETENTION_DAYS` | `30` | Días que se conservan los `MetricSample`; la purga corre en el mismo ciclo |
| `METRICS_SAMPLE_OLT_DETAIL` | `false` | Con `true`, agrega un fan-out a `getOltDetail()` por OLT (más requests al NMS) |

El poll llama a `listOlts()` y `listOnus()` del conector (`collectSamples` en
`packages/analytics/src/collect.ts`), persiste el resultado como `MetricSample`, purga lo
que pasó `METRICS_RETENTION_DAYS`, corre los detectores, reconcilia alertas y correlaciona
incidentes (`runDetection` en `packages/alerts/src/manager.ts`).

## 2. Ajustar el ciclo de vida de las alertas

Tres relojes controlan el ruido (`packages/alerts/src/dedup.ts`):

```env
ALERT_COOLDOWN_MS=3600000
ALERT_RESOLVE_AFTER_MS=86400000
ALERT_ESCALATE_AFTER_MS=14400000
```

| Variable | Default | Efecto |
|---|---|---|
| `ALERT_COOLDOWN_MS` | 1 h | No se vuelve a notificar la misma alerta antes de este intervalo |
| `ALERT_RESOLVE_AFTER_MS` | 24 h | Una alerta abierta sin finding coincidente se auto-resuelve |
| `ALERT_ESCALATE_AFTER_MS` | 4 h | Una alerta `warning` sin ACK sube a `critical` |

La severidad es monotónica: una alerta que ya subió a `critical` no vuelve a `warning`.

## 3. Configurar los canales de notificación

```env
ALERT_WEBHOOK_URL=https://hooks.example.com/ftth-alerts
TELEGRAM_BOT_TOKEN=123456:ABCdef...
TELEGRAM_CHAT_ID=-1001234567890
```

- `ALERT_WEBHOOK_URL` es el webhook saliente de alertas (compartido por el plano NOC y el
  SOC).
- El canal de Telegram **se construye sólo si hay token y chat id**: `botToken && chatId`
  (`apps/web/lib/monitoring/scheduler.ts`). Con uno solo de los dos, el canal no existe y
  no avisa nadie.
- `SLACK_WEBHOOK_URL`, `WHATSAPP_API_URL` + `WHATSAPP_RECIPIENT` + `WHATSAPP_API_KEY` y
  `NTFY_SERVER_URL` también se leen del entorno. Ojo: `SLACK_WEBHOOK_URL` y las variables de
  WhatsApp **no están en `.env.example`**; si las vas a usar, agregalas a mano.

Para notificaciones administrables desde la UI (canales con `minSeverity`, cooldown y
dedupe propios) está la API de `/api/ops/notifications`, que además redacta el `target` al
listarlo.

## 4. Activar el receptor syslog (plano SOC)

```env
SYSLOG_RECEIVER_ENABLED=true
SYSLOG_TENANT_ID=clxxxxxxxxxxxxxxxxxxxxxxxx
SYSLOG_UDP_PORT=5514
SYSLOG_DETECTION_INTERVAL_MS=60000
```

> **El receptor queda inerte sin `SYSLOG_TENANT_ID`.** `startSyslogReceiver`
> (`apps/web/lib/monitoring/syslog.ts`) sale temprano si falta cualquiera de las dos
> variables: no abre socket, no persiste eventos y no corre detección. `SYSLOG_RECEIVER_ENABLED`
> sola no alcanza — el tenant es obligatorio porque es el que atribuye cada evento.

| Variable | Default | Efecto |
|---|---|---|
| `SYSLOG_RECEIVER_ENABLED` | `false` | Debe ser exactamente `true` |
| `SYSLOG_TENANT_ID` | — | **Obligatoria.** Id del tenant al que se atribuyen los eventos |
| `SYSLOG_UDP_PORT` | `5514` | Puerto UDP de escucha |
| `SYSLOG_DETECTION_INTERVAL_MS` | `60000` | Cada cuánto corre el barrido de detección sobre la ventana de 15 min |
| `SYSLOG_MAX_MESSAGE_LENGTH` | `2000` | Truncado defensivo del mensaje |
| `SYSLOG_MAX_EVENTS_PER_MINUTE` | `1000` | Techo de ingesta; los datagramas excedentes se descartan y quedan contados en `ingest.rateLimited` de `/api/health` |
| `SYSLOG_RECV_BUFFER_BYTES` | `4194304` | Buffer de recepción del kernel; aumentalo si un flap de link genera ráfagas |

El pipeline es: datagrama UDP → parseo RFC 3164 → clasificación
(`auth_failure`/`access`/`config_change`/`other`) → spool durable en disco → escritura en
`DeviceEvent` → `runSecurityDetection` (`packages/soc/src/run.ts`) cada
`SYSLOG_DETECTION_INTERVAL_MS`.

## 5. Activar la auditoría de firmware

```env
FIRMWARE_AUDIT_ENABLED=true
FIRMWARE_AUDIT_INTERVAL_MS=86400000
FIRMWARE_AUDIT_VULNERABLE_LIST=
```

| Variable | Default | Efecto |
|---|---|---|
| `FIRMWARE_AUDIT_ENABLED` | `false` | Debe ser `true` |
| `FIRMWARE_AUDIT_INTERVAL_MS` | `86400000` (24 h) | Cadencia; es deliberadamente más lenta que el poller |
| `FIRMWARE_AUDIT_VULNERABLE_LIST` | vacío | Allowlist de firmware vulnerable, separada por comas. Vacía o inválida ⇒ baseline embebido (`DEFAULT_VULNERABLE_FIRMWARE`) |

Opcionalmente, la recolección de telemetría óptica/FEC:

```env
FEC_COLLECTION_ENABLED=true
FEC_COLLECTION_INTERVAL_MS=3600000
FEC_FAN_OUT_PER_CYCLE=8
FEC_RATE_LIMIT_PER_HOUR=15
```

## 6. Reiniciar el proceso

**Este paso no es opcional.** Los flags que encienden los loops se leen en
`instrumentation.register()`, que corre una vez cuando arranca el servidor Node. Editar el
`.env` sin reiniciar no cambia nada: el loop sigue apagado y `/api/health` sigue diciendo
que el servicio no está esperado.

```bash
# Desarrollo
pnpm dev            # cortá (Ctrl+C) y volvé a levantar

# Docker Compose
docker compose -f docker-compose.prod.yml up -d --force-recreate app

# PM2
pm2 restart ftth-copilot
```

## 7. Verificar

```bash
curl -sS http://127.0.0.1:3001/api/health | head -c 2000
```

El campo `services` tiene una entrada por loop, con los nombres `polling`, `firmware`,
`fec`, `syslog` y `syslog-detection`. Cada uno dice si está `expected` (o sea, si el flag
lo activó) y cuándo fue su último tick. Si un loop está habilitado pero nunca corrió,
aparece en `hungLoops` y el endpoint responde **503** con `status: "degraded"`.

También mirá:

```bash
# Exposición Prometheus (401 si METRICS_BEARER_TOKEN está seteado)
curl -sS http://127.0.0.1:3001/api/metrics | grep ftth_copilot_active_alerts

# Paneles
#   /dashboard            → incidentes, predicciones, SLA, overview de OLT/ONU
#   /dashboard/metrics    → métricas (VictoriaMetrics)
#   /alerts               → alertas activas
#   /app                  → gestión de conectores NMS
#
# API del timeline unificado (alertas + incidentes + device events + cambios)
curl -sS -b /tmp/ftth.cookies 'http://127.0.0.1:3001/api/ops/events?hours=48'
```

El primer poll ocurre ~5 s después del arranque (el warm-up del scheduler); los
siguientes, cada `METRICS_POLL_INTERVAL_MS`. Después del primero tienen que existir filas
en `MetricSample`. Lo más rápido para forzarlo en un entorno de prueba es bajar
`METRICS_POLL_INTERVAL_MS` a `30000` y reiniciar.

## Troubleshooting

- **`SYSLOG_RECEIVER_ENABLED=true` pero no entra nada por UDP** → falta `SYSLOG_TENANT_ID`.
  Sin tenant el receptor ni siquiera abre el socket (`startSyslogReceiver` sale antes del
  `bind`).
- **`services.syslog` dice `expected: false`** → el flag no es el literal `true`, o falta el
  tenant id.
- **El puerto UDP ya está ocupado** → el error queda registrado en el registro de salud del
  servicio `syslog` y en `/api/health` (no se traga en silencio). Cambiá `SYSLOG_UDP_PORT`.
- **No llegan notificaciones de Telegram** → falta `TELEGRAM_BOT_TOKEN` **o**
  `TELEGRAM_CHAT_ID`. Con uno solo de los dos el canal no se construye.
- **Llegan alertas pero no incidentes** → la correlación exige al menos 2 kinds de alerta
  distintos en el mismo equipo (`packages/alerts/src/correlate.ts`). Con una sola alerta no
  hay incidente.
- **`/api/health` devuelve 503 apenas se prende el poller** → el primer warm-up tarda ~5 s
  en correr y el detector de loops colgados marca como colgado un loop que todavía no
  tuvo su primer tick. Espera un ciclo y vuelve a consultar.
- **`ingest.rateLimited` sube en `/api/health`** → se excedió
  `SYSLOG_MAX_EVENTS_PER_MINUTE`: los datagramas syslog se descartaron. Subí el techo o
  bajá la tasa de ingreso.
- **`ingest.dropped` sube en `/api/health`** → el spool no pudo encolar el evento (buffer
  lleno o error de escritura). Revisá el espacio del volumen `spool_data` y el
  `SYSLOG_RECV_BUFFER_BYTES`.
- **Cambiaste el `.env` y nada cambió** → falta reiniciar el proceso (paso 6).
