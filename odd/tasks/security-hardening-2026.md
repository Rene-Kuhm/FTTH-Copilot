# Security Hardening 2026

**Status**: In Progress
**Created**: 2026-10-05
**Last Updated**: 2026-10-05

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

### ⏳ Pendientes

| ID | Hallazgo | Severidad | Estado | Tracking |
|----|----------|-----------|--------|----------|
| SEC-007 | braces DoS (GHSA-vfj7-8cjw-p6xm) | Alto | Monitorizando | Task: BRACES-1 |
| SEC-008 | Rate limiter in-memory (multi-instance) | Medio | En progreso | - |
| SEC-009 | RBAC en middleware | Medio | Pendiente | - |
| SEC-010 | CSRF tokens | Bajo | Pendiente | - |

---

## Mejoras en Progreso

### SEC-008: Rate Limiter con Redis

**Problema**: El rate limiter actual usa un Map in-memory que no funciona con múltiples instancias de Next.js en producción.

**Limitación arquitectural**: El middleware corre en Edge runtime donde no se puede usar Prisma ni Redis.

**Solución recomendada para producción**:
1. Usar rate limiting a nivel de infraestructura:
   - **Vercel**: Built-in rate limiting
   - **Cloudflare**: Cloudflare Rate Limiting
   - **Custom**: Redis + API route (no Edge)

2. Para desarrollo local: in-memory funciona bien

**Estado**: Documentado como limitación. No se implementa en esta fase.

**Referencias**:
- docs/production-deployment.md (actualizar con rate limiting strategy)

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
| `tests/lib/auth/csrf.test.ts` | 11 tests para CSRF utilities |
| `e2e/auth-csrf.spec.ts` | E2E tests para CSRF + auth flow |

---

## Links

- PR #270: Security patches
- PR #272: Auth middleware centralizado + RBAC
- PR #273: CSRF protection (próximo)
- Task BRACES-1: odd/tasks/braces-security-fix.md
