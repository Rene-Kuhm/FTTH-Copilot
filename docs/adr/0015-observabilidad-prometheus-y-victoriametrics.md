# ADR 0015 — Observabilidad con exposition Prometheus y VictoriaMetrics

**Estado:** Aceptada
**Fecha:** 2026-09 en adelante (`apps/web/lib/metrics/prometheus.ts`, `docker/victoriametrics-*`)

## Contexto

El producto se opera en un NOC. El operador de guardia necesita responder tres preguntas
en cualquier momento:

1. ¿El sistema está sano?
2. ¿Cuánto está costando (latencia, tokens) y a quién?
3. ¿Qué está pasando con la red?

Para la primera hace falta un endpoint de salud que no dependa de que la base esté sana.
Para la segunda y la tercera hacen falta series temporales: latencia del LLM, tokens,
retrieval RAG, alertas activas, incidentes activos, muestras, trampas SNMP, decisiones de
Laya, anomalías y capacidad.

El producto se instala en ISP de tamaños muy distintos: unos tienen un Prometheus y un
Grafana; otros no tienen nada y sólo pueden abrir el dashboard web. Y la instalación
tiene que ser de **un comando**, sin depender de un stack de observabilidad externo.

## Decisión

Exponer las métricas en **formato Prometheus** desde la propia aplicación, y usar
**VictoriaMetrics** como almacén de series temporales cuando el despliegue lo requiere.

### La exposition

- `GET /api/metrics` devuelve texto Prometheus (`text/plain; version=0.0.4`)
  (`apps/web/app/api/metrics/route.ts:17`).
- El acceso es **abierto por defecto** y se puede proteger con `METRICS_BEARER_TOKEN`: si
  está seteado, el endpoint exige el header `Bearer` y responde 401 si no coincide
  (`route.ts:18-34`). Si no está seteado, queda abierto — decisión deliberada, porque el
  endpoint no expone datos de negocio, sólo agregados de proceso.
- Las métricas se calculan en `apps/web/lib/metrics/prometheus.ts` (321 líneas) sin
  dependencias externas.

### Las familias publicadas

| Familia | Qué mide |
|---|---|
| `ftth_copilot_process_uptime_seconds` | Uptime del proceso |
| `ftth_copilot_process_memory_bytes` | RSS y heap |
| `ftth_copilot_tenants_total` | Tenants |
| `ftth_copilot_nms_connections_total` | Conexiones NMS por estado |
| `ftth_copilot_active_alerts` / `..._active_incidents` | Carga actual |
| `ftth_copilot_metric_samples_total` | Muestras recolectadas |
| `ftth_copilot_snmp_traps_total` | Trampas SNMP |
| `ftth_copilot_service_loop_healthy` | Salud de cada loop del scheduler |
| `ftth_copilot_database_scrape_error` | Error al consultar la base |
| `ftth_copilot_llm_requests_total` / `_tokens_total` / `_latency_seconds_total` | Consumo de LLM |
| `ftth_copilot_llm_fallback_events_total` | Fallbacks de proveedor |
| `ftth_copilot_rag_retrievals_total` / `_rag_latency_seconds_total` | Retrieval |
| `ftth_copilot_router_dispatches_total` | Despachos por modo del router |
| `ftth_laya_requests_total` / `_latency_ms` / `_confidence` | Decisiones de Laya |

### La salud

- `GET /api/health` (`apps/web/app/api/health/route.ts:27-58`) devuelve 200 con
  `{status, timestamp, uptime, memory, version, database, services, hungLoops, connections,
  ingest}` y **503** cuando está degradado.
- El middleware **exime** a `/api/health` de rate limit y de CSRF (`middleware.ts:121`): un
  health check no puede fallar por un 429.

### El almacén

- VictoriaMetrics (`victoria-metrics:v1.153.0`) entra en los compose de demo y producción,
  con `vmalert` y una retención por defecto de 12 meses
  (`docker-compose.prod.yml:130`).
- La API de la app **proxía** las consultas a VictoriaMetrics en lugar de exponerla:
  `GET /api/vm/query` y `GET /api/vm/instant` (`apps/web/app/api/vm/`), más
  `GET /api/ops/anomalies`, `/api/ops/capacity` y `/api/ops/stream`. Eso mantiene el token
  de VictoriaMetrics **en el servidor**.
- `apps/web/lib/metrics/prometheus.ts` alimenta el dashboard `/dashboard/metrics`, que
  funciona **sin** VictoriaMetrics: lee de la exposition propia.

### Telemetría de trazabilidad

- El agente emite spans OpenInference/OpenTelemetry
  (`packages/agent-core/src/telemetry/`), con exportador OTLP opcional hacia Arize Phoenix
  (`PHOENIX_COLLECTOR_ENDPOINT`, `PHOENIX_PROJECT_NAME`).
- El exportador **redacta** antes de exportar (`packages/agent-core/src/telemetry/redaction.ts`).

## Consecuencias

### Buenas

- **La aplicación es su propia fuente de métricas**: no hay que instalar un agente ni un
  exporter para tener observabilidad mínima.
- El **formato Prometheus** es estándar: cualquier stack existente la consume sin
  adaptadores.
- El **proxy de VictoriaMetrics** evita exponer el almacén y su token, y permite filtrar
  las consultas desde un solo lugar.
- El dashboard web `/dashboard/metrics` **funciona sin infraestructura extra**, lo que
  cubre al ISP chico.
- `ftth_copilot_service_loop_healthy` y `hungLoops` dan visibilidad sobre los loops
  del scheduler, que son el componente que más falla en silencio.
- La **redacción antes de exportar** evita mandar datos de red a un SaaS de terceros.
- El 503 en `/api/health` hace que un orquestador pueda reaccionar sin parsear el cuerpo.

### Malas

- **La exposition se calcula en cada request**, sin caché: el costo crece con el número de
  consultas a la base que hace cada scrape.
- `METRICS_BEARER_TOKEN` **vacío deja el endpoint abierto**. Para un ISP con la
  aplicación expuesta en la red del cliente, eso es una fuga de metadatos operativos.
- `/api/vm/query` y `/api/vm/instant` **no tienen autenticación** y aceptan PromQL
  arbitrario del query string: son un proxy abierto hacia el almacén de métricas.
- Las métricas son **agregadas y sin labels de tenant**: no se puede saber el consumo de
  LLM de un ISP concreto desde Prometheus.
- La telemetría de Phoenix es **opcional y desactivada por defecto**: sin
  `PHOENIX_COLLECTOR_ENDPOINT` no hay trazas, así que el debugging de un incidente de
  agentes depende de tener el exporter configurado de antemano.
- `/api/ops/stream` es un SSE con tick de 10 s y snapshot cada tercero: mantener muchas
  conexiones abiertas consume conexiones del servidor.

### Abiertas

- No hay **métricas por tenant**, lo que impide un desglose de costo por cliente.
- `ftth_copilot_llm_tokens_total` no distingue el token de entrada del de salida, que es
  la distinción que importa para el costo.
- No hay histogramas de latencia con buckets: las métricas de latencia son sólo
  `_total` y `_count`, y el percentil hay que calcularlo en el agregador.
