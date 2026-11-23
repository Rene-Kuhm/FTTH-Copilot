# T5 — Fuzz de rutas API (`apps/web`)

**Feature**: `odd/tasks/fuzz-parsers.md`
**Specs**: S1, S3, S4, S5, S7
**Ruta**: worker

## Qué hacer

Suite de fuzzing sobre rutas `POST`/`PATCH` de `apps/web/app/api/` que validan el
cuerpo con Zod y hoy no tienen cobertura de unit tests. Candidatas confirmadas:

- `app/api/users/[id]/route.ts:42` (PATCH, `updateUserSchema`)
- `app/api/incidents/route.ts:30` (POST, `z.object` inline)
- `app/api/incidents/[id]/route.ts:120` (PATCH, `updateSchema`)
- `app/api/ops/oncall/route.ts:134,173` (POST/PATCH)
- `app/api/ops/notifications/route.ts:91,132` (POST/PUT)
- `app/api/ops/runbooks/route.ts:146` (POST, validación manual)
- `app/api/maintenance-windows/[id]/route.ts:49` (PATCH)
- `app/api/maintenance-windows/[id]/reevaluate/route.ts:63` (POST)
- `app/api/fiber-plans/[id]/zones/route.ts` y `.../markers/route.ts` (POST/PATCH)
- `app/api/auth/mfa/{setup,verify,disable}/route.ts` (validación manual)

Cada ruta fuzzeada debe cumplir: devuelve 4xx con cuerpo estable, o 2xx con el
tenant de la sesión; nunca 5xx por entrada malformada; nunca filtra la contraseña, la
API key ni el marcador sintético; y la escritura usa siempre el `tenantId` de la
sesión, nunca uno del body.

Guardas obligatorias: anti-crash (una entrada malformada no puede producir un 500 ni
una excepción no manejada), deadline (deadline por request), fuga (marcador ausente
del body de respuesta) y aislamiento por tenant.

Los `vi.mock` de Prisma, auth y permisos se hacen como en
`apps/web/tests/api/fuzz.test.ts` (borrador previo existente). Las rutas que toca
`packages/db` deben quedar con el mock puesto: la suite no toca la base real.

Corpus semilla sintético en `apps/web/tests/api/fuzz/corpus/`: cuerpos JSON mínimos
válidos, cuerpos con campos faltantes, con tipos equivocados, con roles/estados
inválidos y con marcador sintético.

## Superficie de edición permitida

- `apps/web/tests/api/**` (suite y corpus)
- `apps/web/package.json` (script `test:fuzz`)

## Fuera de superficie

No tocar `apps/web/app/**`. No tocar `packages/db/**`. No commitear.

## Criterios de aceptación

- `pnpm --filter @ftth-copilot/web test:fuzz` pasa.
- Ningún test abre conexión a la base ni a la red.
- El corpus semilla se carga y se ejecuta en cada corrida.
