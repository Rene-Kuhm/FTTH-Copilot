# Security Hardening 2026

**Status**: In Progress
**Created**: 2026-10-05
**Last Updated**: 2026-11-02

## Resumen

Este documento tracking todas las mejoras de seguridad identificadas durante la auditoría de octubre 2026 y su estado de implementación.

---

## Hallazgos de Auditoría

### ✅ Resueltos

| ID | Hallazgo | Severidad | Solución | PR |
|----|----------|-----------|----------|-----|
| SEC-001 | Next.js RCE (GHSA-vcvr-r3jv-pc5j) | Crítico | Actualizado a 16.3.6 | #270 |
| SEC-002 | Cookie mismatch (auth-token vs ftth_session) | Crítico | Corregido nombre de cookie | #270 |
| SEC-003 | Path traversal en upload | Alto | Sanitización de extensiones | #270 |
| SEC-004 | brace-expansion DoS | Alto | Override >=1.1.20 | #270 |
| SEC-005 | Auth middleware centralizado | Crítico | Middleware con redirect a login | #272 |
| SEC-006 | E2E test bypass para auth | - | globalSetup con __test_bypass | #272 |
| SEC-008 | Rate limiter in-memory (multi-instance) | Medio | Limite global en Redis, con respaldo en memoria | PR #351 |

### ⏳ Pendientes

| ID | Hallazgo | Severidad | Estado | Tracking |
|----|----------|-----------|--------|----------|
| SEC-007 | braces DoS (GHSA-vfj7-8cjw-p6xm) | Alto | Monitorizando, sin fix upstream | Task: BRACES-1 |

### ✅ Resueltos en PR #274

| ID | Hallazgo | Severidad | Solución |
|----|----------|-----------|----------|
| SEC-009 | RBAC ausente en middleware | Medio | Clasificacion de rutas + jerarquia de roles |
| SEC-010 | Sin proteccion CSRF explicita | Alto | Double-submit cookie con gate en middleware |

### 🔧 Correccion posterior: SEC-011

**SEC-010 quedo incompleta al mergearla.** La cookie `ftth_csrf` se emitio con
`HttpOnly` mientras el middleware exigia el header `X-CSRF-Token`, y ningun
cliente lo enviaba. Como `validateCsrfToken()` retorna `false` cuando falta el
header, **toda mutacion contra `/api/*` respondia 403**.

En double-submit el token no es un secreto: la proteccion viene de que un
atacante cross-site no puede leer la cookie ni mandar headers custom.
`HttpOnly` corresponde a la cookie de **sesion** (`ftth_session`), que si lo
mantiene.

Correccion:
1. `ftth_csrf` sin `HttpOnly`, conservando `Path=/` y `SameSite=Strict`.
2. Helper `csrfFetch()` que adjunta el header en POST/PUT/PATCH/DELETE.
3. Los 25 call sites de mutacion migrados en 13 componentes.
4. Test de guarda que falla si una mutacion vuelve a llamar a `fetch` directo.

El gap de tests que dejo pasar el bug: **ningun test importaba `middleware.ts`**
(cero cobertura) y los E2E solo mutaban `/api/auth/*`, que esta exento. Ambos
huecos estan cerrados ahora.

---

## Mejoras en Progreso

### ✅ SEC-008: Rate Limiter con Redis (resuelto)

**Problema**: El rate limiter anterior usaba un Map in-memory que no funciona con
múltiples instancias de Next.js en producción.

**Limitación arquitectural que sigue en pie**: el middleware corre en Edge runtime,
donde no se puede usar Prisma ni Redis (no hay TCP). Por eso el middleware **no**
puede tener un límite global.

**Solución implementada** (PR #351): partir el limiter en dos capas que comparten el
mismo núcleo, y cambiar solo el almacén.

1. **Núcleo puro** (`apps/web/lib/rate-limit-core.ts`): los límites por defecto, la
   clave (tenant o IP), la respuesta 429 y el almacén en memoria. Sin runtime, sin
   Prisma, sin Redis. Las dos capas usan el mismo núcleo, así que no pueden divergir en
   cómo cuentan.
2. **Almacén con Redis** (`apps/web/lib/rate-limit-store.ts`): la cuenta vive en la
   **misma Redis que usa la cola del worker** —la URL sale de `REDIS_URL`, la misma
   variable que usa la cola, y un test la compara contra `redisConnectionOptions()` de
   `@ftth-copilot/jobs` para que las dos capas no divergan. Claves con prefijo
   `ftth:rl:` para no pisar la cola. `INCR` + `PEXPIRE` + `PTTL` en un único guion de
   Lua, que es atómico: por separado dejarían una ventana sin caducidad.
3. **Aplicación en las rutas que mutan estado**: las 26 rutas con `POST`/`PUT`/
   `PATCH`/`DELETE` llaman a `enforceApiRateLimit(req, user.tenantId)` en el handler,
   después del chequeo de sesión. Límite: 60 req/min por tenant, global entre réplicas.
4. **El middleware sigue como fast path** y como red de seguridad: su límite en
   memoria (100 req/min, 200 en `/api/auth/*`) corre antes que cualquier ruta.

**Reglas que el código hace explícitas**:

- **Sin `REDIS_URL` no se cae nada**: cae el almacén en memoria y el límite queda por
  instancia. Es lo esperado en el modo embebido y en desarrollo local.
- **Si Redis falla, la petición pasa** (fail-open). Un limiter que tumba la API cuando
  parpadea la Redis es peor que no tener limiter; el middleware de Edge sigue aplicando
  su límite en memoria.
- **El primer comando espera a que la conexión esté lista**. Con la cola offline
  desactivada, un comando que sale durante el handshake se pierde en vez de
  encolarse: sin esa espera las primeras peticiones de cada proceso no contarían y el
  límite real sería mayor que el configurado.

**Fuera del alcance, a propósito**: `/api/auth/*` y `/api/chat` ya tienen cuota global
contra Postgres (`packages/db/src/auth-rate-limit.ts` y `apps/web/lib/rate-limit.ts`).
Meterles un límite en Redis sería duplicar la misma regla en dos almacenes con reglas
de caducidad distintas.

**Tests**: `apps/web/tests/lib/rate-limit-core.test.ts` (ventana y concurrencia),
`apps/web/tests/lib/rate-limit-store.test.ts` (respaldo en memoria, fail-open,
namespace) y `apps/web/tests/lib/rate-limit-redis.integration.test.ts` (contra una
Redis de verdad: dos instancias comparten la cuenta, la ventana se reabre, diez
peticiones concurrentes solo dejan pasar las del cupo, y la primera cuenta de un store
nuevo ya cuenta).

**Referencias**:
- `docs/production-deployment.md` §6.4 — estrategia de rate limiting en producción
- `docs/how-to/agregar-un-endpoint-de-la-api.md` §5.1 — cómo aplicarlo en un handler
- `docs/api/README.md` — las tres capas y sus almacenes

### SEC-009: RBAC en Middleware

**Problema**: El middleware actual solo verificaba que el usuario tuviera un token válido, pero no verificaba permisos específicos (OWNER vs OPERATOR).

**Solución implementada**:
1. ✅ Middleware clasifica rutas: `public`, `api`, `protected`, `admin`
2. ✅ Rutas `/admin/*` requieren rol ADMIN u OWNER
3. ✅ Role hierarchy: OWNER > ADMIN > OPERATOR/MEMBER
4. ✅ Headers `x-user-role` pasados a server components
5. ⚠️ Permisos granulares (`hasPermission`) se validan a nivel de API routes

**Estado**: ✅ Implementado en #272

### SEC-010: CSRF Protection

**Problema**: No había tokens CSRF explícitos para mutations.

**Mitigación anterior**: Cookies con SameSite=Lax

**Solución implementada**:
1. ✅ CSRF token generado en login/signup
2. ✅ Almacenado en cookie `ftth_csrf` (HttpOnly, SameSite=Strict)
3. ✅ Validación en middleware para POST/PUT/DELETE/PATCH
4. ✅ Client debe enviar `X-CSRF-Token` header
5. ✅ Constant-time comparison para prevenir timing attacks
6. ✅ Tests unitarios para utilities

**Archivos**:
- `apps/web/lib/auth/csrf.ts`: Utilities CSRF
- `apps/web/lib/auth/server.ts`: Generación en login/signup
- `apps/web/middleware.ts`: Validación en mutations
- `apps/web/tests/lib/auth/csrf.test.ts`: 11 tests

**Estado**: ✅ Implementado

---

## Tests Agregados

| Test | Propósito |
|------|----------|
| `tests/lib/auth/csrf.test.ts` | 11 tests para CSRF utilities de servidor |
| `tests/lib/auth/csrf-client.test.ts` | 12 tests del helper + guard test de call sites |
| `tests/middleware/csrf-gate.test.ts` | 10 tests de la gate en `middleware.ts` |
| `e2e/auth-csrf.spec.ts` | E2E de la gate y del redirect de auth |

## Links

- PR #270: Security patches
- PR #272: Auth middleware centralizado
- PR #274: RBAC + CSRF (SEC-009, SEC-010)
- PR #275: Correccion del cliente CSRF (SEC-011)
- Task BRACES-1: odd/tasks/braces-security-fix.md
- Task SEC-011: odd/tasks/csrf-client-header-fix.md
