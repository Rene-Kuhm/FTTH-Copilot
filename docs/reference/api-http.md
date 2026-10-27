# FTTH-Copilot — API HTTP

<!--
  GENERADO por `scripts/generate-api-contract.ts` desde
  `docs/contract/openapi.yaml`. No editar a mano: el CI regenera el
  archivo y falla si no coincide con el contrato.
-->

> **Fuente única de verdad:** [`docs/contract/openapi.yaml`](../../docs/contract/openapi.yaml).
> De ese contrato salen también los tipos y los validadores de
> [`@ftth-copilot/api-contract`](../../packages/api-contract).

Este documento es la **fuente única de verdad** de la API HTTP del repo. De acá se
generan la referencia publicada en `docs/reference/api-http.md`, los tipos TypeScript
y los esquemas Zod de `@ftth-copilot/api-contract`. Si el código y este contrato no
coinciden, el CI falla: no hay una segunda fuente que pueda desactualizarse en
silencio.

Los nombres de rutas, parámetros y propiedades son los del código
(`apps/web/app/api/**\/route.ts`); las descripciones están en español porque
alimentan la referencia, que es documentación.

### Pipeline global de requests

`apps/web/middleware.ts` clasifica `/api/*` como `api` (`middleware.ts:94`): **el
middleware nunca aplica auth a las rutas de API**. Sólo aplica CSRF y rate limit;
la autorización vive dentro de cada handler.

| Paso | Comportamiento | Dónde |
|---|---|---|
| Health | `/api/health` sale antes de todo: sin rate limit, sin CSRF, sin headers de seguridad | `middleware.ts:121` |
| CSRF | `POST/PUT/DELETE/PATCH` exige header `X-CSRF-Token` igual a la cookie `ftth_csrf`. Sin match ⇒ **403** `{error:'Invalid CSRF token'}`. Exento: `/api/auth/*` | `middleware.ts:127` |
| Rate limit | `/api/auth/*` ⇒ 200 req/60 s; el resto ⇒ 100 req/60 s. Clave `tenant:<tenantId>` del JWT o `ip:<x-forwarded-for>` | `middleware.ts:146` |
| Límite excedido | **429** `{error:'Too many requests', retryAfter}` + `retry-after` y `x-ratelimit-reset` | `middleware/rate-limit.ts:128` |
| Headers de éxito | `x-ratelimit-remaining`, `x-ratelimit-reset` | `middleware.ts:168` |
| Seguridad | `nosniff`, `DENY` frame, `referrer-policy`, CSP, HSTS en producción | `middleware.ts:243` |

### CSRF en detalle

Cookie `ftth_csrf`: 32 bytes aleatorios en hex, `Path=/; SameSite=Strict;
Max-Age=86400` (`apps/web/lib/auth/csrf.ts:21`, `:106`). **No es `HttpOnly`** a
propósito: el token no es una credencial, tiene que ser legible por JS para que el
cliente lo reenvíe. La cookie de sesión `ftth_session`, en cambio, sí es
`HttpOnly`.

Validación: comparación en tiempo constante entre cookie y header (`csrf.ts:55`). El
cliente `csrfFetch()` (`apps/web/lib/auth/csrf-client.ts:16`) adjunta el header sólo
en métodos mutantes y **lanza** si la cookie no está.

### Roles y permisos

`apps/web/lib/auth/permissions.ts:14-88`. Roles: `OWNER`, `ADMIN`, `OPERATOR`,
`MEMBER` (donde `MEMBER` ≡ `OPERATOR`).

| Rol | Permisos |
|---|---|
| `OWNER` | Los 11 |
| `ADMIN` | Todos salvo `execute_actions` |
| `OPERATOR` / `MEMBER` | `chat`, `view_own_conversations`, `delete_conversations`, `view_network`, `ack_alerts`, `manage_incidents` |

La sesión se resuelve con `getCurrentUser()` (`apps/web/lib/auth/server.ts:409`):
verifica el JWT **y** que exista la fila `prisma.session` vigente.

## Índice

| # | Sección | Operaciones | Qué cubre |
|---|---|---|---|
| 1 | Salud y métricas | 4 | Liveness, métricas Prometheus y proxy a VictoriaMetrics. |
| 2 | Autenticación | 12 | Login, signup, sesión y MFA. |
| 3 | Chat y conversaciones | 4 | Copiloto conversacional y su historial. |
| 4 | Conectores NMS | 4 | Alta, prueba y baja de conexiones a SmartOLT, Mikrowisp y MikroTik. |
| 5 | Red | 8 | Dashboard, alertas, SLA, auditoría, seguridad y topología. |
| 6 | Incidentes e investigaciones | 12 | Incidentes, correlación y el motor de investigación. |
| 7 | Planes de fibra | 17 | Planos de fibra con zonas y marcadores. |
| 8 | Mantenimiento y on-call | 14 | Ventanas de mantenimiento, guardias y canales de notificación. |
| 9 | Ops | 7 | Timeline, situaciones, anomalías, capacidad, runbooks y stream. |
| 10 | Usuarios | 4 | Administración de usuarios y roles. |

## 1. Salud y métricas

Liveness, métricas Prometheus y proxy a VictoriaMetrics.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/health` | Liveness del proceso y de sus servicios. | público | `200`, `503` |
| GET | `/api/metrics` | Exposición de métricas Prometheus. | público | `200`, `401` |
| GET | `/api/vm/instant` | Proxy a VictoriaMetrics (`query`, valor puntual). | público | `200`, `400`, `502` |
| GET | `/api/vm/query` | Proxy a VictoriaMetrics (`query_range`). | público | `200`, `400`, `502` |

### GET /api/health

Sale antes de todo el pipeline del middleware: sin rate limit, sin CSRF y sin
headers de seguridad. Responde **503** cuando el proceso está degradado.

- **Guard:** público.
- **Operation ID:** `getHealth`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | El proceso está sano. | `HealthReport` |
| `503` | El proceso está degradado. | `HealthReport` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `status` | `"ok" \| "degraded"` | sí | — |
| `timestamp` | `string` | sí | — |
| `uptime` | `number` | sí | — |
| `memory` | `{rss: number, heapUsed: number}` | sí | — |
| `version` | `string` | sí | — |
| `database` | `object` | no | — |
| `services` | `object` | no | — |
| `hungLoops` | `object[]` | no | — |
| `connections` | `object` | no | — |
| `ingest` | `object` | no | — |

</details>

### GET /api/metrics

Devuelve la familia `ftth_copilot_*` y `ftth_laya_*` en texto plano
(`text/plain; version=0.0.4`). Si `METRICS_BEARER_TOKEN` está seteado, exige el
Bearer correspondiente.

- **Guard:** público.
- **Operation ID:** `getMetrics`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Métricas en formato de exposición Prometheus. | `string` |
| `401` | Falta o no coincide el `METRICS_BEARER_TOKEN`. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/vm/instant

- **Guard:** público.
- **Operation ID:** `queryVictoriaMetricsInstant`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `query` | query | sí | `string` | Expresión PromQL. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Respuesta cruda de VictoriaMetrics. | `object` |
| `400` | Falta el parámetro `query`. | `Error` |
| `502` | VictoriaMetrics no respondió. | `ErrorDetail` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>502</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `detail` | `string` | no | — |

</details>

### GET /api/vm/query

- **Guard:** público.
- **Operation ID:** `queryVictoriaMetricsRange`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `query` | query | sí | `string` | Expresión PromQL. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Respuesta cruda de VictoriaMetrics. | `object` |
| `400` | Falta el parámetro `query`. | `Error` |
| `502` | VictoriaMetrics no respondió. | `ErrorDetail` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>502</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `detail` | `string` | no | — |

</details>

## 2. Autenticación

Login, signup, sesión y MFA.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/auth/{...nextauth}` | Stub de NextAuth (no implementado). | público | `501` |
| POST | `/api/auth/{...nextauth}` | Stub de NextAuth (no implementado). | público | `501` |
| GET | `/api/auth/ldap-test` | Diagnostica la conexión LDAP del tenant. | roles OWNER | ADMIN | `200`, `401`, `403` |
| POST | `/api/auth/login` | Inicia sesión con email y contraseña. | público | `200`, `400`, `401`, `429` |
| POST | `/api/auth/logout` | Cierra la sesión y expira las cookies. | sesión | `200` |
| GET | `/api/auth/me` | Devuelve la sesión actual. | sesión | `200` |
| POST | `/api/auth/mfa/disable` | Desactiva MFA (exige un código TOTP vigente). | sesión | `200`, `400`, `401` |
| DELETE | `/api/auth/mfa/setup` | Desactiva MFA (exige un código TOTP vigente). | sesión | `200`, `400`, `401` |
| GET | `/api/auth/mfa/setup` | Estado de MFA del usuario actual. | sesión | `200`, `401` |
| POST | `/api/auth/mfa/setup` | Genera el secreto TOTP y la URI `otpauth`. | sesión | `200`, `401`, `409` |
| POST | `/api/auth/mfa/verify` | Verifica el segundo factor y abre sesión. | público | `200`, `400`, `401` |
| POST | `/api/auth/signup` | Registra un usuario nuevo y su tenant. | público | `201`, `400`, `409`, `429` |

### GET /api/auth/{...nextauth}

Placeholder del route handler de NextAuth. **No** está implementado: responde
**501** siempre.

- **Guard:** público.
- **Operation ID:** `nextAuthStub`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `501` | NextAuth no está configurado. | `Error` |

<details><summary>Campos de <code>501</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/auth/{...nextauth}

Placeholder del route handler de NextAuth. Responde **501** siempre.

- **Guard:** público.
- **Operation ID:** `nextAuthStubPost`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `501` | NextAuth no está configurado. | `Error` |

<details><summary>Campos de <code>501</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/auth/ldap-test

- **Guard:** roles OWNER | ADMIN.
- **Operation ID:** `testLdap`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Resultado del diagnóstico. | `object` |
| `401` | Sin sesión. | `Error` |
| `403` | El rol no es `OWNER` ni `ADMIN`. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/auth/login

Cuota propia por email **e** IP. Si el usuario tiene MFA activo responde
`200 {mfaRequired:true,tempToken}` en lugar de emitir la cookie de sesión.

- **Guard:** público.
- **Operation ID:** `login`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `email` | `string` | sí | — |
| `password` | `string` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Sesión iniciada. | `LoginResponse \| MfaRequiredResponse` |
| `400` | JSON inválido. | `Error` |
| `401` | Credenciales inválidas. | `Error` |
| `429` | Cuota de intentos excedida. | `RateLimitedError` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>429</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `retryAfter` | `number` | no | — |

</details>

### POST /api/auth/logout

- **Guard:** sesión.
- **Operation ID:** `logout`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Sesión cerrada. | `OkResponse` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `ok` | `true` | sí | — |

</details>

### GET /api/auth/me

Degrada a `200 {user:null}` cuando no hay sesión válida: no es un error.

- **Guard:** sesión.
- **Operation ID:** `getCurrentSession`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Estado de la sesión. | `CurrentUserResponse` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `user` | `SessionUser \| null` | sí | — |

</details>

### POST /api/auth/mfa/disable

- **Guard:** sesión.
- **Operation ID:** `disableMfaByCode`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `code` | `string` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | MFA desactivado. | `OkResponse` |
| `400` | Código inválido o ausente. | `Error` |
| `401` | Sin sesión. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `ok` | `true` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### DELETE /api/auth/mfa/setup

- **Guard:** sesión.
- **Operation ID:** `disableMfa`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `code` | `string` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | MFA desactivado. | `MfaEnabledResponse` |
| `400` | Código inválido o ausente. | `Error` |
| `401` | Sin sesión. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `mfaEnabled` | `boolean` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/auth/mfa/setup

- **Guard:** sesión.
- **Operation ID:** `getMfaSetupStatus`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Estado de MFA. | `MfaEnabledResponse` |
| `401` | Sin sesión. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `mfaEnabled` | `boolean` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/auth/mfa/setup

- **Guard:** sesión.
- **Operation ID:** `setupMfa`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Secreto y URI para enrolar el autenticador. | `MfaSetupResponse` |
| `401` | Sin sesión. | `Error` |
| `409` | MFA ya está activo. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `secret` | `string` | sí | Secreto TOTP en base32. |
| `otpauthUri` | `string` | sí | — |
| `issuer` | `string` | sí | — |
| `account` | `string` | sí | — |
| `format` | `"base32"` | sí | — |
| `digits` | `6` | sí | — |
| `period` | `30` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/auth/mfa/verify

Acepta `{email,password,code}`, `{code}` o `{tempToken,code}`. Es la única
operación de auth que **no** exige CSRF y la única que emite sólo la cookie de
sesión (no la de CSRF).

- **Guard:** público.
- **Operation ID:** `verifyMfa`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `email` | `string` | no | — |
| `password` | `string` | no | — |
| `code` | `string` | sí | — |
| `tempToken` | `string` | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Segundo_factor verificado. | `object` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Credencial, código o token inválido. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/auth/signup

- **Guard:** público.
- **Operation ID:** `signup`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `email` | `string` | sí | — |
| `password` | `string` | sí | — |
| `name` | `string` (nullable) | no | — |
| `tenantName` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Usuario creado. | `SignupResponse` |
| `400` | JSON inválido. | `Error` |
| `409` | El email ya está registrado. | `Error` |
| `429` | Cuota por IP excedida. | `RateLimitedError` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `user` | `User` | sí | — |
| `tenant` | `Tenant` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>429</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `retryAfter` | `number` | no | — |

</details>

## 3. Chat y conversaciones

Copiloto conversacional y su historial.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| POST | `/api/chat` | Corre el agente y persiste la conversación. | permiso `chat` | `200`, `400`, `401`, `403`, `404`, `409`, `429` |
| GET | `/api/conversations` | Lista las conversaciones del usuario. | sesión | `200` |
| GET | `/api/conversations/{id}` | Devuelve una conversación con sus mensajes. | permiso `view_all_conversations` | `200`, `401`, `404` |
| GET | `/api/conversations/{id}/export` | Exporta una conversación. | permiso `view_all_conversations` | `200`, `401`, `404` |

### POST /api/chat

Persiste conversación, mensajes, tool calls, `verdict_log` y un candidato de
incidente pendiente. Requiere el permiso `chat`.

- **Guard:** permiso `chat`.
- **Operation ID:** `postChat`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `message` | `string` | sí | — |
| `conversationId` | `string` (nullable) | no | — |
| `connectionId` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Diagnóstico del agente. | `ChatResponse` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `chat`. | `Error` |
| `404` | La conversación o la conexión no existe. | `Error` |
| `409` | Conflicto de estado en la conversación. | `Error` |
| `429` | Cuota de chat o de investigación excedida. | `RateLimitedError` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `reply` | `string` | sí | — |
| `toolsUsed` | `string[]` | sí | — |
| `conversationId` | `string` | sí | — |
| `dataSource` | `string` | sí | — |
| `abstention` | `object` | no | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>429</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `retryAfter` | `number` | no | — |

</details>

### GET /api/conversations

Sin sesión válida degrada a una lista vacía en lugar de responder 401.

- **Guard:** sesión.
- **Operation ID:** `listConversations`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `q` | query | no | `string` | Filtra por título. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Conversaciones del usuario. | `ConversationList` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `conversations` | `ConversationSummary[]` | sí | — |

</details>

### GET /api/conversations/{id}

El alcance lo decide el permiso `view_all_conversations`: sin él, sólo se ven
las conversaciones propias.

- **Guard:** permiso `view_all_conversations`.
- **Operation ID:** `getConversation`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Conversación y mensajes. | `ConversationDetail` |
| `401` | Sin sesión. | `Error` |
| `404` | No existe o no es visible para el usuario. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `conversation` | `{id: string, title: string, connectionId: string, messages: ConversationMessage[]}` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/conversations/{id}/export

Con `?format=text` devuelve un attachment `text/plain`; por defecto devuelve
JSON con los mensajes.

- **Guard:** permiso `view_all_conversations`.
- **Operation ID:** `exportConversation`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `format` | query | no | `"json" \| "text"` | Formato de la exportación. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Conversación exportada. | `ConversationDetail` |
| `401` | Sin sesión. | `Error` |
| `404` | No existe o no es visible para el usuario. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `conversation` | `{id: string, title: string, connectionId: string, messages: ConversationMessage[]}` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

## 4. Conectores NMS

Alta, prueba y baja de conexiones a SmartOLT, Mikrowisp y MikroTik.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/connectors` | Lista los conectores NMS del tenant. | sesión | `200` |
| DELETE | `/api/connectors/{id}` | Borra un conector. | permiso `manage_connectors` | `200`, `401`, `403`, `404` |
| POST | `/api/connectors/{id}/test` | Prueba la conectividad con el NMS. | permiso `manage_connectors` | `200`, `401`, `403`, `502` |
| POST | `/api/connectors/create` | Crea una conexión a un NMS. | permiso `manage_connectors` | `201`, `400`, `401`, `403`, `422` |

### GET /api/connectors

**Nunca** expone la API key del conector. Sin sesión válida degrada a
`{connectors:[]}`.

- **Guard:** sesión.
- **Operation ID:** `listConnectors`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Conectores del tenant. | `ConnectorList` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `user` | `User` | no | — |
| `connectors` | `Connector[]` | sí | — |
| `demoMode` | `boolean` | sí | — |

</details>

### DELETE /api/connectors/{id}

La misma respuesta (`404 {error:'Not found or not authorized'}`) para un
conector inexistente y para uno que no es del usuario: no filtra existencia.

- **Guard:** permiso `manage_connectors`.
- **Operation ID:** `deleteConnector`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Conector borrado. | `object` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_connectors`. | `Error` |
| `404` | No existe o no está autorizado. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/connectors/{id}/test

- **Guard:** permiso `manage_connectors`.
- **Operation ID:** `testConnector`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | La conexión respondió. | `ConnectorTestResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_connectors`. | `Error` |
| `502` | El NMS no respondió. | `ConnectorTestResponse` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `ok` | `boolean` | sí | — |
| `latencyMs` | `number` | no | — |
| `error` | `string` | no | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/connectors/create

Valida la URL con `assertSafeNmsBaseUrl` (política SSRF de
`connectors-core`). Un proveedor no implementado responde **422**.

- **Guard:** permiso `manage_connectors`.
- **Operation ID:** `createConnector`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `provider` | `Provider` | sí | — |
| `label` | `string` | sí | — |
| `apiKey` | `string` | sí | — |
| `baseUrl` | `string` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Conector creado. | `{connector: Connector}` |
| `400` | Cuerpo inválido o URL no segura. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_connectors`. | `Error` |
| `422` | El proveedor todavía no está implementado. | `Error` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `connector` | `Connector` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

## 5. Red

Dashboard, alertas, SLA, auditoría, seguridad y topología.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/alerts` | Alertas detectadas. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/audit` | Auditoría paginada. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/dashboard` | Estado agregado de la red. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/security/access` | Eventos de acceso y de fallo de autenticación. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/sla` | SLA de disponibilidad por conexión. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/topology/downstream` | Elementos aguas abajo de un dispositivo. | permiso `view_network` | `200`, `400`, `401`, `403`, `404` |
| GET | `/api/topology/path` | Camino desde un dispositivo hasta la raíz. | permiso `view_network` | `200`, `400`, `401`, `403`, `404` |
| GET | `/api/topology/tree` | Árbol de topología con conteo de downstream. | permiso `view_network` | `200`, `401`, `403` |

### GET /api/alerts

Requiere el permiso `view_network`.

- **Guard:** permiso `view_network`.
- **Operation ID:** `listAlerts`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `connectionId` | query | no | `string` | Filtra por conexión. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Alertas del tenant. | `AlertsResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `alerts` | `Alert[]` | sí | — |
| `count` | `integer` | sí | — |
| `dataSource` | `DataSource` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/audit

Los miembros que no tienen `manage_maintenance` sólo ven sus propios eventos.

- **Guard:** permiso `view_network`.
- **Operation ID:** `listAuditEvents`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `page` | query | no | `integer` | Página (desde 1). |
| `limit` | query | no | `integer` | Filas por página (máximo 200). |
| `category` | query | no | `string` | Categoría del evento. |
| `actorId` | query | no | `string` | Identificador del actor. |
| `resourceType` | query | no | `string` | Tipo de recurso afectado. |
| `outcome` | query | no | `string` | Resultado de la acción auditada. |
| `from` | query | no | `string` | Límite inferior (ISO 8601). |
| `to` | query | no | `string` | Límite superior (ISO 8601). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Página de eventos de auditoría. | `AuditResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `rows` | `AuditRow[]` | sí | — |
| `byDay` | `object[]` | sí | — |
| `pagination` | `AuditPagination` | sí | — |
| `generatedAt` | `string` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/dashboard

Requiere el permiso `view_network`.

- **Guard:** permiso `view_network`.
- **Operation ID:** `getDashboard`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `connectionId` | query | no | `string` | Acota el dashboard a una conexión. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Resumen de la red. | `DashboardResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `dataSource` | `DataSource` | sí | — |
| `overview` | `object` | no | — |
| `olts` | `{id: string, name: string, onusTotal: integer, onusOnline: integer, onusOffline: integer, onusDegraded: integer}[]` | sí | — |
| `statusDistribution` | `object` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/security/access

Requiere el permiso `view_network`.

- **Guard:** permiso `view_network`.
- **Operation ID:** `listSecurityAccessEvents`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `category` | query | no | `"access" \| "auth_failure"` | Categoría del evento. |
| `limit` | query | no | `integer` | Máximo de eventos (hasta 500). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Eventos de acceso. | `SecurityAccessResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `events` | `SecurityAccessEvent[]` | sí | — |
| `count` | `integer` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/sla

`uptimePercent: null` significa que no hay datos suficientes para la ventana
pedida: no es un cero.

- **Guard:** permiso `view_network`.
- **Operation ID:** `getSla`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `days` | query | no | `integer` | Ventana en días (1–90). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | SLA de la ventana pedida. | `SlaResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `windowDays` | `integer` | sí | — |
| `sla` | `SlaEntry[]` | sí | — |
| `count` | `integer` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/topology/downstream

`kind` e `id` son obligatorios. Responde **404** para un dispositivo de otro
tenant.

- **Guard:** permiso `view_network`.
- **Operation ID:** `getTopologyDownstream`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `kind` | query | sí | `TopologyKind` | Tipo de dispositivo. |
| `id` | query | sí | `string` | Identificador del dispositivo. |
| `asOf` | query | no | `string` | Momento de la foto (ISO 8601). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Elementos downstream. | `TopologyDownstreamResponse` |
| `400` | Faltan `kind` o `id`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | El dispositivo no existe en el tenant. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `schema` | `"ftth.topology.v1"` | sí | — |
| `kind` | `string` | sí | — |
| `id` | `string` | sí | — |
| `onuIds` | `string[]` | sí | — |
| `edgesTraversed` | `integer` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/topology/path

`kind` e `id` son obligatorios. Un dispositivo de otro tenant responde **404**,
no **403**: no se filtra la existencia.

- **Guard:** permiso `view_network`.
- **Operation ID:** `getTopologyPath`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `kind` | query | sí | `TopologyKind` | Tipo de dispositivo. |
| `id` | query | sí | `string` | Identificador del dispositivo. |
| `asOf` | query | no | `string` | Momento de la foto (ISO 8601). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Camino hasta la raíz. | `TopologyPathResponse` |
| `400` | Faltan `kind` o `id`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | El dispositivo no existe en el tenant. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `schema` | `"ftth.topology.v1"` | sí | — |
| `kind` | `string` | sí | — |
| `id` | `string` | sí | — |
| `path` | `{kind: string, id: string}[]` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/topology/tree

Requiere el permiso `view_network`.

- **Guard:** permiso `view_network`.
- **Operation ID:** `getTopologyTree`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Raíces del árbol de topología. | `TopologyTreeResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `roots` | `TopologyNode[]` | sí | — |
| `nodeCount` | `integer` | sí | — |
| `count` | `integer` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

## 6. Incidentes e investigaciones

Incidentes, correlación y el motor de investigación.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/incidents` | Lista incidentes con paginación por cursor. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/incidents` | Abre un incidente. | permiso `manage_incidents` | `201`, `400`, `401`, `403`, `409` |
| GET | `/api/incidents/{id}` | Devuelve un incidente y su mantenimiento relacionado. | permiso `view_network` | `200`, `401`, `403`, `404` |
| PATCH | `/api/incidents/{id}` | Actualiza estado, severidad, título o descripción. | permiso `view_network` | `200`, `400`, `401`, `403`, `404` |
| POST | `/api/incidents/{id}/confirm` | Confirma la causa raíz de un incidente. | permiso `view_network` | `200`, `201`, `400`, `401`, `403`, `404` |
| GET | `/api/incidents/{id}/investigate` | Estado de la investigación del incidente. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/incidents/{id}/investigate` | Lanza una investigación del incidente. | permiso `view_network` | `201`, `202`, `401`, `403`, `404`, `429` |
| GET | `/api/investigations/{runId}/feedbacks` | Feedbacks de una corrida de investigación. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/investigations/{runId}/versions/{versionId}/feedback` | Registra el feedback de una versión de investigación. | permiso `view_network` | `200`, `201`, `400`, `401`, `403` |
| POST | `/api/pending-incidents/promote` | Promueve candidatos de incidente a incidentes confirmados. | roles OWNER | `200`, `401`, `403` |
| GET | `/api/predictions` | Predicciones de falla con paginación por cursor. | permiso `view_network` | `200`, `401`, `403` |
| PATCH | `/api/predictions/{id}` | Reconoce (ACK) una alerta detectada. | permiso `ack_alerts` | `200`, `401`, `403` |

### GET /api/incidents

Requiere el permiso `view_network`.

- **Guard:** permiso `view_network`.
- **Operation ID:** `listIncidents`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `status` | query | no | `string` | Estado de los incidentes. |
| `limit` | query | no | `integer` | Máximo de incidentes (por defecto 50, máximo 200). |
| `cursor` | query | no | `string` | Cursor opaco de la página anterior. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Incidentes del tenant. | `IncidentList` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `incidents` | `Incident[]` | sí | — |
| `count` | `integer` | sí | — |
| `page` | `{scope: string, hasMore: boolean, nextCursor: string}` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/incidents

Requiere el permiso `manage_incidents`. Si ya hay un incidente abierto para el
mismo dispositivo responde **409** con `{error,existingId}`.

- **Guard:** permiso `manage_incidents`.
- **Operation ID:** `createIncident`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `deviceKind` | `DeviceKind` | sí | — |
| `deviceId` | `string` | sí | — |
| `title` | `string` | sí | — |
| `description` | `string` (nullable) | no | — |
| `severity` | `IncidentSeverity` (default: "warning") | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Incidente creado. | `{incident: Incident}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_incidents`. | `Error` |
| `409` | Ya hay un incidente abierto para ese dispositivo. | `ConflictError` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `incident` | `Incident` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>409</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `existingId` | `string` | no | — |

</details>

### GET /api/incidents/{id}

- **Guard:** permiso `view_network`.
- **Operation ID:** `getIncident`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Incidente y mantenimiento relacionado. | `IncidentDetail` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | No existe o es de otro tenant. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `incident` | `Incident` | sí | — |
| `relatedMaintenance` | `MaintenanceWindow[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/incidents/{id}

- **Guard:** permiso `view_network`.
- **Operation ID:** `updateIncident`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `status` | `IncidentStatus` | no | — |
| `severity` | `IncidentSeverity` | no | — |
| `title` | `string` | no | — |
| `description` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Incidente actualizado. | `{incident: Incident}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | No existe o es de otro tenant. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `incident` | `Incident` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/incidents/{id}/confirm

Idempotente: "**201** al crear la confirmación y **200** si ya existía."

- **Guard:** permiso `view_network`.
- **Operation ID:** `confirmIncident`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `rootCause` | `string` | sí | — |
| `fix` | `string` | sí | — |
| `summary` | `string` | sí | — |
| `investigationFeedbackId` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | La confirmación ya existía. | `object` |
| `201` | Confirmación creada. | `object` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | No existe o es de otro tenant. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/incidents/{id}/investigate

- **Guard:** permiso `view_network`.
- **Operation ID:** `getIncidentInvestigation`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Estado de la investigación. | `InvestigationStatus` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `runId` | `string` | sí | — |
| `status` | `string` | sí | — |
| `requestedAt` | `string` | sí | — |
| `version` | `{versionId: string, versionIndex: integer, rulesetVersion: string, modelVersion: string, snapshotAt: string, snapshot: object} \| null` | no | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/incidents/{id}/investigate

**202** cuando la investigación queda pendiente, **201** cuando el resultado
está listo. Consume cuota de investigación.

- **Guard:** permiso `view_network`.
- **Operation ID:** `startIncidentInvestigation`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, opcional)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `refresh` | `boolean` | no | — |
| `timeoutMs` | `integer` | no | — |
| `windowDays` | `integer` | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | La investigación terminó y hay resultado. | `InvestigationResultResponse` |
| `202` | La investigación quedó pendiente. | `InvestigationPendingResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | No existe o es de otro tenant. | `Error` |
| `429` | Cuota de investigación excedida. | `RateLimitedError` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `runId` | `string` | sí | — |
| `versionId` | `string` | sí | — |
| `versionIndex` | `integer` | sí | — |
| `status` | `"ready"` | sí | — |
| `result` | `object` | sí | — |

</details>

<details><summary>Campos de <code>202</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `runId` | `string` | sí | — |
| `status` | `"pending"` | sí | — |
| `retryAfterMs` | `3000` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>429</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `retryAfter` | `number` | no | — |

</details>

### GET /api/investigations/{runId}/feedbacks

- **Guard:** permiso `view_network`.
- **Operation ID:** `listInvestigationFeedbacks`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `runId` | path | sí | `string` | Identificador de la corrida de investigación. |
| `limit` | query | no | `integer` | Máximo de feedbacks. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Feedbacks de la corrida. | `FeedbackList` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `runId` | `string` | sí | — |
| `status` | `string` | sí | — |
| `requestedAt` | `string` | sí | — |
| `feedbacks` | `object[]` | sí | — |
| `count` | `integer` | sí | — |
| `limit` | `integer` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/investigations/{runId}/versions/{versionId}/feedback

Idempotente: "**201** al crear y **200** si ya existía (`idempotent:true`)."

- **Guard:** permiso `view_network`.
- **Operation ID:** `createInvestigationFeedback`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `runId` | path | sí | `string` | Identificador de la corrida de investigación. |
| `versionId` | path | sí | `string` | Versión de la investigación. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `label` | `FeedbackLabel` | sí | — |
| `observations` | `string` (nullable) | no | — |
| `realCause` | `string` (nullable) | no | — |
| `resolutionEvidence` | `string` (nullable) | no | — |
| `feedbackId` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | El feedback ya existía. | `object` |
| `201` | Feedback creado. | `object` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/pending-incidents/promote

Reservado al rol `OWNER`: escribe filas que el retrieval path expone al LLM
como contexto de fondo.

- **Guard:** roles OWNER.
- **Operation ID:** `promotePendingIncidents`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Resultado de la promoción. | `object` |
| `401` | Sin sesión. | `Error` |
| `403` | El rol no es `OWNER`. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/predictions

- **Guard:** permiso `view_network`.
- **Operation ID:** `listPredictions`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `status` | query | no | `"unresolved" \| "resolved" \| "all"` | Alcance de las predicciones. |
| `limit` | query | no | `integer` | Máximo de predicciones (por defecto 50, máximo 200). |
| `cursor` | query | no | `string` | Cursor opaco de la página anterior. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Predicciones del tenant. | `PredictionList` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `predictions` | `Prediction[]` | sí | — |
| `count` | `integer` | sí | — |
| `page` | `{scope: string, hasMore: boolean, nextCursor: string}` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/predictions/{id}

Requiere el permiso `ack_alerts`.

- **Guard:** permiso `ack_alerts`.
- **Operation ID:** `acknowledgePrediction`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Predicción reconocida. | `OkResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `ack_alerts`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `ok` | `true` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

## 7. Planes de fibra

Planos de fibra con zonas y marcadores.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/fiber-plans` | Lista los planos de fibra del tenant. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/fiber-plans` | Sube un plano de fibra. | permiso `view_network` | `201`, `400`, `401`, `403` |
| DELETE | `/api/fiber-plans/{id}` | Borra un plano, sus zonas, marcadores y el archivo. | permiso `view_network` | `200`, `401`, `403`, `404` |
| GET | `/api/fiber-plans/{id}` | Devuelve un plano con sus zonas y marcadores. | permiso `view_network` | `200`, `401`, `403`, `404` |
| GET | `/api/fiber-plans/{id}/markers` | Lista los marcadores sin zona del plano. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/fiber-plans/{id}/markers` | Crea un marcador sin zona. | permiso `view_network` | `201`, `400`, `401`, `403` |
| DELETE | `/api/fiber-plans/{id}/markers/{markerId}` | Borra un marcador. | permiso `view_network` | `200`, `401`, `403` |
| PATCH | `/api/fiber-plans/{id}/markers/{markerId}` | Actualiza un marcador (incluye moverlo de zona). | permiso `view_network` | `200`, `400`, `401`, `403` |
| GET | `/api/fiber-plans/{id}/zones` | Lista las zonas de un plano. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/fiber-plans/{id}/zones` | Crea una zona en el plano. | permiso `view_network` | `201`, `400`, `401`, `403` |
| DELETE | `/api/fiber-plans/{id}/zones/{zoneId}` | Borra una zona. | permiso `view_network` | `200`, `401`, `403` |
| PATCH | `/api/fiber-plans/{id}/zones/{zoneId}` | Actualiza una zona. | permiso `view_network` | `200`, `400`, `401`, `403` |
| GET | `/api/fiber-plans/{id}/zones/{zoneId}/markers` | Lista los marcadores de una zona. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/fiber-plans/{id}/zones/{zoneId}/markers` | Crea un marcador dentro de una zona. | permiso `view_network` | `201`, `400`, `401`, `403` |
| DELETE | `/api/fiber-plans/{id}/zones/{zoneId}/markers/{markerId}` | Borra un marcador dentro de una zona. | permiso `view_network` | `200`, `401`, `403` |
| PATCH | `/api/fiber-plans/{id}/zones/{zoneId}/markers/{markerId}` | Actualiza un marcador dentro de una zona. | permiso `view_network` | `200`, `400`, `401`, `403` |
| GET | `/api/fiber-plans/correlate` | Correlaciona marcadores de un dispositivo con su zona primaria. | permiso `view_network` | `200`, `400`, `401`, `403` |

### GET /api/fiber-plans

Los marcadores de un plano se posicionan en porcentajes (`xPercent`, `yPercent`)
sobre la imagen del plano.

- **Guard:** permiso `view_network`.
- **Operation ID:** `listFiberPlans`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Planos con su cantidad de zonas. | `FiberPlanList` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `plans` | `FiberPlan[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/fiber-plans

`multipart/form-data` con `name`, `file` (png/jpeg/gif/webp/svg/pdf, hasta
50 MB), `description?` y `connectionId?`. El archivo se guarda en
`public/uploads/fiber-plans`.

- **Guard:** permiso `view_network`.
- **Operation ID:** `createFiberPlan`.

**Cuerpo** (multipart/form-data, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `name` | `string` | sí | — |
| `file` | `string` | sí | png, jpeg, gif, webp, svg o pdf (hasta 50 MB). |
| `description` | `string` (nullable) | no | — |
| `connectionId` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Plano creado. | `{plan: FiberPlan}` |
| `400` | Formulario inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `plan` | `FiberPlan` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### DELETE /api/fiber-plans/{id}

- **Guard:** permiso `view_network`.
- **Operation ID:** `deleteFiberPlan`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Plano borrado. | `object` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | El plano no existe en el tenant. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/fiber-plans/{id}

- **Guard:** permiso `view_network`.
- **Operation ID:** `getFiberPlan`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Plano, zonas y marcadores. | `FiberPlanDetail` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |
| `404` | El plano no existe en el tenant. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `plan` | `FiberPlan` | sí | — |
| `zones` | `FiberZone[]` | sí | — |
| `markers` | `FiberMarker[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/fiber-plans/{id}/markers

- **Guard:** permiso `view_network`.
- **Operation ID:** `listFiberPlanMarkers`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Marcadores sin zona. | `{markers: FiberMarker[]}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `markers` | `FiberMarker[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/fiber-plans/{id}/markers

- **Guard:** permiso `view_network`.
- **Operation ID:** `createFiberPlanMarker`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `label` | `string` | sí | — |
| `deviceKind` | `MarkerDeviceKind` | no | — |
| `deviceId` | `string` (nullable) | no | — |
| `xPercent` | `number` | sí | — |
| `yPercent` | `number` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Marcador creado. | `{marker: FiberMarker}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `marker` | `FiberMarker` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### DELETE /api/fiber-plans/{id}/markers/{markerId}

- **Guard:** permiso `view_network`.
- **Operation ID:** `deleteFiberPlanMarker`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `markerId` | path | sí | `string` | Identificador del marcador. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Marcador borrado. | `object` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/fiber-plans/{id}/markers/{markerId}

- **Guard:** permiso `view_network`.
- **Operation ID:** `updateFiberPlanMarker`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `markerId` | path | sí | `string` | Identificador del marcador. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `label` | `string` | no | — |
| `deviceKind` | `MarkerDeviceKind` | no | — |
| `deviceId` | `string` (nullable) | no | — |
| `xPercent` | `number` | no | — |
| `yPercent` | `number` | no | — |
| `zoneId` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Marcador actualizado. | `{marker: FiberMarker}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `marker` | `FiberMarker` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/fiber-plans/{id}/zones

- **Guard:** permiso `view_network`.
- **Operation ID:** `listFiberPlanZones`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Zonas del plano. | `{zones: FiberZone[]}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `zones` | `FiberZone[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/fiber-plans/{id}/zones

- **Guard:** permiso `view_network`.
- **Operation ID:** `createFiberPlanZone`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `name` | `string` | sí | — |
| `description` | `string` (nullable) | no | — |
| `color` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Zona creada. | `{zone: FiberZone}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `zone` | `FiberZone` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### DELETE /api/fiber-plans/{id}/zones/{zoneId}

- **Guard:** permiso `view_network`.
- **Operation ID:** `deleteFiberPlanZone`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `zoneId` | path | sí | `string` | Identificador de la zona. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Zona borrada. | `object` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/fiber-plans/{id}/zones/{zoneId}

- **Guard:** permiso `view_network`.
- **Operation ID:** `updateFiberPlanZone`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `zoneId` | path | sí | `string` | Identificador de la zona. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `name` | `string` | no | — |
| `description` | `string` (nullable) | no | — |
| `color` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Zona actualizada. | `{zone: FiberZone}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `zone` | `FiberZone` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/fiber-plans/{id}/zones/{zoneId}/markers

- **Guard:** permiso `view_network`.
- **Operation ID:** `listFiberPlanZoneMarkers`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `zoneId` | path | sí | `string` | Identificador de la zona. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Marcadores de la zona. | `{markers: FiberMarker[]}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `markers` | `FiberMarker[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/fiber-plans/{id}/zones/{zoneId}/markers

- **Guard:** permiso `view_network`.
- **Operation ID:** `createFiberPlanZoneMarker`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `zoneId` | path | sí | `string` | Identificador de la zona. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `label` | `string` | sí | — |
| `deviceKind` | `MarkerDeviceKind` | no | — |
| `deviceId` | `string` (nullable) | no | — |
| `xPercent` | `number` | sí | — |
| `yPercent` | `number` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Marcador creado. | `{marker: FiberMarker}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `marker` | `FiberMarker` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### DELETE /api/fiber-plans/{id}/zones/{zoneId}/markers/{markerId}

- **Guard:** permiso `view_network`.
- **Operation ID:** `deleteFiberPlanZoneMarker`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `zoneId` | path | sí | `string` | Identificador de la zona. |
| `markerId` | path | sí | `string` | Identificador del marcador. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Marcador borrado. | `object` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/fiber-plans/{id}/zones/{zoneId}/markers/{markerId}

- **Guard:** permiso `view_network`.
- **Operation ID:** `updateFiberPlanZoneMarker`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |
| `zoneId` | path | sí | `string` | Identificador de la zona. |
| `markerId` | path | sí | `string` | Identificador del marcador. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `label` | `string` | no | — |
| `deviceKind` | `MarkerDeviceKind` | no | — |
| `deviceId` | `string` (nullable) | no | — |
| `xPercent` | `number` | no | — |
| `yPercent` | `number` | no | — |
| `zoneId` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Marcador actualizado. | `{marker: FiberMarker}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `marker` | `FiberMarker` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/fiber-plans/correlate

- **Guard:** permiso `view_network`.
- **Operation ID:** `correlateFiberPlanMarkers`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `deviceKind` | query | sí | `MarkerDeviceKind` | Tipo de dispositivo. |
| `deviceId` | query | sí | `string` | Identificador del dispositivo. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Marcadores y zona primaria. | `FiberPlanCorrelation` |
| `400` | Faltan `deviceKind` o `deviceId`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `markers` | `FiberMarker[]` | sí | — |
| `primaryZone` | `FiberZone \| null` | no | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

## 8. Mantenimiento y on-call

Ventanas de mantenimiento, guardias y canales de notificación.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/maintenance-windows` | Lista las ventanas de mantenimiento. | sesión | `200`, `401` |
| POST | `/api/maintenance-windows` | Abre una ventana de mantenimiento. | permiso `manage_maintenance` | `201`, `400`, `401`, `403`, `409` |
| DELETE | `/api/maintenance-windows/{id}` | Cancela una ventana de mantenimiento. | permiso `manage_maintenance` | `200`, `400`, `401`, `403`, `409` |
| POST | `/api/maintenance-windows/{id}/reevaluate` | Reevalúa los avisos de una ventana. | permiso `manage_maintenance` | `200`, `401`, `403`, `503` |
| GET | `/api/maintenance-windows/{id}/suppressions` | Eventos suprimidos por la ventana. | permiso `manage_maintenance` | `200`, `401`, `403` |
| DELETE | `/api/ops/notifications` | Borra un canal de notificación. | permiso `manage_maintenance` | `200`, `400`, `401`, `403` |
| GET | `/api/ops/notifications` | Lista los canales de notificación. | permiso `view_network` | `200`, `401`, `403` |
| PATCH | `/api/ops/notifications` | Actualiza un canal de notificación. | permiso `manage_maintenance` | `200`, `400`, `401`, `403` |
| POST | `/api/ops/notifications` | Crea un canal de notificación. | permiso `manage_maintenance` | `201`, `400`, `401`, `403` |
| PUT | `/api/ops/notifications` | Dry-run de un canal de notificación. | permiso `manage_maintenance` | `200`, `400`, `401`, `403`, `404`, `409`, `422` |
| DELETE | `/api/ops/oncall` | Borra una guardia o una entrada. | permiso `manage_maintenance` | `200`, `400`, `401`, `403` |
| GET | `/api/ops/oncall` | Lista las guardias y la entrada vigente. | permiso `view_network` | `200`, `401`, `403` |
| PATCH | `/api/ops/oncall` | Actualiza una guardia o una entrada. | permiso `manage_maintenance` | `200`, `400`, `401`, `403` |
| POST | `/api/ops/oncall` | Crea una guardia o una entrada de guardia. | permiso `manage_maintenance` | `201`, `400`, `401`, `403` |

### GET /api/maintenance-windows

Exige sesión, pero **no** exige permiso: es la única operación de la sección
que no chequea `manage_maintenance`.

- **Guard:** sesión.
- **Operation ID:** `listMaintenanceWindows`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `from` | query | no | `string` | Límite inferior (ISO 8601). |
| `to` | query | no | `string` | Límite superior (ISO 8601). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Ventanas de la ventana pedida. | `{windows: MaintenanceWindow[]}` |
| `401` | Sin sesión. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `windows` | `MaintenanceWindow[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/maintenance-windows

Requiere el permiso `manage_maintenance`. Si la ventana se solapa con otra
responde **409** con `{error:'overlap',overlappingWindowId,...}`.

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `createMaintenanceWindow`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `title` | `string` | sí | — |
| `description` | `string` (nullable) | no | — |
| `startUtc` | `string` | sí | — |
| `endUtc` | `string` | sí | — |
| `timezone` | `string` | sí | — |
| `scope` | `MaintenanceScope` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Ventana creada. | `{window: MaintenanceWindow}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |
| `409` | La ventana se solapa con otra existente. | `MaintenanceOverlapError` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `window` | `MaintenanceWindow` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>409</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `"overlap"` | sí | — |
| `overlappingWindowId` | `string` | no | — |

</details>

### DELETE /api/maintenance-windows/{id}

Cancelación blanda: la fila queda con `status='cancelled'`. Si la ventana ya
está terminal responde **409** con `{error:'already_terminal',currentStatus}`.

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `cancelMaintenanceWindow`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `cancellationReason` | `string` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Ventana cancelada. | `object` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |
| `409` | La ventana ya está en estado terminal. | `AlreadyTerminalError` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>409</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `"already_terminal"` | sí | — |
| `currentStatus` | `string` | no | — |

</details>

### POST /api/maintenance-windows/{id}/reevaluate

Requiere `MAINTENANCE_REEVAL_ENABLED=true`; si la feature está apagada
responde **503** `{error:'disabled',feature:'maintenance_reevaluation'}`.

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `reevaluateMaintenanceWindow`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, opcional)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `since` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Resultado de la reevaluación. | `{reevaluated: integer, notified: integer, skipped: integer, windowEndedAt: string}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |
| `503` | La feature de reevaluación está deshabilitada. | `FeatureDisabledError` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `reevaluated` | `integer` | sí | — |
| `notified` | `integer` | sí | — |
| `skipped` | `integer` | sí | — |
| `windowEndedAt` | `string` (nullable) | no | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>503</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `"disabled"` | sí | — |
| `feature` | `string` | sí | — |

</details>

### GET /api/maintenance-windows/{id}/suppressions

Auditoría de lo que la ventana dejó de notificar.

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `listMaintenanceSuppressions`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Supresiones de la ventana. | `{windowId: string, suppressions: object[]}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `windowId` | `string` | sí | — |
| `suppressions` | `object[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### DELETE /api/ops/notifications

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `deleteNotificationChannel`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | query | sí | `string` | Identificador del canal. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Canal borrado. | `object` |
| `400` | Falta `id`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/ops/notifications

Los targets vienen redactados: la respuesta nunca expone el secreto del
webhook ni la contraseña del mail.

- **Guard:** permiso `view_network`.
- **Operation ID:** `listNotificationChannels`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Canales y entregas recientes. | `{channels: NotificationChannel[], recentDeliveries: object[]}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `channels` | `NotificationChannel[]` | sí | — |
| `recentDeliveries` | `object[]` | no | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/ops/notifications

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `updateNotificationChannel`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | query | sí | `string` | Identificador del canal. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `type` | `NotificationType` | no | — |
| `target` | `string` | no | — |
| `enabled` | `boolean` | no | — |
| `minSeverity` | `NotificationSeverity` | no | — |
| `labels` | `string[]` | no | — |
| `cooldownSeconds` | `integer` | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Canal actualizado. | `{channel: NotificationChannel}` |
| `400` | Cuerpo inválido o falta `id`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `channel` | `NotificationChannel` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/ops/notifications

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `createNotificationChannel`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `type` | `NotificationType` | sí | — |
| `target` | `string` | sí | — |
| `enabled` | `boolean` (default: true) | no | — |
| `minSeverity` | `NotificationSeverity` (default: "warning") | no | — |
| `labels` | `string[]` (default: []) | no | — |
| `cooldownSeconds` | `integer` (default: 300) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Canal creado. | `{channel: NotificationChannel}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `channel` | `NotificationChannel` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PUT /api/ops/notifications

Entrega un payload sintético y reporta el resultado **sin** escribir la fila de
entrega. Un canal deshabilitado responde **409** y uno mal configurado **422**.

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `testNotificationChannel`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | query | sí | `string` | Identificador del canal. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Resultado del dry-run. | `object` |
| `400` | Falta `id`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |
| `404` | El canal no existe en el tenant. | `Error` |
| `409` | El canal está deshabilitado. | `Error` |
| `422` | El canal está mal configurado. | `MisconfiguredChannelError` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

<details><summary>Campos de <code>422</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |
| `stored` | `object` | no | — |

</details>

### DELETE /api/ops/oncall

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `deleteOncallEntry`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | query | sí | `string` | Identificador de la guardia o de la entrada. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Guardia o entrada borrada. | `object` |
| `400` | Falta `id`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/ops/oncall

- **Guard:** permiso `view_network`.
- **Operation ID:** `listOncallSchedules`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `scheduleId` | query | no | `string` | Devuelve sólo esa guardia. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Guardias con su entrada vigente. | `{schedules: OncallSchedule[]}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `schedules` | `OncallSchedule[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/ops/oncall

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `updateOncallEntry`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | query | sí | `string` | Identificador de la guardia o de la entrada. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `name` | `string` | no | — |
| `description` | `string` (nullable) | no | — |
| `rotationType` | `"weekly" \| "daily" \| "custom"` (default: "weekly") | no | — |
| `startOfWeek` | `integer` (default: 1) | no | — |
| `primaryUserId` | `string` (nullable) | no | — |
| `backupUserId` | `string` (nullable) | no | — |
| `escalationUserId` | `string` (nullable) | no | — |
| `handoffTime` | `string` (default: "09:00") | no | — |
| `timezone` | `string` (default: "UTC") | no | — |
| `userId` | `string` | no | — |
| `role` | `"primary" \| "backup" \| "escalation"` (default: "primary") | no | — |
| `startUtc` | `string` | no | — |
| `endUtc` | `string` | no | — |
| `notes` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Guardia o entrada actualizada. | `object` |
| `400` | Cuerpo inválido o falta `id`. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/ops/oncall

Requiere el permiso `manage_maintenance`. El cuerpo decide si se crea una
guardia (`name`) o una entrada (`userId`, `startUtc`, `endUtc`).

- **Guard:** permiso `manage_maintenance`.
- **Operation ID:** `createOncallEntry`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `name` | `string` | no | — |
| `description` | `string` (nullable) | no | — |
| `rotationType` | `"weekly" \| "daily" \| "custom"` (default: "weekly") | no | — |
| `startOfWeek` | `integer` (default: 1) | no | — |
| `primaryUserId` | `string` (nullable) | no | — |
| `backupUserId` | `string` (nullable) | no | — |
| `escalationUserId` | `string` (nullable) | no | — |
| `handoffTime` | `string` (default: "09:00") | no | — |
| `timezone` | `string` (default: "UTC") | no | — |
| `userId` | `string` | no | — |
| `role` | `"primary" \| "backup" \| "escalation"` (default: "primary") | no | — |
| `startUtc` | `string` | no | — |
| `endUtc` | `string` | no | — |
| `notes` | `string` (nullable) | no | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Guardia o entrada creada. | `object` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_maintenance`. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

## 9. Ops

Timeline, situaciones, anomalías, capacidad, runbooks y stream.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/ops/anomalies` | Anomalías detectadas con el detector RBCD. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/ops/capacity` | Pronóstico de saturación por dispositivo. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/ops/events` | Timeline de eventos operativos. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/ops/runbooks` | Lista runbooks y su historial relacionado. | permiso `view_network` | `200`, `401`, `403` |
| POST | `/api/ops/runbooks` | Marca un runbook como usado. | permiso `view_network` | `200`, `400`, `401`, `403` |
| GET | `/api/ops/situations` | Situaciones anómalas agregadas. | permiso `view_network` | `200`, `401`, `403` |
| GET | `/api/ops/stream` | Stream SSE del estado operativo. | permiso `view_network` | `200`, `401`, `403` |

### GET /api/ops/anomalies

Detector RBCD sobre 5 métricas: devuelve, por grupo, la expresión, los puntos y
el residuo MAD.

- **Guard:** permiso `view_network`.
- **Operation ID:** `listOpsAnomalies`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `hours` | query | no | `integer` | Ventana hacia atrás en horas (24–720). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Reportes de anomalías. | `OpsAnomaliesResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `hours` | `integer` | sí | — |
| `metricsScanned` | `integer` | sí | — |
| `count` | `integer` | sí | — |
| `reports` | `{key: string, expr: string, points: integer, residualMad: number, groups: object[]}[]` | sí | — |
| `generatedAt` | `string` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/ops/capacity

- **Guard:** permiso `view_network`.
- **Operation ID:** `listOpsCapacity`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `hours` | query | no | `integer` | Ventana hacia atrás en horas (1–24). |
| `min_conf` | query | no | `number` | Confianza mínima del pronóstico (0–1). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Pronósticos de capacidad. | `OpsCapacityResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `devices` | `{deviceId: string, metric: string, current: number, unit: string, threshold: number, forecast: number, …}[]` | sí | — |
| `summary` | `object` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/ops/events

- **Guard:** permiso `view_network`.
- **Operation ID:** `listOpsEvents`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `hours` | query | no | `integer` | Ventana hacia atrás en horas (1–168). |
| `limit` | query | no | `integer` | Máximo de eventos (10–500). |
| `kind` | query | no | `string` | Tipo de evento. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Timeline y su resumen. | `OpsEventsResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `timeline` | `object[]` | sí | — |
| `summary` | `{total: integer, byKind: object, lookbackHours: integer}` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/ops/runbooks

- **Guard:** permiso `view_network`.
- **Operation ID:** `listOpsRunbooks`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `deviceKind` | query | no | `string` | Tipo de dispositivo. |
| `deviceId` | query | no | `string` | Identificador del dispositivo. |
| `alertKind` | query | no | `string` | Tipo de alerta. |
| `severity` | query | no | `string` | Severidad de la alerta. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Runbooks e historial relacionado. | `OpsRunbooksResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `runbooks` | `{id: string, title: string, content: string, deviceKind: string, deviceId: string, alertKind: string, …}[]` | sí | — |
| `relatedHistory` | `object[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/ops/runbooks

Incrementa `useCount` y setea `lastUsedAt` del runbook `{id}`.

- **Guard:** permiso `view_network`.
- **Operation ID:** `markOpsRunbookUsed`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `id` | `string` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Runbook marcado como usado. | `object` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/ops/situations

- **Guard:** permiso `view_network`.
- **Operation ID:** `listOpsSituations`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `hours` | query | no | `integer` | Ventana hacia atrás en horas (1–72). |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Situaciones y su resumen. | `OpsSituationsResponse` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `view_network`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `situations` | `{confidence: number, scoreSeverity: string, anomalyCorroboration: object, topContributions: object[]}[]` | sí | — |
| `summary` | `object` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### GET /api/ops/stream

Eventos `snapshot`, `delta` y `heartbeat`. El heartbeat late cada 10 s y el
snapshot se emite cada 3° del stream.

- **Guard:** permiso `view_network`.
- **Operation ID:** `streamOpsEvents`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Stream de eventos. | `string` |
| `401` | Sin sesión. | `string` |
| `403` | Sin permiso `view_network`. | `string` |

## 10. Usuarios

Administración de usuarios y roles.

| Método | Ruta | Descripción | Guard | Respuestas |
|---|---|---|---|---|
| GET | `/api/users` | Lista los usuarios del tenant. | permiso `manage_users` | `200`, `401`, `403` |
| POST | `/api/users` | Crea un usuario. | permiso `manage_users` | `201`, `400`, `401`, `403`, `409` |
| DELETE | `/api/users/{id}` | Borra un usuario. | permiso `manage_users` | `200`, `400`, `401`, `403` |
| PATCH | `/api/users/{id}` | Actualiza el rol de un usuario. | permiso `manage_users` | `200`, `400`, `401`, `403` |

### GET /api/users

Requiere el permiso `manage_users`.

- **Guard:** permiso `manage_users`.
- **Operation ID:** `listUsers`.

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Usuarios del tenant. | `{users: User[]}` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_users`. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `users` | `User[]` | sí | — |

</details>

<details><summary>Campos de <code>401</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### POST /api/users

Requiere el permiso `manage_users`. Sólo un `OWNER` puede crear otro `OWNER`;
un email duplicado responde **409**.

- **Guard:** permiso `manage_users`.
- **Operation ID:** `createUser`.

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `email` | `string` | sí | — |
| `password` | `string` | sí | — |
| `name` | `string` (nullable) | no | — |
| `role` | `"OWNER" \| "ADMIN" \| "OPERATOR"` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `201` | Usuario creado. | `{user: User}` |
| `400` | Cuerpo inválido. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_users` o intento de crear un `OWNER` sin serlo. | `Error` |
| `409` | El email ya existe. | `Error` |

<details><summary>Campos de <code>201</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `user` | `User` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### DELETE /api/users/{id}

Requiere `manage_users` y el rol `OWNER`. No se puede borrar a uno mismo:
**400**.

- **Guard:** permiso `manage_users`.
- **Operation ID:** `deleteUser`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Usuario borrado. | `object` |
| `400` | Intento de borrarse a sí mismo. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_users` o sin ser `OWNER`. | `Error` |

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

### PATCH /api/users/{id}

Requiere `manage_users`; sólo un `OWNER` puede cambiar roles. No se puede
cambiar el propio rol: **400**.

- **Guard:** permiso `manage_users`.
- **Operation ID:** `updateUser`.

**Parámetros**

| Nombre | En | Obligatorio | Tipo | Descripción |
|---|---|---|---|---|
| `id` | path | sí | `string` | Identificador del recurso. |

**Cuerpo** (application/json, obligatorio)

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `role` | `"OWNER" \| "ADMIN" \| "OPERATOR"` | sí | — |

**Respuestas**

| Código | Descripción | Cuerpo |
|---|---|---|
| `200` | Usuario actualizado. | `{user: User}` |
| `400` | Cuerpo inválido o intento de cambiarse el propio rol. | `Error` |
| `401` | Sin sesión. | `Error` |
| `403` | Sin permiso `manage_users` o sin ser `OWNER` para cambiar roles. | `Error` |

<details><summary>Campos de <code>200</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `user` | `User` | sí | — |

</details>

<details><summary>Campos de <code>400</code></summary>

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `error` | `string` | sí | — |

</details>

## 11. Nombres de métrica Prometheus

`GET /api/metrics` expone las familias `ftth_copilot_*` y `ftth_laya_*`:

- `ftth_copilot_process_uptime_seconds`
- `ftth_copilot_process_memory_bytes`
- `ftth_copilot_tenants_total`
- `ftth_copilot_nms_connections_total`
- `ftth_copilot_active_alerts`
- `ftth_copilot_active_incidents`
- `ftth_copilot_metric_samples_total`
- `ftth_copilot_snmp_traps_total`
- `ftth_copilot_service_loop_healthy`
- `ftth_copilot_database_scrape_error`
- `ftth_copilot_llm_requests_total`
- `ftth_copilot_llm_tokens_total`
- `ftth_copilot_llm_latency_seconds_total`
- `ftth_copilot_llm_latency_seconds_count`
- `ftth_copilot_llm_fallback_events_total`
- `ftth_copilot_rag_retrievals_total`
- `ftth_copilot_rag_latency_seconds_total`
- `ftth_copilot_rag_latency_seconds_count`
- `ftth_copilot_router_dispatches_total`
- `ftth_laya_requests_total`
- `ftth_laya_latency_ms`
- `ftth_laya_confidence`

## 12. Notas de la implementación actual

Estas son observaciones verificadas en el código, no recomendaciones. Sirven para no
asumir cosas que el contrato real no garantiza.

1. `GET /api/maintenance-windows` no chequea permiso, mientras que `POST` sí exige `manage_maintenance` (`api/maintenance-windows/route.ts:42` vs `:161`).
2. `/api/vm/query` y `/api/vm/instant` no tienen autenticación y aceptan PromQL arbitrario del query string.
3. El middleware exime de CSRF a todo `/api/auth/*`, y `POST /api/auth/mfa/verify` sets **sólo** la cookie de sesión, no la de CSRF (a diferencia de `/api/auth/login` y `/api/auth/signup`).
4. La forma del error 401 no es uniforme: casi todos devuelven `{error:'Not authenticated'}`; `/api/conversations/[id]` devuelve `{error:'No autenticado.'}` y `/api/ops/stream` devuelve texto plano `Unauthorized`.
5. Sólo `/api/incidents` y `/api/predictions` usan paginación por cursor (`apps/web/lib/api/pagination.ts`: `DEFAULT_LIMIT=50`, `MAX_LIMIT=200`).
