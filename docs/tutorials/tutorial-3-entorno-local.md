# Tutorial 3 — Entorno local

**Objetivo:** levantar el stack de desarrollo —Postgres, la app Next.js y los tests— para
poder tocar el código y ver los cambios sin Docker.

**Requiere:** Node ≥ 22, pnpm ≥ 11 y Docker (o un Postgres local). No requiere hardware ni
NMS.

---

## 1. Verificá las herramientas

```bash
node --version   # debe ser ≥ 22
pnpm --version   # debe ser ≥ 11
docker --version
```

El repo declara `packageManager: pnpm@11.22.0` y `engines.node >= 22`
(`package.json:7-11`).

## 2. Instalá las dependencias

```bash
pnpm install
```

El `postinstall` corre `pnpm --filter @ftth-copilot/db db:generate`, que genera el cliente
Prisma. Si falla, es casi siempre que falta la base: el generate no la necesita, pero
algunos hooks sí.

## 3. Levantá Postgres

Con Docker:

```bash
docker run -d --name ftth-pg \
  -e POSTGRES_USER=ftth \
  -e POSTGRES_PASSWORD=ftth \
  -e POSTGRES_DB=ftth_copilot \
  -p 5432:5432 postgres:16
```

Espera a que esté listo:

```bash
docker exec ftth-pg pg_isready -U ftth -d ftth_copilot
```

## 4. Configurá el entorno

El repo trae `.env.example`. Copialo y completá lo mínimo:

```bash
cp .env.example .env
```

Editá `.env` y poné estos valores:

```bash
DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot

# Secretos de desarrollo: generá los tuyos con
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=<32 bytes en hex>
KMS_MASTER_KEY=<otros 32 bytes en hex>

# Datos de demo: el chat y el dashboard usan fixtures
DEMO_MODE_ENABLED=true
SMARTOLT_USE_MOCK=true
```

`JWT_SECRET` y `KMS_MASTER_KEY` tienen un fallback de desarrollo, pero **en producción el
proceso se niega a arrancar sin ellos**
(`packages/db/src/auth.ts:26`, `packages/db/src/crypto.ts:23`).

> Alternativa: `pnpm run setup` hace todo esto por vos, con un asistente interactivo que
> además genera los secretos y migra. `pnpm run setup -- --non-interactive` lo hace sin
> preguntar.

## 5. Migrá y sembrá

```bash
pnpm db:deploy
pnpm db:seed
```

`db:deploy` usa `prisma migrate deploy` — el camino de producción, que aplica las
migraciones existentes sin crear ninguna nueva. Para desarrollo, `pnpm db:migrate`
(`prisma migrate dev`) genera migraciones nuevas cuando tocás el schema.

El seed crea el tenant de demo, usuarios, una conexión NMS y datos sintéticos. Imprime la
contraseña del admin.

## 6. Levantá la app

```bash
pnpm dev
```

`turbo run dev` levanta todas las apps del workspace. La web queda en
**http://localhost:3001** (`apps/web/package.json:7`).

Entrá con el admin que te imprimió el seed.

## 7. Corré los tests

```bash
pnpm test          # todo
pnpm test:unit     # sólo unitarios
pnpm lint
pnpm typecheck
```

El `pnpm test` de la raíz es `turbo run test`: corre Vitest en cada paquete. Los paquetes
que no tienen tests usan `--passWithNoTests`, así que no es un error que no hagan nada.

Para los tests de integración, que sí necesitan Postgres:

```bash
export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
pnpm --filter @ftth-copilot/alerts test:integration
```

Y los end-to-end (Playwright, necesita Chromium):

```bash
pnpm test:e2e
```

## 8. Corré el sistema sin hardware

Con la app corriendo, abrí **dos terminales más**:

```bash
# Terminal 2 — el NOC detecta una degradación sintética
pnpm test:scenario

# Terminal 3 — el SOC detecta una fuerza bruta sintética
# (requiere SYSLOG_RECEIVER_ENABLED=true y SYSLOG_TENANT_ID en el .env de la app)
pnpm test:syslog
```

`test:scenario` borra y recrea el tenant `scenario-tenant`, así que podés correrlo las
veces que quieras.

Para el lado del NMS:

```bash
# Terminal 4 — NMS mock HTTP en :5515
pnpm test:mock-nms
```

## 9. Entendé dónde está cada cosa

| Querés tocar... | Está en |
|---|---|
| Las tools del agente y el envelope de evidencia | `packages/agent-core/src/tools/` |
| El router de modos | `packages/agent-core/src/adaptive-router.ts` |
| Los detectores puros | `packages/detection/src/` |
| El dedup y la correlación de alertas | `packages/alerts/src/` |
| Los decodificadores SNMP | `packages/monitoring/src/snmp/` |
| Los adapters de fabricante | `packages/monitoring/src/snmp/adapter/` |
| Los detectores de seguridad | `packages/security/src/` |
| El modelo de datos | `packages/db/prisma/schema.prisma` |
| Las rutas de API | `apps/web/app/api/**/route.ts` |
| La interfaz | `apps/web/app/`, `apps/web/components/` |

## 10. Limpiá

```bash
pnpm clean          # borra builds y node_modules
docker rm -f ftth-pg
```

---

## Qué aprendiste

- El stack de desarrollo es Postgres + `pnpm dev`; Docker sólo hace falta para Postgres.
- `pnpm run setup` automatiza casi todo lo de los pasos 3 a 5.
- El sistema se puede ejercitar entero sin una sola OLT física.

## Si algo falla

- **`Can't reach database`** → el Postgres no está levantado o `DATABASE_URL` no apunta a
  él.
- **`prisma generate` falla** → `pnpm install` no terminó; corré `pnpm --filter
  @ftth-copilot/db db:generate` a mano.
- **El chat responde "No hay proveedor LLM configurado"** → falta `LLM_PROVIDER` y una API
  key. En modo demo con `SMARTOLT_USE_MOCK=true` las consultas `direct` funcionan igual
  sin LLM.

## Siguiente

El último tutorial es el que muestra el motor de diagnóstico en su forma completa:
[Tutorial 4 — Una investigación de punta a punta](tutorial-4-una-investigacion.md).
