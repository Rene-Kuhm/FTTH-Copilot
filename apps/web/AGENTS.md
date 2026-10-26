<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Contexto del módulo — `apps/web`

> Las reglas generales del repo están en [AGENTS.md](../../AGENTS.md). Las capas y los límites entre
> módulos, en [ARCHITECTURE.md](../../ARCHITECTURE.md).

## Qué es

Capa L5. La **única** capa que conoce a todos los demás paquetes: la aplicación Next.js 16 (App
Router) con el chat con IA, los tableros NOC y SOC, y los endpoints REST.

## Qué invariantes cuida

- **Ningún endpoint arma su propio prompt.** El razonamiento vive en `@ftth-copilot/agent-core`; las
  rutas HTTP consumen su API. Lo mismo vale para los endpoints que hable con un NMS: el adaptador
  y la política SSRF están en `@ftth-copilot/connectors/*`.
- **Todo endpoint lee y escribe con `tenantId`.** El aislamiento por tenant no es opcional en `app/`
  ni en `lib/`.
- **La sesión manda.** `middleware.ts` valida la cookie y el CSRF; los handlers usan `getCurrentUser`
  y `hasPermission`, no su propio control de acceso.
- **El truth gate se respeta en la UI.** Si la respuesta viene con abstención o con advertencia, se
  renderiza como tal; no se reescribe el texto del modelo.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/web test        # unitarios (Vitest)
pnpm --filter @ftth-copilot/web test:e2e    # Playwright, requiere Postgres
```

Los E2E reales (`e2e/auth-real.spec.ts`) necesitan `DATABASE_URL`, `JWT_SECRET`, `KMS_MASTER_KEY` y
`ENABLE_TEST_AUTH_BYPASS=true`; el CI los provee.

## Qué no tocar

- `middleware.ts` y `lib/auth/`: son el límite de autorización. Un cambio acá necesita su propio
  test de regresión.
- Un endpoint nuevo sin su caso en `tests/api/`: cada ruta llega con su prueba.
- `next.config.mjs` y el bloque gestionado de este archivo: los reescribe Next.js.

## Superficie pública

No expone una API de paquete: su superficie es `app/` (rutas), `lib/` (helpers) y `components/`.
`mise run repo-map` imprime el esqueleto del repo completo.
