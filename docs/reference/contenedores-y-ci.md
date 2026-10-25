# Referencia de contenedores y CI

## 1. Imágenes

### `Dockerfile` raíz — 4 stages

| Stage | Base | Qué hace |
|---|---|---|
| `base` | `node:22-alpine` | pnpm 11.22.0 vía corepack, `libc6-compat`, `openssl` (`:6-12`) |
| `dependencies` | `base` | `pnpm install --frozen-lockfile` para `packages/` + `apps/` (`:15-27`) |
| `builder` | `base` | `ARG JWT_SECRET` **inlineado** en el bundle Edge (`:30`), `prisma generate`, `NEXT_OUTPUT_MODE=standalone` (`:32-45`) |
| `runner` | `node:22-alpine` | Usuario no-root `nextjs` (uid 1001), copia el schema de Prisma, el bundle standalone y `.next/static`. `EXPOSE 3001 1162/udp 5514/udp`, healthcheck `wget .../api/health`, `CMD ["node","apps/web/server.js"]` (`:48-76`) |

### `services/laya/Dockerfile`

`python:3.10-slim`, `pip install -r requirements.txt`, healthcheck en `/health`, `EXPOSE 8080`.

### `docker/snmp-lab/Dockerfile`

`alpine:3.20` + `net-snmp-tools`, con `MIBDIRS=/opt/snmp-lab/mibs` aislado y entrypoint
propio. Sirve para el laboratorio de conformidad.

## 2. `docker-compose.yml` — base de desarrollo

| Servicio | Imagen | Puertos | Volúmenes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `${POSTGRES_PORT:-5432}:5432` | `postgres_data` |
| `laya` | build `./services/laya` | `${LAYA_PORT:-8080}:8080` | — (profile `laya`) |

Healthchecks: `pg_isready` en postgres (`:28`), `curl /health` en laya (`:50`).

## 3. `docker-compose.demo.yml` — demo de un comando

| Servicio | Imagen | Puertos | Volúmenes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `${POSTGRES_PORT:-5432}:5432` | `postgres_demo_data` |
| `pgbouncer` | `edoburu/pgbouncer:1.24` | `${PGBOUNCER_PORT:-6432}:6432` | `docker/pgbouncer.ini`, `docker/pgbouncer-users.txt` (ro) |
| `db-migrate` | build `.` target `dependencies` | — | — |
| `app` | build `.` target `runner` | `${PORT:-3001}:3001` | — |
| `victoriametrics` | `victoria-metrics:v1.153.0` | `${VICTORIAMETRICS_PORT:-8428}:8428` | `victoriametrics_demo_data`, entrypoint + scrape (ro) |
| `vmalert` | `vmalert:v1.153.0` | — | `docker/victoriametrics-alerts.yml` (ro) — profile `alerts` |
| `laya` | build `./services/laya` | `${LAYA_PORT:-8080}:8080` | — — profile `laya` |
| `ntfy` | `binwiederhier/ntfy:v3.3.0` | `${NTFY_PORT:-8125}:80` | `ntfy_cache` |
| `db-seed` | build `.` target `dependencies` | — | — |

Red `ftth-demo` (bridge).

Notas verificadas:

- El build de `app` requiere el build arg `JWT_SECRET` (`:86-132`).
- `app` conecta **directamente a Postgres**, no a PgBouncer: la imagen de PgBouncer ya no
  está en Docker Hub (`:110-118`).
- `db-seed` necesita `SEED_ADMIN_PASSWORD`, `ALLOW_PRODUCTION_SEED=true` y
  `DEMO_DATA_ENABLED=true` (`:257-259`).

## 4. `docker-compose.prod.yml` — producción

| Servicio | Imagen | Puertos | Volúmenes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine`, `env_file: .env.prod` | no publicados | `postgres_data` |
| `db-migrate` | build `.` target `dependencies` | — | — |
| `app` | build `.` target `runner`, imagen `ftth-copilot:latest` | `${PORT:-3001}:3001`, `${SNMP_UDP_PORT:-1162}:1162/udp`, `${SYSLOG_UDP_PORT:-5514}:5514/udp` | `spool_data:/var/lib/ftth-copilot/spool` |
| `laya` | build `./services/laya` | `${LAYA_PORT:-8080}:8080` | — — profile `laya` |
| `victoriametrics` | `victoria-metrics:v1.153.0` | `${VICTORIAMETRICS_PORT:-8428}:8428` | `victoriametrics_prod_data` |
| `vmalert` | `vmalert:v1.153.0` | — | `docker/victoriametrics-alerts.yml` (ro) |

Variables del contenedor `app` (`:44-55`): `NODE_ENV=production`, `PORT=3001`,
`EVENT_SPOOL_DIR=/var/lib/ftth-copilot/spool`, `SYSLOG_RECV_BUFFER_BYTES` (default
`4194304`), `LAYA_URL`.

Retención de VictoriaMetrics: 12 meses por defecto (`:130`). Red `ftth-network`. El bloque
de clúster HA de VictoriaMetrics está comentado (`:181-231`).

> `docker compose down -v` **borra el estado de producción**: el compose lo advierte
> explícitamente en `:238-249`.

## 5. `docker-compose.https.yml` — producción detrás de Caddy

| Servicio | Imagen | Puertos |
|---|---|---|
| `postgres` | `postgres:16-alpine`, `env_file: .env.prod` | no publicados |
| `db-migrate` | build `.` target `dependencies` | — |
| `app` | build `.` target `runner` | `expose: "3001"` (no publicado) |
| `caddy` | `caddy:2-alpine` | `${CADDY_HTTP_PORT:-80}:80`, `${CADDY_HTTPS_PORT:-443}:443` |

Caddy monta `Caddyfile.prod` (ro), con volúmenes `caddy_data` y `caddy_config`, y recibe
`CADDY_DOMAIN` (`:91`). El compose provisiona el certificado Let's Encrypt
automáticamente (`:1-14`).

## 6. PM2 — `ecosystem.config.cjs`

| App | Script | Entorno |
|---|---|---|
| `ftth-copilot` | `/bin/bash` + `apps/web/start.sh` (ruta absoluta del host) | `env_file: './apps/web/.env'`, `NODE_ENV=production` (`:26-39`) |
| `cloudflared` | `cloudflared tunnel --protocol http2 --no-autoupdate run` | `TUNNEL_TOKEN` leído del `.env` de la raíz, que nunca se commitea (`:40-49`) |

`cloudflared` tiene `restart_delay: 5000` y `max_restarts: 10` (`:47`).

## 7. systemd — `docker/vmbackup.service`

Sidecar `vmbackup` de VictoriaMetrics. `Type=oneshot`,
`ExecStart=/vmbackup-prod -storageDataPath=/storage -dest=${BACKUP_DEST:-file:///backups}`.
Variables: `BACKUP_INTERVAL`, `BACKUP_DEST`, `RETENTION_DAYS` (`:9-11`). Hay una plantilla de
timer systemd comentada (`:47-50`). Es el único `*.service` del repo.

## 8. Workflows de GitHub Actions

| Workflow | Triggers | Jobs |
|---|---|---|
| `ci.yml` | push a `main`, pull_request a `main`. Concurrencia `ci-${{ github.ref }}` con cancel-in-progress (`:30`) | `lint-and-typecheck` (`:47`) — lint, typecheck, `check:sources` + drift de matriz con `git diff --exit-code`, `check:conflicts`, `check:contribution`; `test-unit` (`:93`) — `pnpm test:coverage-check` + artefacto; `eval` (`:142`, `if: always()`) — harness de eval sin claves LLM; `build` (`:178`); `test-e2e` (`:212`) — Postgres 16, migraciones con `db:deploy`, seed, Playwright; `test-integration` (`:310`) — Postgres 16 + tests de `db` y `alerts`; `ci-success` (`:379`) — gate agregador |
| `codeql.yml` | push/PR a `main`, cron `23 7 * * 1` | `analyze` (`:18`) — `javascript-typescript`, `build-mode: none`, `queries: security-extended` |
| `eval-nightly.yml` | cron `0 3 * * *`, `workflow_dispatch` | `eval-nightly` (`:55`) — harness, lint, `metrics-report`, resumen con `attackPassRate`/`coverage`/`abstentionRate`/`gateFp`/`precision`/`schema`, subida de `packages/eval/reports/metrics-summary.json` (retención 90 días) |
| `quarterly-sources-audit.yml` | cron `0 0 1 */3 *`, `workflow_dispatch` | `sources-audit` (`:11`) — `check:sources`, `check:conflicts`, `check:contribution`, `check:sources:health --timeout=8000`, frescura de la matriz |
| `android-apk.yml` | push a `main`/`design-system-v1`/`capacitor-android`, tags `v*`; PR sobre `apps/web/**`, `apps/web/android/**` | `build` (`:22`) — Node 22, pnpm 11.22.0, JDK 21, Android SDK (platform-tools, android-34, build-tools 34.0.0), `cap sync`, `gradlew assembleDebug` + `assembleRelease`, subida de ambos APK |
| `tauri-desktop.yml` | push a `main`/`tauri-desktop`, tags `v*`; PR sobre `apps/web/**`, `apps/web/src-tauri/**` | `build-linux` (`:22`) — ubuntu-22.04, Rust estable, webkit2gtk, `pnpm build` + `pnpm tauri:prepare`, `tauri build --bundles deb,appimage`; `build-windows` (`:107`) — `--bundles nsis,msi`; `attach-to-release` (`:176`) — en tags `v*` |

Entorno de CI: `NODE_VERSION=22`, `PNPM_VERSION=11.22.0` (`ci.yml:37`).

En el build de Tauri: `NEXT_PUBLIC_API_URL` (default `https://demo.ftth-copilot.com`) y
`NEXT_PUBLIC_PLATFORM=tauri`.
