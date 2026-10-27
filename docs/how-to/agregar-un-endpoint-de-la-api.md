# Agregar un endpoint de la API

**Objetivo:** agregar una ruta HTTP en `apps/web/app/api/**` que resuelva sesión,
permisos, aislamiento por tenant, CSRF, cuota y auditoría como corresponde.

## Requisitos

- Node ≥ 22, pnpm 11.22.0.
- Next.js 16 con App Router: las rutas se declaran en archivos `route.ts`.
- `zod` ya está en las dependencias de `apps/web` para validar el body.

## 1. Entendé qué hace el middleware (y qué NO hace)

`apps/web/middleware.ts` clasifica toda ruta que empieza con `/api/` como `api`. Para esa
clasificación el middleware aplica **sólo**:

| Qué | Detalle |
|---|---|
| Exención de `/api/health` | Sale antes de todo: sin rate limit, sin CSRF, sin headers de seguridad |
| CSRF | En `POST`/`PUT`/`DELETE`/`PATCH` exige el header `X-CSRF-Token` igual a la cookie `ftth_csrf`. Sin match ⇒ `403 {error:'Invalid CSRF token'}`. **Exento: `/api/auth/*`** |
| Rate limit | `/api/auth/*` ⇒ 200 req/60 s; el resto ⇒ 100 req/60 s. Clave `tenant:<tenantId>` del JWT o `ip:<x-forwarded-for>` |
| Límite excedido | `429 {error:'Too many requests', retryAfter}` + `retry-after` y `x-ratelimit-reset` |
| Headers | `x-ratelimit-remaining`, `x-ratelimit-reset`, `nosniff`, `DENY` frame, `referrer-policy`, CSP, HSTS en producción |

> **El middleware nunca aplica auth a las rutas de API.** La autorización vive dentro de
> cada handler. Si tu handler no resuelve la sesión, tu endpoint queda abierto.

El rate limit del middleware es **en memoria y por instancia**
(`apps/web/middleware/rate-limit.ts`): en despliegues multi-instancia no es un límite
global. Las cuotas de negocio, que sí van a la base, están aparte (paso 5).

## 2. Resolvé la sesión y el permiso

La sesión se resuelve con `getCurrentUser()` (`apps/web/lib/auth/server.ts`): verifica el
JWT **y** que exista la fila `prisma.session` vigente. Devuelve `null` si no hay cookie,
si el token no valida o si la sesión expiró.

El permiso se chequea con `hasPermission(role, permission)`
(`apps/web/lib/auth/permissions.ts`). Los permisos disponibles son:

```text
manage_users  manage_connectors  manage_incidents  view_all_conversations  chat
view_own_conversations  delete_conversations  view_network  ack_alerts
execute_actions  manage_maintenance
```

| Rol | Permisos |
|---|---|
| `OWNER` | Los 11 |
| `ADMIN` | Todos salvo `execute_actions` |
| `OPERATOR` / `MEMBER` | `chat`, `view_own_conversations`, `delete_conversations`, `view_network`, `ack_alerts`, `manage_incidents` |

## 3. Escribí el handler

Los handlers exportan `GET`, `POST`, `PUT`, `PATCH` o `DELETE` desde
`apps/web/app/api/<recurso>/route.ts` (o `apps/web/app/api/<recurso>/[id]/route.ts`).
El esqueleto mínimo, con los imports reales del repo:

```ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@ftth-copilot/db';
import { getCurrentUser } from '@/lib/auth/server';
import { hasPermission } from '@/lib/auth/permissions';
import { auditConnector } from '@ftth-copilot/soc';
import { buildAuditContext } from '@/lib/audit-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  label: z.string().trim().min(1).max(80),
  deviceId: z.string().trim().min(1).max(120),
});

export async function POST(req: Request): Promise<NextResponse> {
  // 1. Sesión
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // 2. Permiso
  if (!hasPermission(user.role, 'view_network')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  // 3. Body validado con zod
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 4. Lectura con scope por tenant
  //    `someModel` es un placeholder: reemplazalo por el modelo Prisma real.
  const existing = await prisma.someModel.findFirst({
    where: { id: parsed.data.deviceId, tenantId: user.tenantId },
  });

  // 5. Un recurso de otro tenant es 404, NO 403
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // 6. Mutación
  const updated = await prisma.someModel.update({
    where: { id: existing.id },
    data: { label: parsed.data.label },
  });

  // 7. Auditoría — usá el helper que corresponda al recurso (ver paso 4)
  await auditConnector.updated(
    buildAuditContext(req as unknown as import('next/server').NextRequest, user),
    existing.id,
  );

  return NextResponse.json({ item: updated });
}
```

Los puntos que no se negocian:

- **`runtime = 'nodejs'`** si el handler usa Prisma, criptografía o sockets. El runtime
  Edge no tiene acceso a Prisma.
- **`dynamic = 'force-dynamic'`** en handlers que dependen de la sesión, para que no se
  cacheen.
- **El scope por tenant va en el `where` de la query**, no en un filtro posterior.
- **Un recurso que no es del tenant responde 404, no 403.** Un 403 confirmaría que el
  recurso existe. Es la convención que ya usa
  `apps/web/app/api/incidents/[id]/route.ts`.
- **El body se valida con zod** y el error de validación devuelve 400 con
  `parsed.error.flatten()`.

## 4. Registrá la auditoría

Las mutaciones que tocan recursos sensibles se auditan con el módulo
`packages/soc/src/audit.ts`. Hay helpers por dominio:

| Helper | Qué audita |
|---|---|
| `auditAuth` | Login, logout, denegación de permiso |
| `auditUser` | Creación, cambio de rol, borrado |
| `auditConnector` | Creación, actualización, borrado, test de conexión |
| `auditIncident` | Creación, confirmación, resolución |
| `auditMaintenance` | Ventanas de mantenimiento |
| `auditNotification` | Canales y entregas fallidas |

Para una categoría que todavía no tiene helper, usá la función base:

```ts
import { audit } from '@ftth-copilot/soc';

await audit(buildAuditContext(req as unknown as NextRequest, user), {
  category: 'NETWORK',            // uno de AuditCategory
  action: 'created runbook',
  resourceType: 'Runbook',
  resourceId: created.id,
  outcome: 'SUCCESS',             // SUCCESS | FAILURE
  metadata: { deviceKind, deviceId },
});
```

Reglas del módulo de auditoría:

- El `metadata` **nunca** lleva credenciales, tokens, passwords ni API keys completas.
- `resourceId` es la clave primaria de la fila afectada, no la fila entera.
- Las acciones iniciadas por el sistema usan `actorId: "system"`.
- `audit()` **traga los errores**: una auditoría fallida nunca revierte la operación que
  la disparó. Igual conviene `await`earla para no perderla por GC.

`buildAuditContext` (`apps/web/lib/audit-context.ts`) arma el contexto desde el request y
el usuario: IP de `x-forwarded-for` o `x-real-ip`, user-agent, tenant, actor y rol.

## 5. Aplicá la cuota si el endpoint es caro

Las cuotas de negocio van a la base (`RateLimitBucket`) y son por usuario, no por IP:

| Tipo | Función | Variables |
|---|---|---|
| Chat | `consumeChatQuota(userId)` (`apps/web/lib/rate-limit.ts`) | `CHAT_RATE_LIMIT_PER_MINUTE` (10), `CHAT_DAILY_QUOTA` (200) |
| Investigación | `consumeInvestigationQuota(userId)` (`apps/web/lib/investigations/quota.ts`) | `INVESTIGATION_RATE_LIMIT_PER_MINUTE` (10), `INVESTIGATION_DAILY_QUOTA` (100) |

Si el endpoint consume una de esas cuotas:

```ts
const quota = await consumeInvestigationQuota(user.id);
if (!quota.allowed) {
  return NextResponse.json(
    { error: 'Investigation quota exceeded', retryAfter: quota.retryAfter },
    { status: 429 },
  );
}
```

Para un recurso nuevo con su propia cuota, el patrón es el mismo: un `upsert` sobre
`RateLimitBucket` con `scope` propio (`'chat:minute'`, `'chat:day'`,
`'investigation:minute'`, `'investigation:day'`), con la ventana como parte de la clave
única.

Para paginación, `apps/web/lib/api/pagination.ts` define `DEFAULT_LIMIT = 50` y
`MAX_LIMIT = 200`.

## 6. Agregá el endpoint a la referencia

La [referencia de la API HTTP](../reference/api-http.md) es la fuente de verdad de las
rutas. Sumá la fila con método, permiso y forma de respuesta, en la sección que
corresponda. Si el cambio altera el comportamiento de una ruta existente, actualizá la
tabla en el mismo commit.

## 7. Probá la ruta

```bash
# Sesión + CSRF
curl -sS -c /tmp/ftth.cookies -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ftth-copilot.local","password":"<tu password>"}'

CSRF=$(awk '$6=="ftth_csrf"{print $7}' /tmp/ftth.cookies)

# Endpoint nuevo
curl -sS -b /tmp/ftth.cookies -X POST http://127.0.0.1:3001/api/<tu-recurso> \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF}" \
  -d '{"label":"prueba","deviceId":"OLT-1"}'
```

Y el chequeo automático:

```bash
pnpm turbo run lint typecheck test
pnpm --filter @ftth-copilot/web test
```

## Cómo verificar

```bash
# El endpoint responde y no filtra existencia cross-tenant
curl -sS -o /dev/null -w '%{http_code}\n' -b /tmp/ftth.cookies \
  http://127.0.0.1:3001/api/<tu-recurso>

# La auditoría quedó escrita
curl -sS -b /tmp/ftth.cookies 'http://127.0.0.1:3001/api/audit?limit=5'
```

`GET /api/audit` devuelve `{rows, byDay, pagination, generatedAt}` con la categoría, la
acción, el outcome y el actor de cada evento.

## Troubleshooting

- **`403 {error:"Invalid CSRF token"}`** → falta el header `X-CSRF-Token` o no coincide
  con la cookie `ftth_csrf`. Sólo `/api/auth/*` está exento de CSRF.
- **`429 {error:"Too many requests", retryAfter}`** → rate limit del middleware (100
  req/min por tenant o IP). Los headers `retry-after` y `x-ratelimit-reset` dicen
  cuándo reintentar.
- **`401 {error:"Not authenticated"}`** → no hay cookie `ftth_session`, el JWT no valida o
  la fila `Session` no existe / expiró. `getCurrentUser()` exige las dos cosas.
- **El endpoint responde bien pero devuelve datos de otro tenant** → falta
  `tenantId: user.tenantId` en el `where` de la query.
- **Un recurso ajeno devuelve 403 en vez de 404** → estás devolviendo 403 por el permiso
  cuando el recurso no existe. El orden correcto es: primero sesión (401), luego permiso
  (403), luego existencia + tenant (404).
- **`PrismaClientKnownRequestError` con código `P2025`** → el `update` usó un `where` por
  `id` sin filtro de tenant. Buscá primero con `findFirst({where: {id, tenantId}})` y
  actualizá por la clave primaria.
- **El handler falla en runtime Edge** → falta `export const runtime = 'nodejs'`.
- **La respuesta viene cacheada** → agregá `export const dynamic = 'force-dynamic'`.
- **La respuesta 401 sale con un texto distinto al esperado** → la forma del error 401 no
  es uniforme en el repo: casi todos devuelven `{error:'Not authenticated'}` pero
  `/api/conversations/[id]` devuelve `{error:'No autenticado.'}` y `/api/ops/stream`
  devuelve texto plano. Elegí una y sé consistente dentro de tu ruta.
