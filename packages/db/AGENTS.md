# AGENTS.md — `@ftth-copilot/db`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L1. **El único paquete que conoce Prisma y el KMS**: esquema, cliente tipado, migraciones,
cifrado AES-256-GCM derivado de `KMS_MASTER_KEY`, y las utilidades de sesión y rate limiting.

## Qué invariantes cuida

- **`src/generated/` no se edita a mano.** Es el cliente Prisma generado: se regenera con
  `pnpm db:generate`.
- **`prisma/migrations/` es historial aplicado.** Editar una migración ya aplicada rompe el
  despliegue: se agrega una migración nueva.
- **El cifrado falla cerrado.** Sin `KMS_MASTER_KEY` válida, el arranque falla; nunca se cifra con
  una clave por defecto.
- **El seed no corre en producción** salvo `ALLOW_PRODUCTION_SEED=true` explícito.
- **Toda consulta lleva `tenantId`.**

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/db test             # unitarios
pnpm --filter @ftth-copilot/db test:integration # requiere Postgres
```

Los tests de integración necesitan `DATABASE_URL` y el schema aplicado con `db:deploy`.

## Qué no tocar

- `prisma/migrations/` y `src/generated/` (ver [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §9).
- `src/crypto.ts`: el formato del blob cifrado es persistente; cambiarlo invalida las claves ya
  guardadas.

## Superficie pública

`src/index.ts` reexporta el cliente `prisma`, los helpers de auth (`issueToken`, `hashPassword`),
el cifrado de API keys (`encryptApiKey`, `decryptApiKey`) y el rate limiting por usuario.
El esqueleto completo lo imprime `mise run repo-map`.
