# Arquitectura

FTTH-Copilot es **una sola base multi-tenant con tres planos de producto encima**. Los tres
planos no son aplicaciones separadas: comparten autenticación, tenants, conexiones NMS y la
misma base PostgreSQL.

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

La regla que cruza los tres planos: **todo lo que toca el NMS es tenant-aware y validado;
nada cae silenciosamente a fixtures; toda acción sensible está atada a una sesión revocable
y a permisos.**

## Los dos pipelines de vigilancia

El sistema tiene dos pipelines de datos, uno por cada plano de vigilancia. El Copiloto es
*consumidor* de los dos: puede responder preguntas sobre el NMS y consultar las
predicciones del NOC.

### Pipeline NOC — métricas → fallas proactivas

El valor de un NOC no es "guardar métricas", es **saber qué se va a romper antes de que se
rompa**.

```text
poll (cada METRICS_POLL_INTERVAL_MS)
  │
  ├─► connector.listOlts() + listOnus() ──► MetricSample (RX, TX, temp, uptime, status)
  │     └─► (sólo con METRICS_SAMPLE_OLT_DETAIL=true) getOltDetail() por OLT
  │
  ├─► runRetention() ──► borra samples más viejos que METRICS_RETENTION_DAYS
  │
  ├─► runDetection() (packages/alerts)
  │     ├─► agrupa samples por (deviceKind, deviceId) → series
  │     ├─► runDetectors(series) → findings
  │     ├─► reconcile() → dedup / cooldown / escalado / resolución
  │     ├─► persiste DetectedAlert (upsert por clave única)
  │     ├─► notifica webhook + Telegram (sólo lo que toca notificar)
  │     └─► correlateAlerts() → Incident por equipo
  │
  └─► pollConnections() repite por cada conexión `connected`
```

El poller construye un conector **vivo** por cada conexión en estado `connected`. Si una
conexión no se puede construir (por ejemplo, falla el descifrado de la API key), la saltea
sin abortar el resto del ciclo.

El muestreo usa **sólo los endpoints bulk** (`listOlts()` + `listOnus()`) para no exceder el
rate-limit del NMS. El fan-out a `getOltDetail()` por OLT —que trae temperatura y uptime
con detalle— sólo ocurre con `METRICS_SAMPLE_OLT_DETAIL=true`
(`packages/analytics/src/collect.ts:86`).

### Pipeline SOC — syslog → hallazgos de seguridad

Los equipos de red están expuestos, y la señal de ataque está en los syslogs, no en las
métricas.

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

## La regla de oro del modelo de datos

`MetricSample` y `DeviceEvent` son las **entradas** (materia prima). `DetectedAlert`,
`Incident` y los hallazgos SOC son las **salidas** (conclusiones).

Dos claves únicas implementan el aislamiento semántico del ruido:

- `DetectedAlert` es único por `(tenantId, connectionId, kind, deviceKind, deviceId)`:
  **una sola alerta activa por problema por equipo**.
- `Incident` es único por `(tenantId, connectionId, deviceKind, deviceId)`: **una sola unidad
  de trabajo por equipo**, aunque tenga varias alertas simultáneas.

Esa diferencia es deliberada: una ONU con deriva de señal + flapping + reinicios es **un
problema** (una visita técnica), no tres alertas separadas.

## Los paquetes, organizados por responsabilidad

La regla de diseño del repo es: **los detectores son funciones puras (fácil de testear) y la
orquestación con la base está aislada**.

| Paquete | Responsabilidad | Por qué existe así |
|---|---|---|
| `@ftth-copilot/connectors/core` | interfaz de conector + política de red | una sola implementación de las reglas de seguridad de red |
| `@ftth-copilot/connectors/smartolt` / `mikrowisp` / `mikrotik` | adaptador HTTP de cada NMS | aislar las diferencias de cada proveedor |
| `@ftth-copilot/detection` | estadística (mediana/MAD/ajuste de tendencia) y detectores deterministas | los detectores puros, sin dependencia de base ni de red |
| `@ftth-copilot/alerts` | dedup, correlación, notificación y orquestación | el cerebro NOC: convierte findings en alertas persistentes |
| `@ftth-copilot/analytics` | recolectar, persistir, retener y SLA | el ciclo de vida de la materia prima |
| `@ftth-copilot/monitoring` | poll + toda la pila SNMP | el latido del poller y la decodificación multi-fabricante |
| `@ftth-copilot/security` | parseo syslog, clasificación y detectores SOC | los detectores puros de seguridad |
| `@ftth-copilot/soc` | ingesta syslog, auditoría, LDAP, notificaciones | el cerebro SOC |
| `@ftth-copilot/db` | Prisma, auth y cifrado | la única puerta a PostgreSQL |
| `@ftth-copilot/shared` | contratos de wire + motor Laya | contrato único de tipos |
| `@ftth-copilot/evidence` | TruthGate, abstención, topología, RAG | la capa de evidencia, pura y sin DB |
| `@ftth-copilot/agent-core` | loop del agente, router, tools, investigación | el plano conversacional |

**Por qué separar detector de orquestación:** `detectSignalDrift` no toca la base — recibe
series y devuelve findings. Eso permite testear cada detector con casos sintéticos sin
levantar PostgreSQL. La orquestación (`runDetection`, `runSecurityDetection`) se testea con
el módulo `@ftth-copilot/db` mockeado y `fetch` inyectado.

## Dónde se enciende todo

El arranque vive en `apps/web/instrumentation.ts`, que corre una vez cuando arranca el
servidor Node. Centralizarlo garantiza que dev, preview y tests **nunca** pollen el NMS ni
abran un socket UDP en segundo plano.

```text
instrumentation.register()
  ├─► startPollingLoop()          (apps/web/lib/monitoring/scheduler.ts)
  │     └─► si METRICS_POLLER_ENABLED=true, corre el poll cada N ms
  ├─► startFirmwareAuditLoop()    (apps/web/lib/monitoring/scheduler.ts)
  │     └─► si FIRMWARE_AUDIT_ENABLED=true, corre la auditoría cada N ms
  └─► startSyslogReceiver()       (apps/web/lib/monitoring/syslog.ts)
        └─► si SYSLOG_RECEIVER_ENABLED=true + SYSLOG_TENANT_ID, bind UDP y detecta
```

**Todo está apagado por defecto por diseño**: ningún plano de vigilancia corre sin que lo
habilites explícitamente.

## El sistema de archivos como tabla

| Archivo | Rol |
|---|---|
| `packages/monitoring/src/snmp/adapter/` | un adapter por familia de hardware OLT |
| `packages/shared/src/contracts.ts` | todos los schemas de wire, con su literal de versión |
| `packages/db/prisma/schema.prisma` | el modelo de datos completo |
| `packages/evidence/src/` | las funciones puras de evidencia (sin DB) |
| `research/olt/<vendor>/` | las fuentes documentadas de cada fabricante |

## Lo que sigue

- [Evidencia y Truth Gate](evidencia-y-truth-gate.md) — el mecanismo que hace que una
  respuesta del agente sea defendible.
- [Investigación cognitiva](investigacion-cognitiva.md) — el motor que produce diagnósticos.
- [Ciclo de vida de las alertas](ciclo-de-vida-de-alertas.md) — cómo una alerta se convierte
  en incidente.
- [Routing y Laya](routing-y-laya.md) — cómo se decide cuánto esfuerzo poner en una
  consulta.
- [Topología y tenants](topologia-y-tenants.md) — el modelo de red y el aislamiento.
