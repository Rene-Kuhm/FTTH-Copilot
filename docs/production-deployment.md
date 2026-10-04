# Production Deployment Guide — FTTH-Copilot v0.2.2

> **Alcance:** este documento cubre el despliegue de producción del stack Docker de FTTH-Copilot.
> No cubre la configuración de red del ISP, el aprovisionamiento de OLTs ni la integración
> con sistemas externos más allá del NMS configurado.
>
> **Prerrequisito:** haber completado la [guía de inicio rápido](quickstart.md).

---

## 1. Arquitectura de producción

```
┌─────────────────────────────────────────────────────────┐
│                    Internet / ISP NMS                     │
└──────────────┬──────────────────────────────────────────┘
               │ HTTPS (puerto 443)
               ▼
        ┌──────────────────┐
        │  FTTH-Copilot    │  Next.js standalone (Docker)
        │  app (:3001)      │  + Receptor SNMP UDP 1162
        │                   │  + Receptor Syslog UDP 5514
        │  + Laya (module)  │  + Laya Decision Layer (<5ms)
        └────────┬──────────┘
                 │
       ┌─────────┴──────────┐
       ▼                   ▼
┌─────────────┐     ┌─────────────────────────────────────┐
│ PostgreSQL  │     │ VictoriaMetrics (:8428)              │
│  (:5432)   │     │ • TSDB (drop-in Prometheus)          │
│ persistent  │     │ • Built-in Grafana UI                │
└─────────────┘     │ • Prometheus-compatible API           │
                    │ • Phoenix LLM traces (OTLP :4317)    │
                    └─────────────────────────────────────┘
       │
       │  (optional: Docker microservice)
       ▼
┌─────────────┐
│ Laya Service │  FastAPI (:8080) — 0 contenedores si usás módulo
│  (:8080)    │
└─────────────┘
```

| Componente | Puerto | Volumen persistente | Descripción |
|---|---|---|---|
| `postgres` | 5432/TCP | `postgres_data` | Base de datos multi-tenant |
| `app` | 3001/TCP | — | Next.js (sin estado) |
| `db-migrate` | — | — | Corre migraciones y sale; ephemeral |
| `victoriametrics` | 8428/TCP | `victoriametrics_prod_data` | TSDB + VMUI + API Prometheus-compatible |
| `vmalert` | 8880/TCP (interno) | — | Evalúa recording/alerting rules; escribe series vía remote write |
| SNMP receiver | 1162/UDP | — | Solo si `SNMP_RECEIVER_ENABLED=true` |
| Syslog receiver | 5514/UDP | — | Solo si `SYSLOG_RECEIVER_ENABLED=true` |
| `laya` | 8080/TCP | — | FastAPI microservicio (opcional, profile=laya) |

---

## 1.1 Licencia de VictoriaMetrics

La imagen comunitaria `victoriametrics/victoria-metrics` se distribuye bajo
**AGPL-3.0**. FTTH-Copilot es software **propietario**.

Para mantener separación clara, la topología recomendada es la de la sección 1:
VictoriaMetrics corre como **proceso independiente** que FTTH-Copilot solo
consulta por HTTP (`:8428`), sin enlazarse ni embeberse en el binario de la app.

> ⚠️ Esta nota no es asesoramiento legal. Antes de un despliegue comercial,
> confirmá la forma de despliegue prevista con tu asesor legal. Si la
> distribución comercial no es viable, las alternativas son una suscripción
> corporativa de VictoriaMetrics o un TSDB con licencia permisiva.

---

## 2. Instalación en producción

### 2.1 Con `install.sh` (recomendado)

```bash
# Descargá el instalador
curl -fsSL https://raw.githubusercontent.com/Rene-Kuhm/FTTH-Copilot/main/install.sh | bash -s -- --non-interactive

# O con el repo local
./install.sh --non-interactive
```

El instalador pregunta por:
- Puerto público de la app (por defecto 3001)
- Provider de IA (opcional)
- Credenciales de PostgreSQL (o usa el generated)

### 2.1b Configuración HTTPS con Caddy (opcional)

Para producción pública se recomienda un reverse proxy con HTTPS. FTTH-Copilot
incluye `docker-compose.https.yml` con Caddy 2 (certificados automáticos Let's Encrypt):

```bash
# 1. Agregar al .env.prod:
CADDY_DOMAIN=ftth.tudominio.com
CADDY_EMAIL=admin@tudominio.com
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443

# 2. Usar el compose con HTTPS:
docker compose -f docker-compose.https.yml up -d
```

Caddy provisiona automáticamente el certificado TLS. No requiere cronjobs de
renovación ni configuración manual de certificados.

> Si ya tenés nginx, Traefik o Cloudflare como reverse proxy, podés usar
> `docker-compose.prod.yml` y terminate HTTPS en tu proxy existente.

### 2.2 Configuración mínima de `.env.prod`

```bash
# ── Seguridad: GENERAR con openssl rand -hex 32 ──────────────────────────────
JWT_SECRET=<32-byte-secret>
KMS_MASTER_KEY=<32-byte-secret>

# ── Base de datos ────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://ftth:<password>@postgres:5432/ftth_copilot
POSTGRES_USER=ftth
POSTGRES_PASSWORD=<strong-password>
POSTGRES_DB=ftth_copilot

# ── Producción: todas las flags de demo en OFF ─────────────────────────────
NODE_ENV=production
DEMO_MODE_ENABLED=false
ALLOW_PRODUCTION_SEED=false

# ── NMS real ────────────────────────────────────────────────────────────────
SMARTOLT_USE_MOCK=false
SMARTOLT_API_BASE_URL=https://api.smartolt.com
SMARTOLT_API_KEY=<real-api-key>

# ── Red: política estricta ──────────────────────────────────────────────────
NMS_ALLOWED_PORTS=443
NMS_ALLOW_PRIVATE_NETWORKS=false
NMS_ALLOW_HTTP=false

# ── Métricas y observabilidad ─────────────────────────────────────────────
METRICS_BEARER_TOKEN=<generate-with-openssl-rand-hex-32>

# ── LLM ────────────────────────────────────────────────────────────────────
LLM_PROVIDER=minimax  # o deepseek, qwen
MINIMAX_API_KEY=<real-key>

# ── Laya Decision Layer (ADR-042) ─────────────────────────────────────────
# Modo módulo (default, sin Docker): Laya corre dentro del proceso Node.js
LAYA_ENABLED=true
LAYA_MODE=shadow        # shadow → assisted → automatic (progresivo)
LAYA_FAIL_OPEN=true
LAYA_MIN_CONFIDENCE=0.75
LAYA_SUGGEST_ROUTE=false
LAYA_ALLOW_DIRECT_ROUTING=false

# Modo microservicio Docker (activar con --profile laya):
# docker compose --profile laya -f docker-compose.prod.yml up -d
# LAYA_URL=http://laya:8080
# LAYA_PORT=8080
```

### 2.3 Con Docker Compose directo

```bash
cp .env.example .env.prod
# Editá .env.prod con los valores de arriba
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

---

## 3. Backup

### 3.1 Backup de PostgreSQL

**Frecuencia recomendada:** cada 6 horas (cron), con retención de 7 días.

```bash
# Backup completo de la base
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres \
  pg_dump -U ftth ftth_copilot > backup_$(date +%Y%m%d_%H%M%S).sql

# Comprimir
gzip backup_20260920_120000.sql
```

**Script de backup diario (agregar a crontab):**

```bash
# crontab -e
0 */6 * * * docker compose --env-file /opt/ftth-copilot/.env.prod \
  -f /opt/ftth-copilot/docker-compose.prod.yml exec postgres \
  pg_dump -U ftth ftth_copilot | gzip > /var/backups/ftth-copilot/backup_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz
```

### 3.2 Backup de configuración

Los archivos que deben estar respaldados fuera del contenedor:

```bash
# Archivos de configuración
cp .env.prod /var/backups/ftth-copilot/config/
cp docker-compose.prod.yml /var/backups/ftth-copilot/config/
cp .env /var/backups/ftth-copilot/config/ 2>/dev/null || true

# Carpeta de volúmenes Docker
tar czf /var/backups/ftth-copilot/volumes_$(date +%Y%m%d).tar.gz \
  /var/lib/docker/volumes/ftth-copilot_postgres_data
```

### 3.3 Verificación de backup

```bash
# Verificar integridad del dump
zcat backup_20260920_120000.sql.gz | head -5

# Verificar que la base se restorea correctamente
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres \
  pg_restore --dbname=ftth_copilot_test --clean backup.sql.gz
```

---

## 4. Restore

### 4.1 Restore desde backup

```bash
# 1. Detener la app
docker compose --env-file .env.prod -f docker-compose.prod.yml stop app

# 2. Restore de la base (reemplaza datos existentes)
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres \
  psql -U ftth ftth_copilot -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c backup_20260920_120000.sql.gz | \
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  psql -U ftth ftth_copilot

# 3. Reiniciar la app
docker compose --env-file .env.prod -f docker-compose.prod.yml start app
```

### 4.2 Disaster recovery (volumen destruido)

```bash
# 1. Recrear el volumen vacío
docker compose --env-file .env.prod -f docker-compose.prod.yml down
docker volume rm ftth-copilot_postgres_data
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres

# 2. Restaurar backup
gunzip -c backup_latest.sql.gz | \
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
  psql -U ftth ftth_copilot

# 3. Correr migraciones (por si hay nuevas)
docker compose --env-file .env.prod -f docker-compose.prod.yml up db-migrate

# 4. Iniciar la app
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d app
```

### 4.3 Verificación post-restore

```bash
# Verificar que la base responde
curl -s http://localhost:3001/api/health | jq .

# Verificar que las sesiones y usuarios están intactos
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres \
  psql -U ftth ftth_copilot -c "SELECT COUNT(*) FROM users;"
```

---

## 5. Observabilidad

### 5.1 Health endpoint

```bash
curl -s http://localhost:3001/api/health | jq .
# Respuesta esperada:
{
  "status": "ok",
  "database": "ok",
  "version": "0.1.0"
}
```

### 5.2 Métricas con VictoriaMetrics

VictoriaMetrics scrapea el endpoint `/api/metrics` de la app cada 30s. La
frecuencia y el timeout se declaran en `docker/victoriametrics-scrape.yml`
(`scrape_interval` / `scrape_timeout`), no en flags de línea de comandos.

**Acceso a la UI de métricas:**
```bash
# UI de VictoriaMetrics (VMUI, integrada — no requiere Grafana)
open http://localhost:8428

# Consulta Prometheus-compatible
curl -G http://localhost:8428/api/v1/query \
  --data-urlencode 'query=ftth_copilot_router_dispatches_total'

# Estado del scrape (confirmá health=up y samples scrapeadas)
curl -s http://localhost:8428/api/v1/targets | jq '.data.activeTargets[0] | {health, lastError, lastSamplesScraped}'

# Series almacenadas
curl -s http://localhost:8428/api/v1/label/__name__/values | jq '.data | length'
```

**Métricas publicadas por `/api/metrics`:**

| Métrica | Labels | Descripción |
|---|---|---|
| `ftth_copilot_process_uptime_seconds` | — | Uptime del proceso |
| `ftth_copilot_process_memory_bytes` | `type` | Memoria por tipo (`rss`, `heap_total`, `heap_used`, `external`) |
| `ftth_copilot_tenants_total` | — | Tenants registrados |
| `ftth_copilot_metric_samples_total` | — | Muestras de métricas ingestadas |
| `ftth_copilot_router_dispatches_total` | `mode` | Dispatches del Organic Diagnostic Router por modo |
| `ftth_copilot_llm_requests_total` | `provider`, `status` | Llamadas LLM solicitadas |
| `ftth_copilot_llm_tokens_total` | `provider`, `type` | Tokens consumidos por provider |
| `ftth_copilot_llm_latency_seconds_count` | `provider` | Muestra de latencia LLM (usar con `_sum` para p50/p95) |
| `ftth_copilot_llm_fallback_events_total` | `primary`, `fallback` | Caídas al proveedor de respaldo |
| `ftth_copilot_nms_connections_total` | `provider` | Conexiones a NMS por proveedor |
| `ftth_copilot_snmp_traps_total` | `status` | Trampas SNMP por `received`/`deduped`/`dropped` |
| `ftth_copilot_active_alerts` | `severity`, `status` | Alertas activas |
| `ftth_copilot_active_incidents` | — | Incidentes activos |
| `ftth_copilot_rag_retrievals_total` | `status` | Recuperaciones RAG por estado |
| `ftth_copilot_rag_latency_seconds_count` | — | Muestra de latencia RAG |

> Las series de **Laya Decision Layer** (`ftth_laya_*`) solo aparecen cuando la
> capa registra decisiones. Con `LAYA_MODE=disabled` no se emiten; verificá el
> modo efectivo antes de alertar sobre ellas.

**Agregar como datasource en Grafana (si ya tenés Grafana):**
```
URL: http://victoriametrics:8428
Access: Server (default)
Auth: With credentials (si usás bearer)
Custom HTTP Headers:
  Header: Authorization
  Value: Bearer <METRICS_BEARER_TOKEN>
```

### 5.3 Configuración del scraping

El scrape se define en un único lugar versionado:
[`docker/victoriametrics-scrape.yml`](../docker/victoriametrics-scrape.yml).

```yaml
# docker/victoriametrics-scrape.yml (extracto)
global:
  scrape_interval: 30s
  scrape_timeout: 10s
  external_labels:
    service: ftth-copilot
scrape_configs:
  - job_name: ftth-copilot-app
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials: "__METRICS_BEARER_TOKEN__"
    static_configs:
      - targets: ["__SCRAPE_TARGET__"]
```

Dos cosas que conviene saber antes de editarlo:

1. **El binario single-node no expande `${VAR}`.** Por eso el archivo usa
   marcadores `__SCRAPE_TARGET__` / `__METRICS_BEARER_TOKEN__` / `__DEPLOY_ENV__`
   que [`docker/victoriametrics-entrypoint.sh`](../docker/victoriametrics-entrypoint.sh)
   renderiza con `awk` antes de arrancar el servidor. La imagen no incluye
   `envsubst`.
2. **Los atajos `-scrape.url` / `-scrape.interval` no existen en single-node.**
   Son flags de `vmagent`. El servidor single-node acepta `-promscrape.config`
   con este schema Prometheus.

**Validar el config antes de desplegar:**
```bash
# Scrape config
docker compose -f docker-compose.prod.yml run --rm --no-deps \
  -e VM_CONFIG_DRYRUN=1 victoriametrics

# Reglas (vmalert valida el PromQL y las expresiones)
docker run --rm -v "$PWD/docker/victoriametrics-alerts.yml:/rules.yml:ro" \
  --entrypoint /vmalert-prod victoriametrics/vmalert:v1.153.0 \
  -rule=/rules.yml -datasource.url=http://victoriametrics:8428 -dryRun
```

**Si necesitás scrape a escala (miles de targets),** corré `vmagent` como
servicio aparte y que envíe por remote write:
```bash
vmagent -promscrape.config=/etc/vmagent/scrape.yml \
        -remoteWrite.url=http://victoriametrics:8428
```

### 5.4 Recording rules y alertas (vmalert)

**VictoriaMetrics single-node no evalúa reglas PromQL.** Solo expone
`-streamAggr.config` (downsampling) y puede proxear APIs de reglas a un
`vmalert` externo. Por eso las reglas viven en
[`docker/victoriametrics-alerts.yml`](../docker/victoriametrics-alerts.yml) y las
corre el servicio `vmalert` (incluido en `docker-compose.prod.yml`, y en el
demo con `--profile alerts`).

```bash
# Levantar con reglas en el demo
docker compose -f docker-compose.demo.yml --profile alerts up -d

# Ver reglas, su salud y valores evaluados
docker exec ftth_demo_victoriametrics \
  wget -qO- http://vmalert:8880/api/v1/rules
```

**8 recording rules** — pre-agregan lo que las alertas y los gráficos repiten:

| Serie | Qué mide |
|---|---|
| `ftth_router_dispatch_ratio:mode15m` | Proporción de dispatches por modo del router |
| `ftth_router_dispatches:rate1h` | Dispatches totales por hora |
| `ftth_llm_requests:rate5m` | Tasa de llamadas LLM por provider y resultado |
| `ftth_llm_latency_seconds:avg15m` | Latencia LLM media por provider |
| `ftth_llm_fallback:rate15m` | Caídas al proveedor de respaldo |
| `ftth_snmp_traps:rate15m` | Trampas SNMP por resultado |
| `ftth_ops_active:alerts` | Alertas activas por severidad |
| `ftth_ops_active:incidents` | Incidentes activos |

**7 alerting rules** — la primera es la que protege a todas las demás:

| Alerta | Severidad | Condición |
|---|---|---|
| `FTTHCopilotMetricsTargetDown` | critical | El scrape de `/api/metrics` lleva 2 min fallando |
| `FTTHCopilotProcessRestarting` | warning | Uptime reinició >2 veces en 30 min |
| `FTTHCopilotLLMFallbackSustained` | warning | >5 fallbacks de provider en 15 min |
| `FTTHCopilotLLMErrors` | warning | Llamadas LLM con resultado no-ok en 10 min |
| `FTTHCopilotRouterInvestigationDominant` | warning | >80% de dispatches van a `investigation` |
| `FTTHCopilotSNMPTrapsDropped` | warning | Trampas descartadas en 15 min |
| `FTTHCopilotActiveIncidentsHigh` | critical | >10 incidentes activos |

> `FTTHCopilotRouterInvestigationDominant` vigila la premisa de diseño del
> router: las consultas de un solo dispositivo deberían resolverse en `direct`
> sin gastar LLM. Si `investigation` domina de forma sostenida, o la
> clasificación de intención regresionó, o el tenant está preguntando cosas que
> las tools directas no cubren.

**Notificación.** `vmalert` corre sin canal de salida por defecto: las alertas se
evalúan y quedan visibles en `/api/v1/rules`, pero no se envían a nadie. Para
notificar, montá un notifier config y agregá el flag:

```yaml
# docker/vmalert-notifier.yml (ejemplo webhook)
notifiers:
  - notifier:
      type: webhook
      url: https://tu-webhook.example/hooks/xyz
```

```yaml
# docker-compose.prod.yml → servicio vmalert
volumes:
  - ./docker/vmalert-notifier.yml:/etc/vmalert/notifier.yml:ro
command:
  - '-notifier.config=/etc/vmalert/notifier.yml'
```

### 5.5 Phoenix LLM Tracing

```bash
# Activar trazas OpenInference
PHOENIX_COLLECTOR_ENDPOINT=http://<phoenix-host>:6006/v1/traces
PHOENIX_PROJECT_NAME=ftth-copilot
```

Trazas exportadas: `agent.run`, `llm.*`, `retrieval.*`, `tool.*`, `investigation.engine`. Credenciales y secrets son redactados antes de la transmisión.

---

## 6. Seguridad

### 6.1 Checklist de hardening

| Acción | Estado | Notas |
|---|---|---|
| `JWT_SECRET` generado con `openssl rand -hex 32` | ☐ | Nunca默认值 ni credenciales triviales |
| `KMS_MASTER_KEY` generado con `openssl rand -hex 32` | ☐ | Nunca默认值 |
| `DEMO_MODE_ENABLED=false` | ☐ | Verificar en `.env.prod` |
| `ALLOW_PRODUCTION_SEED=false` | ☐ | Verificar en `.env.prod` |
| `NMS_ALLOWED_HOSTS` configurado con dominios разрешенные | ☐ | Producción debe tener lista explícita |
| `NMS_ALLOW_PRIVATE_NETWORKS=false` | ☐ | Solo redes públicas разрешенные |
| `NMS_ALLOWED_PORTS=443` | ☐ | Sin HTTP ni otros puertos |
| Puerto SNMP (1162) no expuesto a Internet | ☐ | Solo desde red de gestión de OLTs |
| Puerto Syslog (5514) no expuesto a Internet | ☐ | Solo desde red de gestión |
| `METRICS_BEARER_TOKEN` generado y almacenado de forma segura | ☐ | Rotar si se expone |
| Conexión a PostgreSQL por red interna | ☐ | No exponer puerto 5432 a Internet |
| Firewall: solo puertos 3001, 8428, 1162, 5514 разрешены | ☐ | 8428 = VictoriaMetrics UI; proteger con reverse proxy + auth si se expone |
| HTTPS configurado con Caddy o reverse proxy propio | ☐ | Usar `docker-compose.https.yml` o terminación TLS propia |
| `CADDY_EMAIL` configurado en `.env.prod` | ☐ | Para notificaciones de vencimiento de certificado |
| Dominio apontado a DNS antes de levantar Caddy | ☐ | Caddy necesita DNS resuelto para generar certificados |

### 6.2 Rotación de credenciales

**JWT_SECRET:**

```bash
# 1. Generar nueva clave
NEW_SECRET=$(openssl rand -hex 32)

# 2. Actualizar .env.prod
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .env.prod

# 3. IMPORTANTE: esto invalida todas las sesiones activas
#   Los usuarios necesitarán iniciar sesión nuevamente
docker compose --env-file .env.prod -f docker-compose.prod.yml restart app
```

**KMS_MASTER_KEY:**

```bash
# 1. Generar nueva clave
NEW_KEY=$(openssl rand -hex 32)

# 2. Actualizar .env.prod
sed -i "s/^KMS_MASTER_KEY=.*/KMS_MASTER_KEY=$NEW_KEY/" .env.prod

# 3. Las claves API de conectores cifradas con la clave vieja
#   no podrán ser descifradas — reconfigurar los conectores después del restart
docker compose --env-file .env.prod -f docker-compose.prod.yml restart app
```

**Contraseña de PostgreSQL:**

```bash
# 1. Generar nueva contraseña
NEW_PG_PASSWORD=$(openssl rand -hex 16)

# 2. Actualizar PostgreSQL
docker compose --env-file .env.prod -f docker-compose.prod.yml exec postgres \
  psql -U ftth -c "ALTER USER ftth WITH PASSWORD '$NEW_PG_PASSWORD';"

# 3. Actualizar .env.prod
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$NEW_PG_PASSWORD/" .env.prod

# 4. Restart
docker compose --env-file .env.prod -f docker-compose.prod.yml restart app
```

### 6.3 Auditoría de secretos

Si un secreto se expone:

1. **Rotar inmediatamente** (el secreto anterior ya no es válido)
2. **Revocar acceso** del sistema o servicio afectado
3. **Verificar logs** por uso no autorizado (`docker compose logs app --since=1h`)
4. **Documentar** el incidente en el registro de seguridad

---

## 7. Gestión operativa

### 7.1 Verificación de estado

```bash
# Estado de todos los servicios
docker compose --env-file .env.prod -f docker-compose.prod.yml ps

# Logs en tiempo real
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f app

# Health check
curl -s http://localhost:3001/api/health
```

### 7.2 Upgrade

```bash
# 1. Backup de la base (ver sección 3)
# 2. Actualizar imagen
docker compose --env-file .env.prod -f docker-compose.prod.yml pull

# 3. Correr migraciones (automático con db-migrate si está configurado)
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db-migrate

# 4. Reiniciar la app
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d app
```

### 7.3 Reinicio completo

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml restart
```

### 7.4 Escalado

FTTH-Copilot es **sin estado** a nivel de app (el estado está en PostgreSQL).
Para escalar horizontalmente:

```bash
# Agregar más réplicas de la app
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --scale app=3
```

> **Nota:** múltiples réplicas comparten la misma base PostgreSQL. Asegurate de que
> las conexiones concurrentes estén dentro del límite de PostgreSQL.

---

## 8. Runbook de emergencia

| Escenario | Acción |
|---|---|
| La app no responde | `docker compose restart app`; verificar `docker compose logs app` |
| Base de datos no responde | `docker compose restart postgres`; verificar health |
| Migración fallida | `docker compose up db-migrate`; verificar `docker compose logs db-migrate` |
| Credencial expuesta | Rotar inmediatamente (sección 6.2); revisar logs |
| Volumen de base destruido | Disaster recovery (sección 4.2) |
| Puerto 3001 ocupado | Cambiar `PORT` en `.env.prod` y reiniciar |
| Error "Refusing to seed in production" | Verificar `NODE_ENV=production` + `ALLOW_PRODUCTION_SEED=false` en `.env.prod` |
| Métricas no responden | Verificar que VictoriaMetrics esté corriendo (`docker compose ps`); `curl http://127.0.0.1:8428/health` desde el contenedor debe devolver `OK` (usar 127.0.0.1, no `localhost`: resuelve a `::1` y VM escucha solo IPv4); verificar que `METRICS_BEARER_TOKEN` coincide entre app y scrape config |
| Alertas/rules no cargan | `docker exec ftth_prod_victoriametrics wget -qO- http://vmalert:8880/api/v1/rules`. Cada regla trae `health` y `lastError`. Ojo: el single-node de VictoriaMetrics NO evalúa reglas; si quitás `vmalert`, no hay recording ni alerting. |
| Alertas evaluan pero no notifican | `vmalert` arranca sin canal de salida. Montá un notifier config y pasá `-notifier.config`; mientras tanto consultá `/api/v1/rules` directamente. |
