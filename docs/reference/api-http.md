# Referencia de la API HTTP

Todas las rutas viven en `apps/web/app/api/**/route.ts`. El prefijo `/api` es siempre
`http://<host>:3001/api` en desarrollo.

## Pipeline global de requests

`apps/web/middleware.ts` clasifica `/api/*` como `api` (`:94`): **el middleware nunca
aplica auth a las rutas de API**. Sólo aplica CSRF y rate limit; la autorización vive
dentro de cada handler.

| Paso | Comportamiento | Dónde |
|---|---|---|
| Health | `/api/health` sale antes de todo: sin rate limit, sin CSRF, sin headers de seguridad | `middleware.ts:121` |
| CSRF | `POST/PUT/DELETE/PATCH` exige header `X-CSRF-Token` igual a la cookie `ftth_csrf`. Sin match ⇒ **403** `{error:'Invalid CSRF token'}`. Exento: `/api/auth/*` | `middleware.ts:127` |
| Rate limit | `/api/auth/*` ⇒ 200 req/60 s; el resto ⇒ 100 req/60 s. Clave `tenant:<tenantId>` del JWT o `ip:<x-forwarded-for>` | `middleware.ts:146` |
| Límite excedido | **429** `{error:'Too many requests', retryAfter}` + `retry-after` y `x-ratelimit-reset` | `middleware/rate-limit.ts:128` |
| Headers de éxito | `x-ratelimit-remaining`, `x-ratelimit-reset` | `middleware.ts:168` |
| Seguridad | `nosniff`, `DENY` frame, `referrer-policy`, CSP, HSTS en producción | `middleware.ts:243` |

### CSRF en detalle

Cookie `ftth_csrf`: 32 bytes aleatorios en hex, `Path=/; SameSite=Strict; Max-Age=86400`
(`apps/web/lib/auth/csrf.ts:21`, `:106`). **No es `HttpOnly`** a propósito: el token no es
una credencial, tiene que ser legible por JS para que el cliente lo reenvíe. La cookie de
sesión `ftth_session`, en cambio, sí es `HttpOnly`.

Validación: comparación en tiempo constante entre cookie y header (`csrf.ts:55`). El cliente
`csrfFetch()` (`apps/web/lib/auth/csrf-client.ts:16`) adjunta el header sólo en métodos
mutantes y **lanza** si la cookie no está.

### Roles y permisos

`apps/web/lib/auth/permissions.ts:14-88`. Roles: `OWNER`, `ADMIN`, `OPERATOR`, `MEMBER`
(where `MEMBER` ≡ `OPERATOR`).

| Rol | Permisos |
|---|---|
| `OWNER` | Los 11 |
| `ADMIN` | Todos salvo `execute_actions` |
| `OPERATOR` / `MEMBER` | `chat`, `view_own_conversations`, `delete_conversations`, `view_network`, `ack_alerts`, `manage_incidents` |

La sesión se resuelve con `getCurrentUser()` (`apps/web/lib/auth/server.ts:409`): verifica el
JWT **y** que exista la fila `prisma.session` vigente.

---

## 1. Salud y métricas (públicas)

| Método | Ruta | Descripción | Respuesta |
|---|---|---|---|
| GET | `/api/health` | Liveness: schedulers, loops colgados, salud de conexiones, base, pérdida de ingesta | 200 `{status:'ok',timestamp,uptime,memory:{rss,heapUsed},version,database,services,hungLoops,connections,ingest}`; **503** si está degradado (`api/health/route.ts:27`) |
| GET | `/api/metrics` | Exposition Prometheus (`text/plain; version=0.0.4`) | 200 texto; **401** si `METRICS_BEARER_TOKEN` está seteado y el Bearer no coincide (`api/metrics/route.ts:20`) |
| GET | `/api/vm/query` | Proxy a VictoriaMetrics `query_range` | 400 sin `?query=`; 200 JSON crudo de VM; **502** con `{error,detail}` |
| GET | `/api/vm/instant` | Proxy a VictoriaMetrics `query` (valor puntual) | Igual que el anterior |

## 2. Autenticación

| Método | Ruta | Guard | Respuesta |
|---|---|---|---|
| POST | `/api/auth/login` | Cuota propia por email **e** IP | 400 JSON inválido; 401 `{error:'Invalid credentials'}`; **429** con `retry-after`; 200 `{user:{id,email,name,role}}` + cookies `ftth_session` y `ftth_csrf`; 200 `{mfaRequired:true,tempToken}` si hay MFA |
| POST | `/api/auth/signup` | Cuota por IP | 409 `{error:'Email already registered'}`; **201** `{user,tenant}` + cookies |
| GET | `/api/auth/me` | Cookie (degradado) | 200 `{user:{id,email,name,role,tenantId,mfaEnabled,tenant}}` o `{user:null}` |
| POST | `/api/auth/logout` | Cookie (degradado) | 200 `{ok:true}` + expiración de ambas cookies |
| GET | `/api/auth/[...nextauth]` | Ninguno | **501** `{error:'NextAuth not configured'}` — stub sin implementar |
| POST | `/api/auth/mfa/setup` | Sesión | 200 `{secret,otpauthUri,issuer,account,format:'base32',digits:6,period:30}`; 409 si MFA ya está activo |
| GET | `/api/auth/mfa/setup` | Sesión | 200 `{mfaEnabled}` |
| DELETE | `/api/auth/mfa/setup` | Sesión | 200 `{mfaEnabled:false}`; exige código TOTP vigente |
| POST | `/api/auth/mfa/disable` | Sesión | 200 `{ok:true}`; exige código TOTP vigente |
| POST | `/api/auth/mfa/verify` | **Público** | Acepta `{email,password,code}`, `{code}` o `{tempToken,code}`. 401 en credencial/código/token inválido; 200 `{user}` + cookie de sesión |
| GET | `/api/auth/ldap-test` | Rol `OWNER` o `ADMIN` | 200 con el resultado de `diagnoseLdap()`; **403** si no alcanza el rol |

## 3. Chat y conversaciones

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| POST | `/api/chat` | `chat` | Corre el agente. Persiste conversación, mensajes, tool calls, `verdict_log` y un candidato de incidente pendiente. Body `{message(1..8000),conversationId?,connectionId?}`. 400/401/403/404/409/**429**/200 `{reply,toolsUsed,conversationId,dataSource,abstention}` (`api/chat/route.ts:68`) |
| GET | `/api/conversations` | Sesión (degrada a lista vacía) | `?q=` filtra por título. 200 `{conversations:[{id,title,updatedAt,createdAt,messageCount}]}` |
| GET | `/api/conversations/[id]` | `view_all_conversations` decide el alcance | 200 `{conversation:{id,title,connectionId,messages:[{id,role,content,toolCalls,createdAt}]}}` |
| GET | `/api/conversations/[id]/export` | `view_all_conversations` decide el alcance | `?format=text` ⇒ attachment `text/plain`; por defecto 200 JSON con los mensajes |

## 4. Conectores NMS

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/api/connectors` | Sesión (degrada a `connectors:[]`) | 200 `{user,connectors:[],demoMode}` — **nunca** expone la API key |
| POST | `/api/connectors/create` | `manage_connectors` | Body `{provider:'SMARTOLT'\|'MIKROWISP'\|'NETSENSE'\|'MIKROTIK',label,apiKey,baseUrl}`. 400 si la URL no es segura (`assertSafeNmsBaseUrl`); **422** si el proveedor no está implementado; 201 `{connector}` |
| DELETE | `/api/connectors/[id]` | `manage_connectors` (dentro de `deleteConnector`) | 404 `{error:'Not found or not authorized'}` — la misma respuesta para inexistente y no autorizado |
| POST | `/api/connectors/[id]/test` | `manage_connectors` | 200 `{ok:true,latencyMs}`; **502** `{ok:false,error}` |

## 5. Red: dashboard, alertas, SLA, auditoría, topología

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/api/dashboard` | `view_network` | `{dataSource,overview,olts:[{...,onusTotal,onusOnline,onusOffline,onusDegraded}],statusDistribution}` |
| GET | `/api/alerts` | `view_network` | `{alerts,count,dataSource}` |
| GET | `/api/sla` | `view_network` | `?days=` (1–90, default 30). `{windowDays,sla:[{connectionId,deviceKind,deviceId,uptimePercent,coveragePercent,measuredMs,unmeasuredMs,offlineMs}],count}`. `uptimePercent:null` = datos insuficientes |
| GET | `/api/audit` | `view_network` (miembros sólo ven sus propios eventos) | `?page,limit(≤200),category,actorId,resourceType,outcome,from,to`. `{rows,byDay,pagination:{page,limit,total,pages},generatedAt}` |
| GET | `/api/security/access` | `view_network` | `?category=access\|auth_failure`, `?limit`(≤500). `{events,count}` |
| GET | `/api/topology/tree` | `view_network` | `{roots:[{kind,id,children,downstreamCount}],nodeCount,count}` |
| GET | `/api/topology/path` | `view_network` | `?kind,id` obligatorios; `?asOf` opcional. 400 sin parámetros, 404 cross-tenant. `{schema:'ftth.topology.v1',kind,id,path:[{kind,id}]}` |
| GET | `/api/topology/downstream` | `view_network` | `{schema:'ftth.topology.v1',kind,id,onuIds,edgesTraversed}` |

## 6. Incidentes e investigaciones

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/api/incidents` | `view_network` | `?status`,`?limit`,`?cursor`. `{incidents:[...],count,page:{scope,hasMore,nextCursor}}` |
| POST | `/api/incidents` | `manage_incidents` | Body `{deviceKind:'OLT'\|'ONU',deviceId,title,description?,severity?}`. 409 `{error,existingId}` si ya hay un incidente abierto |
| GET | `/api/incidents/[id]` | `view_network` | 404 (también cross-tenant, sin filtrar existencia). 200 `{incident,relatedMaintenance}` |
| PATCH | `/api/incidents/[id]` | `view_network` | Body `{status?,severity?,title?,description?}`. 200 `{incident}` |
| POST | `/api/incidents/[id]/confirm` | `view_network` | Body `{rootCause,fix,summary,investigationFeedbackId?}`. **201** al crear, **200** si ya existía (idempotente) |
| GET | `/api/incidents/[id]/investigate` | `view_network` | 200 `{runId,status,requestedAt,version:{versionId,versionIndex,rulesetVersion,modelVersion,snapshotAt,snapshot}\|null}` |
| POST | `/api/incidents/[id]/investigate` | `view_network` + cuota | Body `{refresh?,timeoutMs?(≤15000),windowDays?}`. **429** `{error:'Investigation quota exceeded',retryAfter}`; **202** `{runId,status:'pending',retryAfterMs:3000}`; **201** `{runId,versionId,versionIndex,status:'ready',result}` |
| GET | `/api/investigations/[runId]/feedbacks` | `view_network` | `{runId,status,requestedAt,feedbacks:[...],count,limit}` |
| POST | `/api/investigations/[runId]/versions/[versionId]/feedback` | `view_network` | Body `{label,observations?,realCause?,resolutionEvidence?,feedbackId?}`. **201** creado / **200** existente (`idempotent:true`) |
| PATCH | `/api/predictions/[id]` | `ack_alerts` | 200 `{ok:true}` —ACKNOWLEDGE de una alerta detectada |
| GET | `/api/predictions` | `view_network` | `?status=unresolved\|resolved\|all`, `?limit`(≤200), `?cursor` |
| POST | `/api/pending-incidents/promote` | Rol `OWNER` | 403 `{error:'Solo OWNER puede promover incidentes confirmados por el agente.'}`; 200 `{result}` |

## 7. Planes de fibra

Todas requieren `view_network`. Los marcadores se posicionan en porcentajes (`xPercent`,
`yPercent`) sobre la imagen del plan.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/fiber-plans` | Lista planes con `zoneCount` |
| POST | `/api/fiber-plans` | `multipart/form-data`: `name`, `file` (png/jpeg/gif/webp/svg/pdf, ≤50 MB), `description?`, `connectionId?`. El archivo se guarda en `public/uploads/fiber-plans` |
| GET | `/api/fiber-plans/[id]` | Plan + zonas + markers |
| DELETE | `/api/fiber-plans/[id]` | Borra plan, zonas, markers y el archivo |
| GET | `/api/fiber-plans/correlate` | `?deviceKind`,`?deviceId` obligatorios. Devuelve los markers que apuntan al device y la zona primaria |
| GET/POST | `/api/fiber-plans/[id]/zones` | Listar / crear zona (`name`, `description?`, `color?` `#RRGGBB`) |
| PATCH/DELETE | `/api/fiber-plans/[id]/zones/[zoneId]` | Actualizar / borrar zona |
| GET/POST | `/api/fiber-plans/[id]/markers` | Listar / crear marker **sin zona** |
| PATCH/DELETE | `/api/fiber-plans/[id]/markers/[markerId]` | Actualizar (incluye asignar `zoneId`) / borrar marker |
| GET/POST | `/api/fiber-plans/[id]/zones/[zoneId]/markers` | Listar / crear marker dentro de una zona |
| PATCH/DELETE | `/api/fiber-plans/[id]/zones/[zoneId]/markers/[markerId]` | Actualizar / borrar marker de zona |

## 8. Mantenimiento, on-call y notificaciones

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/api/maintenance-windows` | **Sólo sesión** (sin permiso) | `?from`,`?to`. 200 `{windows:[...]}` |
| POST | `/api/maintenance-windows` | `manage_maintenance` | Body `{title,description?,startUtc,endUtc,timezone,scope:{kind:'tenant'\|'connection'\|'device',id?}}`. **409** `{error:'overlap',overlappingWindowId,...}` si se solapa |
| DELETE | `/api/maintenance-windows/[id]` | `manage_maintenance` | Cancelación blanda: la fila queda con `status='cancelled'`. 409 `{error:'already_terminal',currentStatus}` |
| GET | `/api/maintenance-windows/[id]/suppressions` | `manage_maintenance` | `{windowId,suppressions}` — auditoría de eventos suprimidos |
| POST | `/api/maintenance-windows/[id]/reevaluate` | `manage_maintenance` | **503** `{error:'disabled',feature:'maintenance_reevaluation'}` si `MAINTENANCE_REEVAL_ENABLED` no está en `true`. 200 `{reevaluated,notified,skipped,windowEndedAt}` |
| GET | `/api/ops/oncall` | `view_network` | `?scheduleId=` para uno. `{schedules:[{...,currentEntry}]}` |
| POST/PATCH/DELETE | `/api/ops/oncall` | `manage_maintenance` | Crear / actualizar (`?id=`) / eliminar (`?id=`) un schedule |
| GET | `/api/ops/notifications` | `view_network` | `{channels:[...],recentDeliveries:[...]}` — los targets vienen redactados |
| POST/PATCH/DELETE | `/api/ops/notifications` | `manage_maintenance` | Crear / actualizar (`?id=`) / eliminar (`?id=`) un canal (`type: slack\|webhook\|email`) |
| PUT | `/api/ops/notifications` | `manage_maintenance` | Dry-run del canal (`?id=`): no escribe fila de entrega. 409 si el canal está deshabilitado, 422 si está mal configurado |

## 9. Ops: timeline, situaciones, anomalías, capacidad, runbooks, stream

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/api/ops/events` | `view_network` | `?hours`(≤168, def 48), `?limit`(10–500, def 100), `?kind`. `{timeline:[...],summary:{total,byKind,lookbackHours}}` |
| GET | `/api/ops/situations` | `view_network` | `?hours`(1–72, def 6). `{situations:[{...,confidence,scoreSeverity,anomalyCorroboration,topContributions}],summary}` |
| GET | `/api/ops/anomalies` | `view_network` | `?hours`(24–720, def 168). Detector RBCD sobre 5 métricas. `{hours,metricsScanned,count,reports:[{key,expr,points,residualMad,groups:[...]}],generatedAt}` |
| GET | `/api/ops/capacity` | `view_network` | `?hours`(1–24, def 6), `?min_conf`(0–1, def 0.3). `{devices:[{deviceId,metric,current,unit,threshold,forecast,trend,confidence,predictedOverloadAt}],summary}` |
| GET | `/api/ops/runbooks` | `view_network` | `{runbooks:[{id,title,content,deviceKind,deviceId,alertKind,severity,tags,stepCount,useCount,lastUsedAt}],relatedHistory:[...]}` |
| POST | `/api/ops/runbooks` | `view_network` | Body `{id}`. Incrementa `useCount` y setea `lastUsedAt` |
| GET | `/api/ops/stream` | `view_network` | SSE: eventos `snapshot`, `delta`, `heartbeat` (tick 10 s, snapshot cada 3°) |

## 10. Usuarios

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| GET | `/api/users` | `manage_users` | `{users:[{id,email,name,role,createdAt}]}` |
| POST | `/api/users` | `manage_users` | Body `{email,password(≥8),name?,role:'OWNER'\|'ADMIN'\|'OPERATOR'}`. 403 si pide `OWNER` y no lo es; 409 email duplicado |
| PATCH | `/api/users/[id]` | `manage_users` + `OWNER` para cambiar roles | 400 si intenta cambiarse a sí mismo |
| DELETE | `/api/users/[id]` | `manage_users` + `OWNER` | 400 si intenta borrarse a sí mismo |

## Nombres de métrica Prometheus

`GET /api/metrics` expone la familia `ftth_copilot_*` y `ftth_laya_*`
(`apps/web/lib/metrics/prometheus.ts`):

`ftth_copilot_process_uptime_seconds`, `ftth_copilot_process_memory_bytes`,
`ftth_copilot_tenants_total`, `ftth_copilot_nms_connections_total`,
`ftth_copilot_active_alerts`, `ftth_copilot_active_incidents`,
`ftth_copilot_metric_samples_total`, `ftth_copilot_snmp_traps_total`,
`ftth_copilot_service_loop_healthy`, `ftth_copilot_database_scrape_error`,
`ftth_copilot_llm_requests_total`, `ftth_copilot_llm_tokens_total`,
`ftth_copilot_llm_latency_seconds_total`, `ftth_copilot_llm_latency_seconds_count`,
`ftth_copilot_llm_fallback_events_total`, `ftth_copilot_rag_retrievals_total`,
`ftth_copilot_rag_latency_seconds_total`, `ftth_copilot_rag_latency_seconds_count`,
`ftth_copilot_router_dispatches_total`,
`ftth_laya_requests_total`, `ftth_laya_latency_ms`, `ftth_laya_confidence`.

## Notas de la implementación actual

Estas son observaciones verificadas en el código, no recomendaciones. Sirven para no
asumir cosas que el contrato real no garantiza.

1. `GET /api/maintenance-windows` no chequea permiso, mientras que `POST` sí exige
   `manage_maintenance` (`api/maintenance-windows/route.ts:42` vs `:161`).
2. `/api/vm/query` y `/api/vm/instant` no tienen autenticación y aceptan PromQL arbitrario
   del query string.
3. El middleware exime de CSRF a todo `/api/auth/*`, y `POST /api/auth/mfa/verify` sets
   **sólo** la cookie de sesión, no la de CSRF (a diferencia de `/api/auth/login` y
   `/api/auth/signup`).
4. La forma del error 401 no es uniforme: casi todos devuelven `{error:'Not authenticated'}`;
   `/api/conversations/[id]` devuelve `{error:'No autenticado.'}` y `/api/ops/stream`
   devuelve texto plano `Unauthorized`.
5. Sólo `/api/incidents` y `/api/predictions` usan paginación por cursor
   (`apps/web/lib/api/pagination.ts`: `DEFAULT_LIMIT=50`, `MAX_LIMIT=200`).
