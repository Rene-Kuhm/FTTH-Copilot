# FTTH-Copilot — copiloto NOC/SOC para ISPs FTTH

> **Qué es:** una aplicación multi-tenant que, sobre una misma base (usuarios, tenants, conexiones NMS y PostgreSQL), responde preguntas de red en español **y** vigila la red en segundo plano: detecta fallas antes de que impacten a los clientes (NOC) y detecta eventos de seguridad (SOC).
>
> **Por qué existe:** el técnico de un ISP no tiene tiempo de leer métricas crudas ni syslogs. Este sistema convierte señales débiles (deriva de RX, intentos de login fallidos, firmware vulnerable) en **una sola unidad de trabajo accionable**.

## El modelo mental (leé esto primero)

No pienses en FTTH-Copilot como una sola app. Son **tres planos que conviven sobre la misma base**:

```text
┌─────────────────────────────────────────────────────────────┐
│  Copiloto conversacional   ·   NOC   ·   SOC                 │
│  (diagnóstico en lenguaje  ·   (fallas  ·  (seguridad)       │
│   natural)                 ·    proactivas)                  │
└─────────────────────────────────────────────────────────────┘
                      └──────────┬──────────┘
                    base compartida multi-tenant
        (auth + permisos + conexiones NMS + PostgreSQL)
```

| Plano | Qué responde | Señal que consume |
|-------|--------------|-------------------|
| **Copiloto** | "¿cuántas ONUs están offline y por qué?" | datos en vivo del NMS |
| **NOC** | "¿qué se va a romper antes de que se rompa?" | series temporales de métricas |
| **SOC** | "¿me están atacando / tengo un CPE comprometido?" | syslog y telemetría de seguridad |

Los tres comparten la misma idea central: **cada conector es tenant-aware, nunca cae silenciosamente a fixtures, y toda acción sensible está atada a permisos y a la sesión revocable en PostgreSQL.**

El detalle de cada plano, el flujo de datos y el modelo de datos están en [`docs/architecture.md`](docs/architecture.md). La evolución hacia un NOC cognitivo (AIOps) está en [`docs/aiops-roadmap.md`](docs/aiops-roadmap.md). Cómo probar todo sin equipamiento físico está en [`docs/testing-without-hardware.md`](docs/testing-without-hardware.md).

## Inicio local

Requisitos: Node.js 22+, pnpm 11+ y PostgreSQL.

```bash
cp .env.example .env
# Configurá DATABASE_URL, MINIMAX_API_KEY, JWT_SECRET y KMS_MASTER_KEY
pnpm install
pnpm --filter @ftth-copilot/db db:migrate
pnpm dev
```

Abrí `http://localhost:3001`.

`pnpm install` genera automáticamente el cliente Prisma. También se puede regenerar con `pnpm db:generate`.

## Los tres planos en una línea

### 1. Copiloto conversacional

**Qué es:** un agente que recibe preguntas en español, elige las tools correctas del NMS y responde con un diagnóstico legible.

**Por qué:** la barrera entre "la red está mal" y "sé exactamente qué hacer" es la interpretación de datos crudos.

**Cómo funciona:** el loop del agente vive en `packages/agent-core`. Cada conversación está atada a un tenant y a una conexión NMS; el chat aplica cuotas atómicas por usuario/minuto/día en PostgreSQL.

**Cómo se usa:** el chat vive en `/app`, el tablero en `/dashboard`, y las rutas `/api/chat`, `/api/dashboard` y `/api/alerts` exponen la misma conexión tenant-aware.

### 2. NOC — detección proactiva

**Qué es:** un poller de fondo que muestrea métricas, detecta fallas **antes** de que impacten y las agrupa en incidentes.

**Por qué:** una ONU que derivó de señal o un OLT recalentándose se puede atender en mantenimiento planificado; si esperás a que se caiga, ya hay clientes sin servicio.

**Cómo funciona (flujo):**

```text
conector (cada N) ──► metric_samples ──► detectores ──► detected_alerts
        ▲                                             │
        └─────────────────────────────────────────────┤
                                                      ├─► dedup / cooldown / escalado
                                                      ├─► webhook + Telegram
                                                      └─► incidents (correlación por equipo)
```

Los detectores deterministas corren sobre series temporales:

- deriva de señal RX hacia −27 dBm (predicción de ONU offline con ETA);
- deriva de temperatura hacia 60 °C;
- conexión intermitente (flapping);
- reinicios repetidos;
- anomalías vs línea base robusta (mediana + MAD).

**Cómo se usa:** el poller queda **apagado por defecto** (`METRICS_POLLER_ENABLED=false`) para que dev/preview/tests nunca consulten el NMS en segundo plano. Las predicciones se ven en el tablero (panel "Fallas pronosticadas"), en `GET /api/predictions`, y el Copilot las consulta con la tool `get_predicted_issues`.

### 3. SOC — seguridad

**Qué es:** un receptor syslog UDP más detectores que convierten eventos crudos en hallazgos de seguridad.

**Por qué:** un ISP expone OLTs/ONUs y estos aparecen en shodan; fuerza bruta, cambios de configuración y CPE comprometidos son el riesgo real, no teórico.

**Cómo funciona (flujo):**

```text
syslog UDP ──► parse ──► classify ──► device_events ──► detectores ──► hallazgos ──► webhook/Telegram
```

Detectores activos en runtime:

- **fuerza bruta** (≥ 5 fallos de auth desde una misma IP en 5 min);
- **acceso tras fallos** (login exitoso después de ≥ 3 fallos recientes de la misma fuente);
- **cambio de configuración** (todo `config_change` es notable para revisión).

Detectores implementados y testeados, listos para cablear a datos reales (ver gaps):

- **firmware vulnerable** (versión exacta en una lista de CVEs conocidas);
- **anomalía de tráfico** (throughput sostenido > umbral → posible CPE comprometido).

**Cómo se usa:** el receptor queda **apagado por defecto** (`SYSLOG_RECEIVER_ENABLED=false` y requiere `SYSLOG_TENANT_ID`). La auditoría de accesos (logins y fallos) se expone en `GET /api/security/access` y en el panel "Accesos" del tablero.

## Fuentes de datos

- **SmartOLT:** adaptador HTTP real y fixtures de demo.
- **Mikrowisp:** adaptador HTTP real y fixtures de demo.
- **NetSense:** todavía no implementado; la API lo rechaza explícitamente y nunca sustituye sus datos con mocks.

El modo demo solo se activa con `DEMO_MODE_ENABLED=true`. En ese modo la interfaz y las respuestas del agente identifican los datos como simulados. En producción debe permanecer en `false`.

Los conectores reales deben validarse antes de ser usados. Chat, dashboard y alertas comparten la misma conexión tenant-aware y nunca caen silenciosamente a fixtures cuando un conector falla.

## Seguridad de red

Las URL de NMS:

- usan HTTPS y puerto 443 por defecto;
- no pueden apuntar a localhost, metadata cloud ni rangos privados;
- se validan mediante DNS antes de cada conexión;
- tienen timeout configurable con `NMS_REQUEST_TIMEOUT_MS`;
- pueden restringirse con `NMS_ALLOWED_HOSTS` y `NMS_ALLOWED_PORTS`.

Para un NMS confiable dentro de una LAN se requieren opt-ins explícitos: `NMS_ALLOW_PRIVATE_NETWORKS=true` y, si corresponde, `NMS_ALLOW_HTTP=true`.

## Autenticación y costos

- Sesiones JWT en cookie `HttpOnly`, respaldadas por una sesión revocable en PostgreSQL.
- `/api/chat`, dashboard y alertas requieren autenticación y permisos.
- Chat aplica límites atómicos por usuario, minuto y día en PostgreSQL mediante `CHAT_RATE_LIMIT_PER_MINUTE` y `CHAT_DAILY_QUOTA`; las cuotas se comparten entre instancias.
- Las credenciales NMS se cifran con AES-256-GCM usando `KMS_MASTER_KEY`.

## Configuración

Las variables están documentadas en `.env.example`. Agrupadas por plano:

| Plano | Variables |
|-------|-----------|
| NOC (poller) | `METRICS_POLLER_ENABLED`, `METRICS_POLL_INTERVAL_MS`, `METRICS_RETENTION_DAYS`, `METRICS_SAMPLE_OLT_DETAIL` |
| NOC (notificaciones) | `ALERT_WEBHOOK_URL`, `ALERT_COOLDOWN_MS`, `ALERT_RESOLVE_AFTER_MS`, `ALERT_ESCALATE_AFTER_MS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| SOC (receptor) | `SYSLOG_RECEIVER_ENABLED`, `SYSLOG_UDP_PORT`, `SYSLOG_TENANT_ID`, `SYSLOG_DETECTION_INTERVAL_MS` |
| Red NMS | `NMS_REQUEST_TIMEOUT_MS`, `NMS_ALLOWED_HOSTS`, `NMS_ALLOWED_PORTS`, `NMS_ALLOW_HTTP`, `NMS_ALLOW_PRIVATE_NETWORKS` |
| Chat | `CHAT_RATE_LIMIT_PER_MINUTE`, `CHAT_DAILY_QUOTA` |

## Verificación

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage-check
pnpm build
pnpm --filter @ftth-copilot/web exec playwright install chromium
pnpm test:e2e
```

CI ejecuta lint, typecheck, cobertura, build y Playwright.

## Estructura

```text
apps/web/                         Next.js App Router, rutas API y tablero
packages/agent-core/              loop del agente, prompt, tools
packages/analytics/               recolección, persistencia, retención y SLA
packages/detection/               estadística y detectores deterministas (NOC)
packages/alerts/                  dedup, correlación, notificación (webhook/Telegram)
packages/monitoring/              orquestación del ciclo de poll
packages/security/                parseo syslog y detectores (SOC)
packages/soc/                     ingestión y orquestación de la detección SOC
packages/connectors/core/         interfaz y política de red compartida
packages/connectors/smartolt/     adaptador SmartOLT
packages/connectors/mikrowisp/    adaptador Mikrowisp
packages/db/                      Prisma, auth, sesiones y cifrado
packages/shared/                  tipos compartidos
```

Cada paquete está explicado por su responsabilidad (qué hace y por qué) en [`docs/architecture.md`](docs/architecture.md).

## Nota operativa sobre Cloudflare

Una credencial de Cloudflare Tunnel figuró en versiones anteriores del historial público. Fue rotada en Cloudflare Zero Trust y la credencial expuesta quedó invalidada.

## Licencia

Propietario — todos los derechos reservados. Copyright © 2026 TecnoDespegue / René Kuhm.

Este repositorio **no** está bajo una licencia de código abierto. El acceso público se concede únicamente para su revisión y evaluación: no puede usarse, copiarse, modificarse ni redistribuirse (total o parcialmente) sin autorización expresa y por escrito del titular. Ver [`LICENSE`](LICENSE).
