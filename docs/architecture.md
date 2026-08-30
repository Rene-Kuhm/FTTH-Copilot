# Arquitectura — FTTH-Copilot (NOC/SOC)

> **Qué es este documento:** el mapa mental completo del sistema. Explica **qué** hace cada pieza, **por qué** existe y **cómo** encaja con las demás, de lo general a lo específico.
>
> **Para quién:** quien vaya a tocar el código, operar el sistema en producción o diseñar una pieza nueva. Leé primero la sección "Modelo mental"; después saltá a la pieza que te interese.

## 1. Modelo mental

FTTH-Copilot es **una sola base multi-tenant con tres planos de producto encima**. Entender esa distinción es lo primero: los tres planos no son apps separadas, comparten autenticación, tenants, conexiones NMS y la misma base PostgreSQL.

```text
┌──────────────────────────────────────────────────────────────┐
│  PLANO 1 — Copiloto   │  PLANO 2 — NOC   │  PLANO 3 — SOC     │
│  conversacional       │  proactivo        │  seguridad         │
└──────────────────────────────────────────────────────────────┘
                         base compartida
   ┌────────────────────────────────────────────────────────────┐
   │ Tenant · User/Role · NmsConnection (cifrada) · permisos    │
   └────────────────────────────────────────────────────────────┘
```

La regla que cruza los tres planos: **todo lo que toca el NMS es tenant-aware y validado; nada cae silenciosamente a fixtures; toda acción sensible está atada a sesión revocable y permisos.**

El sistema tiene **dos pipelines de datos**, uno por cada plano de vigilancia:

- **Pipeline NOC** — métricas → series temporales → fallas proactivas.
- **Pipeline SOC** — syslog → eventos → hallazgos de seguridad.

El Copiloto (plano 1) es *consumidor* de ambos: puede responder preguntas sobre el NMS y consultar las predicciones del NOC.

## 2. Los dos pipelines de datos

### 2.1 Pipeline NOC (métricas → fallas)

**Qué:** convierte métricas crudas del NMS en alertas deduplicadas e incidentes accionables.

**Por qué:** el valor de un NOC no es "guardar métricas", es **saber qué se va a romper antes de que se rompa**.

```text
poll (cada N ms)
  │
  ├─► connector.getNetworkOverview() ──► MetricSample (RX, TX, temp, uptime, status)
  │
  ├─► runRetention() ──► borra samples más viejos que METRICS_RETENTION_DAYS
  │
  ├─► runDetection() (packages/alerts)
  │     ├─► agrupa samples por (deviceKind, deviceId) → series
  │     ├─► runDetectors(series) → findings
  │     ├─► reconcile() → dedup / cooldown / escalado / resolución
  │     ├─► persiste DetectedAlert (upsert por clave única)
  │     ├─► notifica webhook + Telegram (solo lo que toca notificar)
  │     └─► correlateAlerts() → Incident por equipo
  │
  └─► pollConnections() repite por cada conexión `connected`
```

**Cómo se activa:** `METRICS_POLLER_ENABLED=true` (ver §8).

### 2.2 Pipeline SOC (syslog → hallazgos)

**Qué:** convierte eventos syslog crudos en hallazgos de seguridad notificables.

**Por qué:** los equipos de red (OLTs/ONUs) están expuestos; la señal de ataque está en los syslogs, no en las métricas.

```text
UDP socket (SYSLOG_UDP_PORT, default 5514)
  │
  ├─► parseSyslogMessage() (RFC 3164)
  ├─► classifyEvent() → auth_failure | access | config_change | other
  ├─► ingestEvent() → DeviceEvent (tenantId + sourceIp + categoría + mensaje)
  │
  └─► runSecurityDetection() (cada SYSLOG_DETECTION_INTERVAL_MS)
        ├─► lee DeviceEvent de la ventana (lookback 15 min)
        ├─► detectBruteForce + detectAccessAfterFailures + detectConfigChange
        └─► notifica webhook + Telegram si hay hallazgos
```

**Cómo se activa:** `SYSLOG_RECEIVER_ENABLED=true` **y** `SYSLOG_TENANT_ID` seteado (ver §8).

## 3. Modelo de datos (las entidades que tenés que tener en la cabeza)

**Por qué importa:** el esquema no es un volcado de tablas; es la forma en que el sistema *piensa* la red. Entendé estas cuatro entidades y entendés el resto.

| Entidad | Qué representa | Dato clave |
|---------|----------------|------------|
| `Tenant` | un ISP cliente | raíz de todo; todo cuelga de él |
| `NmsConnection` | una conexión a un NMS (SmartOLT/Mikrowisp) | `encryptedKey` (AES-256-GCM) + `status` |
| `MetricSample` | un punto de una serie temporal | `deviceKind` + `deviceId` + `kind` + `value` |
| `DetectedAlert` | una falla proactiva detectada | `kind` + `severity` + `status` + ventana temporal |
| `Incident` | un equipo con una o más alertas activas | agrupa `DetectedAlert` por `(deviceKind, deviceId)` |
| `DeviceEvent` | un evento syslog crudo clasificado | `category` + `sourceIp` + `message` |

Reglas que emergen del modelo:

- **`MetricSample` y `DeviceEvent` son las entradas** (materia prima); **`DetectedAlert`, `Incident` y los hallazgos SOC son las salidas** (conclusiones).
- La deduplicación de alertas NOC usa la clave única `(tenantId, connectionId, kind, deviceKind, deviceId)`: **una sola alerta activa por problema por equipo**.
- Los incidentes usan la clave `(tenantId, connectionId, deviceKind, deviceId)`: **una sola unidad de trabajo por equipo**, aunque tenga varias alertas simultáneas.

## 4. Paquetes (qué hace cada uno y por qué)

Los paquetes están organizados por **responsabilidad**, no por capa técnica. La regla de diseño: **los detectores son funciones puras (fácil de testear) y la orquestación con la base está aislada**.

| Paquete | Qué hace | Por qué existe |
|---------|----------|----------------|
| `@ftth-copilot/db` | Prisma client (singleton), auth (JWT + hash), cifrado AES-256-GCM | la única puerta a PostgreSQL; evita N clientes Prisma |
| `@ftth-copilot/shared` | tipos compartidos agente↔frontend | contrato único de tipos |
| `@ftth-copilot/connectors/core` | interfaz de conector + política de red (HTTPS, DNS, allowlist) | una sola implementación de las reglas de seguridad de red |
| `@ftth-copilot/connectors/smartolt` / `mikrowisp` | adaptadores HTTP de cada NMS | aislar las diferencias de cada proveedor |
| `@ftth-copilot/analytics` | recolectar samples, persistirlos, retención y SLA (`computeUptime`) | el ciclo de vida de la materia prima del NOC |
| `@ftth-copilot/detection` | estadística (mediana/MAD/ajuste de tendencia) y detectores deterministas | los detectores puros, sin dependencia de base |
| `@ftth-copilot/alerts` | dedup (`reconcile`), correlación (`correlateAlerts`), notificación (`sendWebhook`/`sendTelegram`), orquestación (`runDetection`) | el cerebro NOC: convierte findings en alertas persistentes |
| `@ftth-copilot/monitoring` | `pollConnections` / `runPollCycle` | el "latido" del poller: sample → detect → notify |
| `@ftth-copilot/security` | parseo syslog, clasificación y detectores SOC (incl. firmware y tráfico) | los detectores puros de seguridad |
| `@ftth-copilot/soc` | `ingestEvent` y `runSecurityDetection` | el cerebro SOC: convierte eventos en hallazgos |
| `@ftth-copilot/agent-core` | loop del agente, prompt, tools (incl. `get_predicted_issues`) | el plano conversacional |

**Por qué separar detector de orquestación:** `detectSignalDrift` no toca la base — recibe series y devuelve findings. Eso permite testear cada detector con casos sintéticos (100% de cobertura de statements) sin levantar PostgreSQL. La orquestación (`runDetection`, `runSecurityDetection`) se testea con el módulo `@ftth-copilot/db` mockeado y `fetch` inyectado.

## 5. Orquestación en runtime

**Qué:** el punto donde todo se enciende. Vive en `apps/web/instrumentation.ts`, que corre una vez cuando arranca el servidor Node.

**Por qué:** centralizar el arranque en un solo lugar garantiza que dev/preview/tests **nunca** pollen el NMS ni abran un socket UDP en segundo plano.

```text
instrumentation.register()
  ├─► startPollingLoop()  (apps/web/lib/monitoring/scheduler.ts)
  │     └─► si METRICS_POLLER_ENABLED=true, corre runScheduledPoll() cada N ms
  └─► startSyslogReceiver()  (apps/web/lib/monitoring/syslog.ts)
        └─► si SYSLOG_RECEIVER_ENABLED=true + SYSLOG_TENANT_ID, bind UDP + detecta cada N ms
```

Detalles importantes:

- El poller construye un conector **vivo** por cada conexión `connected`. Si una conexión no se puede construir (p. ej. falla el descifrado), la saltea sin abortar el resto.
- El poller respeta el rate-limit del NMS: usa endpoints bulk por defecto y solo hace fan-out a `getOltDetail()` por OLT si `METRICS_SAMPLE_OLT_DETAIL=true`.

## 6. Motor de detección NOC (en detalle)

### 6.1 Los detectores (puros, en `@ftth-copilot/detection`)

Cada detector toma una serie temporal y devuelve `findings`. Son deterministas y no hacen I/O.

| Detector | Señal | Umbral por defecto |
|----------|-------|--------------------|
| `detectSignalDrift` | RX derivando hacia abajo | cruza −27 dBm → ONU offline, con ETA |
| `detectTemperatureDrift` | temperatura derivando hacia arriba | cruza 60 °C |
| `detectFlapping` | conexión intermitente | alternancia rápido online/offline |
| `detectRebootStorm` | reinicios repetidos | N reinicios en ventana |
| `detectBaselineAnomaly` | desviación vs línea base | mediana + MAD robusta |

Todos apoyan en `@ftth-copilot/detection` estadística (`median`, `mad`, `fitTrend`, `predictThresholdCrossing`).

### 6.2 Ciclo de vida de una alerta (dedup y escalado)

**Qué:** una alerta no es un evento único; es un **estado** que evoluciona.

**Por qué:** sin esto, cada ciclo de poll generaría un aluvión de notificaciones repetidas por el mismo problema.

Estados y transiciones (`DetectedAlert.status`):

```text
           ┌──────────► open ──────────► acknowledged
           │              │                    │
  finding ─┤              │ (sin ack, tras      │ (tras ack,
  nuevo    │              │  ESCALATE_AFTER_MS) │  sin finding)
           │              ▼                    ▼
           └──────► (escalado a critical)    resolved
```

Reglas concretas:

- **Cooldown** (`ALERT_COOLDOWN_MS`, default 1 h): no se re-notifica la misma alerta antes de ese intervalo.
- **Resolución** (`ALERT_RESOLVE_AFTER_MS`, default 24 h): una alerta abierta sin finding coincidente durante ese tiempo se marca `resolved`.
- **Escalado** (`ALERT_ESCALATE_AFTER_MS`, default 4 h): una alerta `warning` sin ack que supera esa edad sube a `critical`.
- **Ack respeta el estado**: una alerta `acknowledged` no se reabre ni re-notifica por el mismo finding; si el problema sigue, se mantiene ack hasta resolverse.

### 6.3 Correlación a incidentes

**Qué:** agrupa varias alertas activas del mismo equipo en **un** `Incident`.

**Por qué:** una ONU con deriva de señal + flapping + reinicios es **un problema** (una visita técnica), no tres alertas separadas. El NOC ve una unidad de trabajo, no una tormenta de alertas.

**Cómo:** `correlateAlerts()` agrupa por `(deviceKind, deviceId)`, la severidad del incidente es la máxima de sus alertas, y los incidentes se resuelven cuando su equipo deja de tener alertas activas.

## 7. Motor SOC (en detalle)

### 7.1 Parseo y clasificación

**Qué:** un mensaje syslog llega como texto crudo y se convierte en un `DeviceEvent` clasificado.

**Por qué:** los detectores no quieren hacer regex sobre texto; quieren una categoría semántica.

- `parseSyslogMessage()` — RFC 3164: extrae `facility`, `severity`, `tag`, `hostname`, `message`.
- `classifyEvent()` — clasifica el mensaje en `auth_failure | access | config_change | other`.

### 7.2 Los detectores (puros, en `@ftth-copilot/security`)

| Detector | Señal | Severidad | Estado |
|----------|-------|-----------|--------|
| `detectBruteForce` | ≥ 5 `auth_failure` de una IP en 5 min | critical | **activo en runtime** |
| `detectAccessAfterFailures` | acceso tras ≥ 3 fallos recientes de la misma fuente | warning | **activo en runtime** |
| `detectConfigChange` | todo `config_change` | warning | **activo en runtime** |
| `detectVulnerableFirmware` | versión exacta en lista de CVEs | critical | implementado + testeado, sin datos todavía |
| `detectTrafficAnomaly` | throughput promedio > 100 Mbps en 15 min (critical al doble) | warning/critical | implementado + testeado, sin datos todavía |

## 8. Reporte y auditoría

**Qué:** además de detectar, el sistema responde "¿cuánto estuvo disponible?" y "¿quién accedió?".

**Por qué:** un NOC/SOC no solo actúa; **rinde cuentas** (SLA contractual) y **deja rastro** (auditoría de accesos).

- **SLA / uptime** — `computeUptime()` en `@ftth-copilot/analytics`. Toma samples de estado (`online/offline/degraded`) en una ventana, rellena el primer tramo con el estado de la primera muestra y extiende el último hasta el fin de la ventana. Devuelve `uptimePercent` 0–100. Expuesto en `GET /api/sla` y en el panel "Disponibilidad".
- **Auditoría de accesos** — `GET /api/security/access` devuelve los `DeviceEvent` de categoría `access` y `auth_failure` del tenant (logins exitosos y fallidos). Expuesto en el panel "Accesos".

## 9. Notificaciones

**Qué:** dos canales, ambos opcionales y ambos a través de `@ftth-copilot/alerts`.

**Por qué:** el webhook integra con herramientas existentes del ISP; Telegram da push inmediato al técnico de guardia. Ninguno es obligatorio.

- **Webhook** — `ALERT_WEBHOOK_URL`. Payload `{ type, count, alerts: [...] }` (NOC) o `{ type: 'ftth-copilot.security', findings: [...] }` (SOC).
- **Telegram** — `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` (ambos requeridos; si falta uno, se desactiva).

Ambos canales reciben `fetchImpl` inyectable, lo que permite testear la entrega sin red real.

## 10. Activar en producción

Todo está **apagado por defecto** por diseño: ningún plano de vigilancia corre sin que lo habilites explícitamente. Para activar el NOC y el SOC:

```bash
# 1. Migrar la base (MetricSample, DetectedAlert, Incident, DeviceEvent)
prisma migrate deploy

# 2. NOC — poller de métricas
METRICS_POLLER_ENABLED=true
METRICS_POLL_INTERVAL_MS=900000          # 15 min
ALERT_WEBHOOK_URL=...                    # opcional pero recomendado
TELEGRAM_BOT_TOKEN=...                   # opcional
TELEGRAM_CHAT_ID=...

# 3. SOC — receptor syslog
SYSLOG_RECEIVER_ENABLED=true
SYSLOG_TENANT_ID=...                     # obligatorio para atribuir eventos
SYSLOG_UDP_PORT=5514
```

Después reiniciar el proceso (PM2 `ftth-copilot`). Verificá que el NMS acepte el tráfico saliente y que el puerto UDP esté abierto para el syslog de los equipos.

## 11. Gaps conocidos (honestos)

Estos son puntos donde el sistema tiene una pieza **diseñada pero aún no cableada**, o una decisión pendiente. No son bugs; son trabajo futuro.

1. **Firmware y tráfico (Fase D) sin datos.** `detectVulnerableFirmware` y `detectTrafficAnomaly` están implementados y testeados, pero los conectores todavía no exponen `firmwareVersion` ni throughput por ONU. Hay que agregar esa recolección antes de que esos detectores corran en runtime.
2. **Resolución SOC IP → dispositivo.** `DeviceEvent.deviceId` queda `null` hasta que exista un mapeo de IP/source a equipo del tenant.
3. **Multi-tenant por fuente syslog.** El receptor hoy atribuye todos los eventos a un único `SYSLOG_TENANT_ID`. Soportar varias fuentes → varios tenants es un follow-up.

## 12. Estrategia de testing

**Qué garantiza que esto no se rompa:** la combinación de detectores puros + orquestación mockeada + CI.

**Por qué importa:** el principio del proyecto es "nada se mergea sin estar testeado al máximo".

- **Detectores puros** (`@ftth-copilot/detection`, `@ftth-copilot/security`) — tests unitarios con series sintéticas, cubriendo umbrales y bordes. El paquete `security` llega a 32 tests, 100% de statements.
- **Orquestación** (`@ftth-copilot/alerts`, `@ftth-copilot/soc`, `@ftth-copilot/monitoring`, `@ftth-copilot/analytics`) — `@ftth-copilot/db` mockeado + `fetchImpl` inyectado, para no levantar PostgreSQL ni tocar la red.
- **Cobertura** — Vitest con umbrales (80% statements/líneas/funciones, 70% branches) via `pnpm test:coverage-check`.
- **End-to-end** — Playwright contra la app.
- **CI** — GitHub Actions corre lint, typecheck, cobertura, build y Playwright en cada PR; el merge requiere CI verde.

Regla de oro para contribuir: **si tocás un detector, agregá casos de test que cubran los umbrales y los bordes antes de abrir el PR.**
