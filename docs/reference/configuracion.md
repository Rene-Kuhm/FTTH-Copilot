# Referencia de configuración

Todas las variables que el código lee. Fuente primaria: `.env.example` más los `process.env.*`
reales del repositorio. La columna "Dónde se lee" apunta al archivo y la línea.

**No existe un schema zod de entorno.** No hay validación centralizada: cada módulo lee
lo que necesita y aplica su propio default. Eso significa que una variable mal formada no
falla al arrancar, sino que **cae al default silenciosamente** en algunos casos (helpers
`positiveInt`) o devuelve un error de negocio en otros.

## 1. Base de datos

| Variable | Default | Obligatoria | Dónde se lee | Controla |
|---|---|---|---|---|
| `DATABASE_URL` | `postgresql://ftth:change-me@localhost:5432/ftth_copilot` | Sí | `packages/db/src/client.ts:11`, `scripts/setup.ts:245` | DSN de Prisma. `client.ts` busca un `.env` en 4 rutas candidatas si no está exportada |

Sin `DATABASE_URL` el build de Next.js igual compila (los resolvers de secretos son perezosos)
y el fallo aparece en la primera query.

## 2. Autenticación y cifrado

| Variable | Default | Obligatoria | Dónde se lee | Controla |
|---|---|---|---|---|
| `JWT_SECRET` | — | Sí en producción | `packages/db/src/auth.ts:24`, `apps/web/middleware/jwt-verify.ts:34` | Firma HS256 de la cookie de sesión. En producción `resolveSecret` **lanza** si falta (`auth.ts:26-29`) |
| `KMS_MASTER_KEY` | — | Sí en producción | `packages/db/src/crypto.ts:21` | Clave AES-256-GCM de las API keys de NMS en reposo. Lanza en producción (`crypto.ts:23-26`) |
| `SESSION_COOKIE_SECURE` | `false` | No | `packages/db/src/cookies.ts:11-14` | Flag `secure` de `ftth_session`. Si no está seteada, se deriva de `NODE_ENV === 'production'` |
| `SEED_ADMIN_PASSWORD` | aleatorio (12 bytes base64url) | No | `packages/db/prisma/seed.ts:305` | Contraseña del admin que crea el seed |
| `ALLOW_PRODUCTION_SEED` | — | Sí para seedear en prod | `packages/db/prisma/seed.ts:292` | Sin esta variable el seed **se niega** a correr en producción (`seed.ts:296-301`) |

## 3. Runtime

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `NODE_ENV` | `development` | `packages/db/src/{client,auth,crypto,cookies}.ts`, `apps/web/middleware.ts:289` | Fail-fast de secretos, cookie `secure`, HSTS, deshabilita el conector demo (`apps/web/lib/connectors/chat-client.ts:144`) |
| `PORT` | `3001` | `docker-compose.prod.yml:62`, `docker-compose.demo.yml:117` | Mapping de puertos. El código del repo **no** lo lee; `apps/web/package.json:7` lo fija en 3001 |

## 4. Cuotas y rate limits

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `CHAT_RATE_LIMIT_PER_MINUTE` | `10` | `apps/web/lib/rate-limit.ts:25` | Consultas de chat por minuto |
| `CHAT_DAILY_QUOTA` | `200` | `apps/web/lib/rate-limit.ts:26` | Consultas de chat por día |
| `INVESTIGATION_RATE_LIMIT_PER_MINUTE` | `10` | `apps/web/lib/investigations/quota.ts:29` | Investigaciones por minuto |
| `INVESTIGATION_DAILY_QUOTA` | `100` | `apps/web/lib/investigations/quota.ts:30` | Investigaciones por día |
| `AUTH_RATE_LIMIT_MAX` | `10` | `apps/web/lib/auth/server.ts:58` | Intentos de login/signup por ventana |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` | `apps/web/lib/auth/server.ts:59` | Ventana anti brute-force (15 min) |

## 5. Conectores NMS

| Variable | Default | Obligatoria | Dónde se lee | Controla |
|---|---|---|---|---|
| `SMARTOLT_USE_MOCK` | `true` | No | `packages/agent-core/src/tools/index.ts:389` | El mock es el default; sólo el literal `'false'` habilita llamadas reales |
| `SMARTOLT_API_BASE_URL` | `https://api.smartolt.com` | Sí si mock=false | `packages/connectors/smartolt/src/client.ts:73` | Base URL del SmartOLT |
| `SMARTOLT_API_KEY` | — | Sí si mock=false | `packages/connectors/smartolt/src/client.ts:73` | Se envía como header `X-Token` (`client.ts:81`) |
| `MIKROWISP_API_BASE_URL` | `https://demo.mikrowisp.com/api/v1` | — | **No se lee en el código** | Mikrowisp se configura por fila `NmsConnection` en la base |
| `MIKROWISP_TOKEN` | — | — | **No se lee en el código** | Ídem |

### Política de red saliente (`packages/connectors/core/src/security.ts`)

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `NMS_REQUEST_TIMEOUT_MS` | `10000` | `packages/connectors/core/src/security.ts:5` | Timeout de las requests al NMS |
| `NMS_ALLOWED_PORTS` | `443` | `security.ts:105` | Puertos destino permitidos |
| `NMS_ALLOWED_HOSTS` | vacío | `security.ts:66` | Allowlist exacta de hosts. Vacío ⇒ no se aplica allowlist |
| `NMS_ALLOW_HTTP` | `false` | `security.ts:81` | `true` habilita `http:`; si no, HTTPS obligatorio (`security.ts:83` lanza) |
| `NMS_ALLOW_PRIVATE_NETWORKS` | `false` | `security.ts:114` | `true` saltea el bloqueo de IPs privadas (RFC1918) |

## 6. LDAP / Active Directory (`packages/soc/src/auth-ldap.ts`)

| Variable | Default | Obligatoria | Dónde se lee | Controla |
|---|---|---|---|---|
| `LDAP_ENABLED` | `false` | No | `packages/soc/src/auth-ldap.ts:62` | Habilita login LDAP (`'true'` exacto) |
| `LDAP_URL` | `ldap://localhost:389` | Sí si enabled | `auth-ldap.ts:85` | URL del directorio |
| `LDAP_BIND_DN` | — | Sí si enabled | `auth-ldap.ts:86` | DN de servicio. Falta ⇒ `LDAP not configured` (`auth-ldap.ts:238`) |
| `LDAP_BIND_PASSWORD` | — | Sí si enabled | `auth-ldap.ts:87` | Password de bind; vacío se rechaza antes de tocar el directorio (`auth-ldap.ts:242`) |
| `LDAP_SEARCH_BASE` | — | Sí si enabled | `auth-ldap.ts:88` | Base de búsqueda |
| `LDAP_USER_FILTER` | `(uid={username})` | No | `auth-ldap.ts:89` | Filtro RFC-2254. Para AD: `(sAMAccountName={username})` |
| `LDAP_EMAIL_ATTR` | `mail` | No | `auth-ldap.ts:90` | Atributo de email |
| `LDAP_NAME_ATTR` | `cn` | No | `auth-ldap.ts:91` | Atributo de nombre |
| `LDAP_GROUP_ATTR` | `memberOf` | No | `auth-ldap.ts:92` | Atributo de grupos |
| `LDAP_ROLE_MAP` | mapa embebido | No | `auth-ldap.ts:73` | Pares `CN=Group:ROLE`; gana el último match |

## 7. Receptor SNMP (`apps/web/lib/monitoring/snmp.ts`)

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `SNMP_RECEIVER_ENABLED` | `false` | `apps/web/lib/monitoring/snmp.ts:42`, `apps/web/instrumentation.ts:23` | Si está apagado, el receptor no abre socket |
| `SNMP_UDP_PORT` | `1162` | `snmp.ts:63` | Puerto UDP de escucha |
| `SNMP_MAX_PAYLOAD_BYTES` | `2048` | `snmp.ts:73` | Datagramas más grandes se descartan |
| `SNMP_MAX_EVENTS_PER_MINUTE` | `1000` | `snmp.ts:74` | Techo de ingesta (ventana de 60 s) |
| `SNMP_DEDUP_WINDOW_MS` | `5000` | `snmp.ts:76` | Supresión de trampas duplicadas |
| `SNMP_DISABLE_AUTH` | `false` | `snmp.ts:78` | Deshabilita la autorización del emisor |
| `SNMP_SENDER_REGISTRY_JSON` | vacío | `snmp.ts:55` | Registro de emisores. Un JSON inválido se registra como error y sigue con cero registros (`snmp.ts:57`) |
| `SNMP_BIND_ADDRESS` | `0.0.0.0` | `snmp.ts:64` | Host de bind (no está en `.env.example`) |

## 8. Receptor syslog / SOC (`apps/web/lib/monitoring/syslog.ts`)

| Variable | Default | Obligatoria | Dónde se lee | Controla |
|---|---|---|---|---|
| `SYSLOG_RECEIVER_ENABLED` | `false` | No | `apps/web/lib/monitoring/syslog.ts:37` | Debe ser exactamente `'true'` |
| `SYSLOG_TENANT_ID` | — | **Sí** si enabled | `syslog.ts:36` | Atribución del tenant. Sin tenant **el receptor queda inerte** |
| `SYSLOG_UDP_PORT` | `5514` | No | `syslog.ts:47` | Puerto UDP |
| `SYSLOG_DETECTION_INTERVAL_MS` | `60000` | No | `syslog.ts:130` | Barrido de detección |
| `SYSLOG_MAX_MESSAGE_LENGTH` | `2000` | No | `syslog.ts:68` | Límite de longitud almacenada (defensa DoS) |
| `SYSLOG_MAX_EVENTS_PER_MINUTE` | `1000` | No | `syslog.ts:70` | Datagramas excedentes se descartan |
| `SYSLOG_RECV_BUFFER_BYTES` | `4194304` | No | `syslog.ts:54` | Buffer de recepción del kernel |

## 9. Auditoría de firmware y colección FEC (`apps/web/lib/monitoring/scheduler.ts`)

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `FIRMWARE_AUDIT_ENABLED` | `false` | `apps/web/lib/monitoring/scheduler.ts:322` | Arranca el loop de auditoría de firmware |
| `FIRMWARE_AUDIT_INTERVAL_MS` | `86400000` | `scheduler.ts:328` | Cadencia (24 h) |
| `FIRMWARE_AUDIT_VULNERABLE_LIST` | vacío | `scheduler.ts:193` | Allowlist de firmware vulnerable. Vacío o inválido ⇒ baseline embebido |
| `FEC_COLLECTION_ENABLED` | `false` | `scheduler.ts:373` | Habilita la recolección óptica FEC |
| `FEC_COLLECTION_INTERVAL_MS` | `3600000` | `scheduler.ts:375` | Cadencia (1 h) |
| `FEC_FAN_OUT_PER_CYCLE` | `8` | `scheduler.ts:376` | ONUs muestreadas por ciclo |
| `FEC_RATE_LIMIT_PER_HOUR` | `15` | `scheduler.ts:377` | Presupuesto de requests al NMS por hora |

## 10. Observabilidad

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `METRICS_POLLER_ENABLED` | `false` | `apps/web/lib/monitoring/scheduler.ts:290` | Arranca el poller proactivo |
| `METRICS_POLL_INTERVAL_MS` | `900000` | `scheduler.ts:296` | Cadencia del poll (15 min) |
| `METRICS_RETENTION_DAYS` | `30` | `scheduler.ts:234` | Retención de `MetricSample` |
| `METRICS_SAMPLE_OLT_DETAIL` | `false` | `scheduler.ts:245` | Fan-out a `getOltDetail()` por OLT |
| `METRICS_BEARER_TOKEN` | vacío | `apps/web/app/api/metrics/route.ts:18` | Si está seteado, `/api/metrics` exige `Bearer`. Si no, queda abierto |
| `VICTORIAMETRICS_URL` | `http://localhost:8428` | `apps/web/app/api/vm/{query,instant}/route.ts` | Base de la API de VictoriaMetrics |
| `VICTORIAMETRICS_TOKEN` | vacío | `apps/web/app/api/ops/{anomalies,stream,capacity}/route.ts` | Bearer para la API de VM. **No está en `.env.example`** |
| `PHOENIX_COLLECTOR_ENDPOINT` | vacío | `packages/agent-core/src/telemetry/exporter.ts:83` | Endpoint OTLP de Arize Phoenix. Vacío ⇒ no exporta |
| `PHOENIX_PROJECT_NAME` | `ftth-copilot` | `packages/agent-core/src/telemetry/exporter.ts:84` | Nombre de proyecto en los spans |
| `LOG_LEVEL` | `info` | **No se lee en el código** | `apps/web/lib/logging.ts:8` deriva el nivel del status HTTP |

## 11. Alertas y notificaciones

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `ALERT_WEBHOOK_URL` | vacío | `apps/web/lib/monitoring/scheduler.ts:234` | Webhook saliente de alertas |
| `ALERT_COOLDOWN_MS` | `3600000` | `scheduler.ts:242` | Cooldown de re-notificación (1 h) |
| `ALERT_RESOLVE_AFTER_MS` | `86400000` | `scheduler.ts:243` | Auto-resolución de alerta sin finding (24 h) |
| `ALERT_ESCALATE_AFTER_MS` | `14400000` | `scheduler.ts:244` | Escalado de warning a critical (4 h) |
| `TELEGRAM_BOT_TOKEN` | vacío | `scheduler.ts:226` | Token del bot. El canal se construye **sólo** si hay token **y** chat id (`scheduler.ts:236`) |
| `TELEGRAM_CHAT_ID` | vacío | `scheduler.ts:226` | Chat destino |
| `SLACK_WEBHOOK_URL` | — | `scheduler.ts:228` | Canal Slack (no está en `.env.example`) |
| `WHATSAPP_API_URL` / `WHATSAPP_RECIPIENT` / `WHATSAPP_API_KEY` | — | `scheduler.ts:229-231` | Canal WhatsApp (no están en `.env.example`) |
| `NTFY_SERVER_URL` | `https://ntfy.sh` | `packages/soc/src/notify.ts:276` | Servidor ntfy. El topic sale del `target` del canal en la base |
| `NTFY_DEFAULT_TOPIC` | `ftth-alerts` | **No se lee en el código** | — |

## 12. Proveedores LLM (`packages/agent-core/src/llm.ts`)

| Variable | Default | Obligatoria | Dónde se lee | Controla |
|---|---|---|---|---|
| `LLM_PROVIDER` | — | Sí para chat | `packages/agent-core/src/llm.ts:350` | `minimax`, `deepseek` o `qwen`. Si hay `LLM_FALLBACK`, el fallback gana (`llm.ts:350`) |
| `LLM_FALLBACK` | — | No | `llm.ts:350` | Cadena de fallback separada por comas. Sólo para errores transitorios (429/5xx/red) (`llm.ts:339-355`) |
| `MINIMAX_API_KEY` | — | Sí si `minimax` | `llm.ts:374` | Se considera inválida si contiene `your-key-here` o `replace-with` (`llm.ts:360-366`) |
| `MINIMAX_BASE_URL` | `https://api.minimax.io/anthropic` | No | `llm.ts:376` | API estilo Anthropic |
| `MINIMAX_MODEL` | `MiniMax-M3` | No | `llm.ts:375` | Modelo |
| `DEEPSEEK_API_KEY` | — | Sí si `deepseek` | `llm.ts:381` | — |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | No | `llm.ts:383` | API estilo OpenAI |
| `DEEPSEEK_MODEL` | `deepseek-chat` | No | `llm.ts:382` | Modelo |
| `QWEN_API_KEY` | — | Sí si `qwen` | `llm.ts:388` | — |
| `QWEN_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | No | `llm.ts:390` | API estilo OpenAI |
| `QWEN_MODEL` | `qwen-plus` | No | `llm.ts:389` | Modelo |

Sin proveedor configurado, `createLlmClient` lanza `No hay proveedor LLM configurado`
(`llm.ts:427-429`).

## 13. Capa de decisión Laya (`packages/shared/src/laya-shadow.ts`, `laya-client.ts`)

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `LAYA_ENABLED` | `false` | `packages/shared/src/laya-shadow.ts:205` | Master switch; sólo el literal `'true'` habilita |
| `LAYA_MODE` | `shadow` | `laya-shadow.ts:206` | `shadow` / `assisted` / `automatic` / `disabled` |
| `LAYA_FAIL_OPEN` | `true` | `laya-shadow.ts:207` | `!== 'false'` ⇒ si Laya no responde, se sigue con el pipeline actual |
| `LAYA_CONFIDENCE_THRESHOLD_HIGH` | `0.95` | `laya-shadow.ts:208` | Umbral alto (modo assisted) |
| `LAYA_CONFIDENCE_THRESHOLD_LOW` | `0.75` | `laya-shadow.ts:209` | Umbral bajo |
| `LAYA_MIN_CONFIDENCE` | `0.75` | `laya-shadow.ts:222` | Confianza mínima para influir en el routing |
| `LAYA_SUGGEST_ROUTE` | `false` | `laya-shadow.ts:223` | Si Laya puede sugerir una ruta |
| `LAYA_ALLOW_DIRECT_ROUTING` | `false` | `laya-shadow.ts:224` | Permite routing directo en modo automático |
| `LAYA_MODEL` | `laya-multilingual` | `packages/shared/src/laya-client.ts:58` | Identificador del modelo |
| `LAYA_MODEL_VERSION` | `1.0.0` | `laya-client.ts:59` | Versión del modelo |
| `LAYA_URL` | `http://localhost:8080` | `laya-client.ts:370` | URL del microservicio. Sólo hace falta en modo HTTP: el modo módulo no la usa |
| `LAYA_TIMEOUT_MS` | `250` | `laya-client.ts:55` | Timeout de la llamada HTTP |
| `LAYA_LOG_LEVEL` | `info` | `laya-shadow.ts:363` | Sólo `'debug'` tiene efecto (fuerza logging en producción) |

## 14. Flags de producto

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `TRUTH_GATE_MODE` | `strict` | `apps/web/app/api/chat/route.ts:50`, `packages/agent-core/src/runtime.ts:314` | Sólo `'observe'` o `'strict'`; cualquier otro valor cae a `strict`. La política por tenant tiene precedencia (`runtime.ts:314`) |
| `MAINTENANCE_REEVAL_ENABLED` | `false` | `apps/web/app/api/maintenance-windows/[id]/reevaluate/route.ts:39` | Si está apagado el endpoint devuelve 503 |
| `FTTH_SIMULATOR_ALLOW_PROVISIONAL` | `false` | `packages/monitoring/src/snmp/catalog.ts:75` | Trampas provisionales del simulador. En producción **lanza** (`catalog.ts:63`) |
| `ENABLE_TEST_AUTH_BYPASS` | `false` | `apps/web/middleware.ts:68` | Bypass de auth+RBAC para tests. Sólo CI |
| `DEMO_MODE_ENABLED` | `true` | `apps/web/lib/connectors/chat-client.ts:144` | Fixtures en lugar de NMS real, **sólo** si `NODE_ENV !== 'production'` |
| `EVENT_SPOOL_DIR` | `<cwd>/.spool` | `apps/web/lib/monitoring/event-ingest.ts:28` | Directorio del spool de ingesta durable |

## 15. Backup

| Variable | Default | Dónde se lee | Controla |
|---|---|---|---|
| `BACKUP_RETENTION_DAYS` | `30` | `scripts/db-backup.sh:24` | Retención de backups diarios |
| `BACKUP_RETENTION_WEEKS` | `12` | `scripts/db-backup.sh:25` | Retención de backups semanales |
| `BACKUP_DIR` | `./backups` | `scripts/db-backup.sh:26` | Directorio local de backups |
| `BACKUP_ENABLED` | — | **No se lee en el código** | El servicio systemd `docker/vmbackup.service` usa otros nombres (`BACKUP_INTERVAL`, `BACKUP_DEST`, `RETENTION_DAYS`) |

## 16. Sólo build

| Variable | Dónde se lee | Controla |
|---|---|---|
| `NEXT_OUTPUT_MODE` | `apps/web/next.config.mjs:15` | `export` genera salida estática; `standalone` genera el bundle de Docker |
| `NEXT_PUBLIC_API_URL` | `apps/web/next.config.mjs:136` | URL de la API para las builds desktop/mobile |
| `NEXT_PUBLIC_PLATFORM` | `apps/web/next.config.mjs:89` | Marca la plataforma (`tauri`, etc.) |
| `NEXT_PUBLIC_DISABLE_PWA` | `apps/web/next.config.mjs:72` | Desactiva el service worker |
| `JWT_SECRET` (build arg) | `Dockerfile:30` | Se **inlinea** en el bundle Edge del middleware |

## Resumen de obligatoriedad

- **Bloquean el arranque en producción**: `JWT_SECRET`, `KMS_MASTER_KEY`.
- **Bloquean la función que activan**: `DATABASE_URL` (toda query), `LLM_PROVIDER` + una API key (chat), `SYSLOG_TENANT_ID` (receptor syslog), `LDAP_BIND_DN`/`LDAP_SEARCH_BASE`/`LDAP_BIND_PASSWORD` (LDAP), `SMARTOLT_API_BASE_URL`/`SMARTOLT_API_KEY` (SmartOLT live).
- **Todo lo demás tiene default y arranca apagado** por diseño: ningún plano de vigilancia corre sin un flag explícito.
