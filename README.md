# FTTH-Copilot — diagnóstico FTTH en lenguaje natural

Aplicación multi-tenant que consulta SmartOLT o Mikrowisp y explica el estado de una red FTTH en español. El agente opera en modo de solo lectura y no reemplaza al NMS.

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

## Detección temprana (proactiva)

Además de responder preguntas, el sistema detecta fallas **antes** de que impacten a los clientes:

- Un poller de fondo muestrea cada conector `connected` y guarda series temporales (`metric_samples`), respetando el rate-limit de cada NMS (endpoints bulk por defecto).
- Detectores deterministas sobre esas series:
  - deriva de señal RX hacia -27 dBm (predicción de ONU offline con ETA),
  - deriva de temperatura hacia 60 °C,
  - conexión intermitente (flapping),
  - reinicios repetidos,
  - anomalías vs línea base robusta (mediana + MAD).
- Las alertas se persisten en `detected_alerts` con deduplicación, cooldown y escalado (warning→critical), y se notifican vía webhook (`ALERT_WEBHOOK_URL`).

El poller queda **apagado por defecto** (`METRICS_POLLER_ENABLED=false`) para que dev/preview/tests nunca consulten el NMS en segundo plano. Configuración relevante:

- `METRICS_POLLER_ENABLED`, `METRICS_POLL_INTERVAL_MS`, `METRICS_RETENTION_DAYS`, `METRICS_SAMPLE_OLT_DETAIL`
- `ALERT_WEBHOOK_URL`, `ALERT_COOLDOWN_MS`

Las predicciones se ven en el tablero (panel "Fallas pronosticadas"), en `GET /api/predictions`, y el Copilot las consulta con la tool `get_predicted_issues`.

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
apps/web/                         Next.js App Router y rutas API
packages/agent-core/              loop del agente, prompt, tools y alertas
packages/connectors/core/         interfaz y política de red compartida
packages/connectors/smartolt/     adaptador SmartOLT
packages/connectors/mikrowisp/    adaptador Mikrowisp
packages/db/                      Prisma, auth, sesiones y cifrado
packages/shared/                  tipos compartidos
```

## Aviso operativo sobre Cloudflare

Una credencial de Cloudflare Tunnel estuvo presente en una versión anterior del historial público. El código actual ya no la contiene, pero eliminarla del último commit no invalida la credencial histórica. El propietario debe confirmar su rotación en Cloudflare Zero Trust. No se debe declarar el historial como libre de secretos hasta completar y verificar esa rotación.

## Licencia

Todos los derechos reservados a TecnoDespegue / René Kuhm.
