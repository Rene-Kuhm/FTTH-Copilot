# Referencia de la línea de comandos

Todos los comandos se ejecutan desde la raíz del repo. Requisitos: Node ≥ 22, pnpm 11.22.0
(`package.json:7-11`).

## 1. Scripts del `package.json` raíz

| Script | Qué hace | Workspace que toca |
|---|---|---|
| `postinstall` | `prisma generate` | `@ftth-copilot/db` |
| `setup` / `bootstrap` | Bootstrap completo: crea `.env`, genera secretos, migra y siembra | `scripts/setup.ts` → `@ftth-copilot/db` |
| `db:generate` | `prisma generate` | `@ftth-copilot/db` |
| `db:migrate` | `prisma migrate dev` | `@ftth-copilot/db` |
| `db:deploy` | `prisma migrate deploy` — **el camino de producción** | `@ftth-copilot/db` |
| `db:seed` | `tsx prisma/seed.ts` | `@ftth-copilot/db` |
| `dev` | `turbo run dev` (persistente) | todos |
| `build` | `turbo run build`; depende de `@ftth-copilot/db#db:generate` (`turbo.json:97`) | todos |
| `lint` / `typecheck` / `test` | `turbo run <task>` | todos |
| `clean` | `turbo run clean` + `rm -rf node_modules` | todos |
| `test:unit` / `test:coverage` / `test:coverage-check` | Vitest; `coverage-check` es el gate de cobertura de CI | todos |
| `test:e2e` | Playwright | `@ftth-copilot/web` |
| `test:scenario` | Escenario NOC de degradación | `scripts/seed-scenario.ts` |
| `test:syslog` | Ráfaga syslog SOC | `scripts/send-syslog.ts` |
| `test:mock-nms` | NMS mock HTTP | `scripts/mock-nms.ts` |
| `test:snmp` | Verificación de trampas SNMP | `scripts/test-snmp.ts` |
| `test:conformance` | Suite de conformidad SNMP | `@ftth-copilot/monitoring` |
| `benchmark:snmp` | Benchmark de ingesta SNMP | `scripts/snmp-benchmark.ts` |
| `check:sources` | Detecta drift de la matriz de compatibilidad | `scripts/generate-compatibility-matrix.ts --check` |
| `check:version` | Paridad de semver entre todos los manifiestos | `scripts/check-release-version.ts` |
| `check:sources:health` | Reachability de las URLs de fuentes | `scripts/check-research-sources-health.ts` |
| `check:contribution` | Gate de contribución de vendor | `scripts/validate-contribution.ts` |
| `check:conflicts` | Colisiones de OID entre vendors | `scripts/check-oid-conflicts.ts` |
| `generate:matrix` | Imprime la matriz | `scripts/generate-compatibility-matrix.ts` |
| `generate:matrix:write` | Escribe `docs/compatibility-matrix.md` | ídem con `--write` |
| `sanitize:snmp` | Sanea capturas SNMP | `scripts/sanitize-snmp-capture.ts` |

## 2. Scripts de `scripts/`

### `setup.ts` — bootstrap

```bash
pnpm setup            # asistente interactivo
pnpm setup -- --ci    # sin asistente
```

| Flag | Efecto |
|---|---|
| `--ci`, `--non-interactive`, `-y`, `--yes` | Desactiva el asistente (`setup.ts:83`) |
| `--wizard` | Fuerza el asistente (`setup.ts:157`) |

Qué hace: crea `.env` desde `.env.example` (`setup.ts:101`), reemplaza los placeholders de
`JWT_SECRET` y `KMS_MASTER_KEY` por hex aleatorio (`setup.ts:134`), levanta Postgres con
Docker si hace falta (`setup.ts:70`), y corre `prisma migrate deploy` + `generate` + `seed`.

Escribe: `LLM_PROVIDER`, `*_API_KEY`, `*_MODEL`, `SMARTOLT_USE_MOCK`,
`SMARTOLT_API_BASE_URL`, `SMARTOLT_API_KEY`, `DATABASE_URL`, `SEED_ADMIN_PASSWORD`.

### `seed-scenario.ts` — escenario NOC sintético

```bash
pnpm test:scenario
```

Siembra degradación (RX cayendo hacia −27 dBm, FEC corregido creciendo, FEC no corregido
apareciendo, bias sagging) y corre la pipeline de detección. **Idempotente**: borra y recrea
el tenant `scenario-tenant`. Necesita `DATABASE_URL` con Postgres alcanzable.

### `send-syslog.ts` — escenario SOC sintético

```bash
pnpm test:syslog
```

Envía 6 fallos de auth desde la misma IP + 1 acceso + 1 cambio de configuración por UDP.
Variables: `SYSLOG_HOST` (default `127.0.0.1`), `SYSLOG_PORT` (default `5514`).

### `mock-nms.ts` — NMS mock HTTP

```bash
pnpm test:mock-nms
```

Escucha en `:5515` (`MOCK_NMS_PORT`) y sirve las formas reales de SmartOLT y Mikrowisp:

```text
GET/POST /smartolt/api/system/get_olts
GET/POST /smartolt/api/onu/get_all_onus_details
POST      /mikrowisp/GetRouters    (token en el body JSON)
POST      /mikrowisp/GetMonitoreo
```

### `test-snmp.ts` — verificación SNMP end-to-end

```bash
pnpm test:snmp
```

Envía 13 notificaciones contra `127.0.0.1:12180`: SNMP v1, TrapV2, InformRequest,
v3 authPriv (SHA+AES), `authenticationFailure` de RFC, y trampas de vendor de Huawei, ZTE,
Nokia, FiberHome, Calix, Adtran, VSOL y BDCOM. Usuario v3 hardcodeado `noc-operator`.

### `snmp-benchmark.ts` — benchmark de ingesta

```bash
pnpm benchmark:snmp
```

300 trampas UDP en loopback contra el puerto `12195`. Reporta throughput, delta de heap,
tasa de drop y percentiles de latencia, más latencia por adapter en memoria (8 vendors ×
500 corridas). Escribe `research/olt/conformance-report.json` y `docs/conformance-benchmark.md`.

### `run-conformance-lab.sh` — laboratorio de conformidad sin hardware

```bash
./scripts/run-conformance-lab.sh            # usa Docker si está disponible
./scripts/run-conformance-lab.sh --native   # sin build de imagen
```

Auto-detecta `docker` y luego `podman` (`run-conformance-lab.sh:12`). Corre
`pnpm --filter @ftth-copilot/monitoring run test tests/conformance` más el benchmark.

### `run-demo.sh` — demo de un comando

```bash
./scripts/run-demo.sh          # start (default)
./scripts/run-demo.sh down
./scripts/run-demo.sh reset    # down -v + borra .env
./scripts/run-demo.sh logs
```

Crea `.env` desde `docs/demo-env-template.md`, compila la imagen y levanta
`docker-compose.demo.yml`. Necesita Docker y los puertos 5432 y 3001 libres.

### `run-qa.py` — QA del agente

```bash
python3 scripts/run-qa.py [endpoint]
```

Por defecto `http://127.0.0.1:3001/api/chat`. Hace 10 preguntas canónicas, registra uso de
tools, latencia y respuesta, y escribe `docs/validation/qa-results-YYYY-MM-DD.json`.
Timeout de 60 s por request.

### `db-backup.sh` / `db-restore.sh` — backup y restauración

```bash
./scripts/db-backup.sh [remote-dest]
./scripts/db-restore.sh <backup_file>
```

`db-backup.sh`: `pg_dump` + gzip, retención diaria (`BACKUP_RETENTION_DAYS`, default 30) y
semanal (`BACKUP_RETENTION_WEEKS`, default 12), symlink `latest.sql.gz`, y subida opcional a
S3/rclone si se pasa el destino. `db-restore.sh` usa `pg_restore --single-transaction` con
fallback a `psql` y **pide confirmación interactiva** escribiendo `yes`.

### `sanitize-snmp-capture.ts` — saneado de capturas

```bash
pnpm sanitize:snmp --input raw.log --output clean.log
pnpm sanitize:snmp --input raw.json --output clean.json
```

| Flag | Default | Efecto |
|---|---|---|
| `--input`, `-i` | stdin | Archivo de entrada |
| `--output`, `-o` | stdout | Archivo de salida |
| `--community`, `-c` | — | Comunidad a redactar (repetible) |
| `--token-ip` | — | Tratar la IP indicada como token |
| `--mask-all-serials` | — | Enmascarar todos los seriales |
| `--help`, `-h` | — | Ayuda |

Redacta comunidades a `<REDACTED_COMMUNITY>`, mapea IPs a rangos RFC 5737
(`192.0.2.x`, `198.51.100.x`) y enmascara seriales preservando el prefijo de 4 caracteres
del vendor (`HWTC`, `ZTEG`, `ALCL`, `FHTT`).

### `generate-compatibility-matrix.ts` — matriz de compatibilidad

```bash
pnpm check:sources          # --check: falla si hay drift
pnpm generate:matrix        # imprime
pnpm generate:matrix:write  # --write: escribe docs/compatibility-matrix.md
```

Flags: `--check`, `--write`, `--output <path>` (default `docs/compatibility-matrix.md`).

### `check-oid-conflicts.ts` — colisiones de OID

```bash
pnpm check:conflicts
```

Escanea `research/olt/<vendor>/` y `KNOWN_TRAP_DEFINITIONS` buscando colisiones de OID,
PEN que no coinciden y contradicciones semánticas. Sale con código 1 si hay errores.

### `check-research-sources-health.ts` — salud de las fuentes

```bash
pnpm check:sources:health
```

Auditoría de integridad de links: HEAD y fallback a GET; 403/401 se consideran OK.

| Flag | Default | Efecto |
|---|---|---|
| `--dry-run` | — | No hace requests |
| `--timeout=<ms>` | `6000` | Timeout por request |

`OFFLINE_MODE=true` fuerza el modo dry-run.

### `validate-contribution.ts` — gate de contribución

```bash
pnpm check:contribution
pnpm check:contribution -- --vendor huawei
```

Valida Gate 1 + Gate 8: YAML con schema válido, fixture presente para nivel L2+, test
unitario del adapter, y ausencia de comunidades en texto plano.

### `check-release-version.ts` — paridad de versiones

```bash
pnpm check:version 0.2.2
```

Verifica que un único semver coincida con todos los `package.json` del workspace, la config
de Tauri, `Cargo.toml`, el `versionName` de Android, el fallback de la ruta de health y la
versión de scope de telemetría. El argumento también se puede pasar por `RELEASE_VERSION`.

### `generate-golden-files.ts` — snapshots dorados

Sin script npm: se corre manualmente.

```bash
npx tsx scripts/generate-golden-files.ts
```

Genera 9 snapshots JSON (Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM y
RFC Standard) en `packages/monitoring/tests/conformance/golden/`. **Muta archivos**.

## 3. Scripts fuera de `scripts/`

| Comando | Qué hace |
|---|---|
| `pnpm --filter @ftth-copilot/web tauri:prepare` | Escribe el shim `apps/web/dist/index.html` que redirige a `TAURI_DEV_URL` (`scripts/prepare-tauri-webview.mjs:7`) |
| `pnpm --filter @ftth-copilot/eval run metrics-report` | Escribe `packages/eval/reports/metrics-summary.json` (schema `ftth.eval-metrics.v1`). Flags: `--labels <path>` |
| `pnpm --filter @ftth-copilot/eval run backfill-verdict-log` | Backfill del `verdict_log` desde los mensajes guardados. Flags: `--dry-run`, `--tenant <id>`, `--limit <n>` |
| `pnpm --filter @ftth-copilot/web exec tsx scripts/generate-icons.ts` | Genera los PNG del PWA (72–512) y el icono maskable desde `public/icons/icon.svg` |

## 4. Scripts del paquete `@ftth-copilot/web`

| Script | Qué hace |
|---|---|
| `dev` | `next dev --turbo -p 3001` |
| `build` | `next build --webpack` |
| `build:static` | `NEXT_OUTPUT_MODE=export next build --webpack` (para Android) |
| `build:android` | `build:static` + `cap sync android` + `cap open android` |
| `tauri:build:linux` | `tauri build --bundles deb,appimage` |
| `tauri:build:windows` | `tauri build --target x86_64-pc-windows-msvc --bundles nsis,msi` |
| `test:e2e` / `test:e2e:ui` | Playwright |

## 5. Variables de entorno de los scripts

| Script | Variables |
|---|---|
| `setup.ts` | `DATABASE_URL`, `LLM_PROVIDER`, `MINIMAX_API_KEY`/`DEEPSEEK_API_KEY`/`QWEN_API_KEY` + `_MODEL`, `SMARTOLT_USE_MOCK`, `SMARTOLT_API_BASE_URL`, `SMARTOLT_API_KEY`, `SEED_ADMIN_PASSWORD` |
| `seed-scenario.ts` | `DATABASE_URL` |
| `send-syslog.ts` | `SYSLOG_HOST`, `SYSLOG_PORT` |
| `mock-nms.ts` | `MOCK_NMS_PORT` |
| `db-backup.sh` | `DATABASE_URL`, `BACKUP_RETENTION_DAYS`, `BACKUP_RETENTION_WEEKS`, `BACKUP_DIR` |
| `db-restore.sh` | `DATABASE_URL` |
| `check-research-sources-health.ts` | `OFFLINE_MODE` |
| `check-release-version.ts` | `RELEASE_VERSION` |
| `prepare-tauri-webview.mjs` | `TAURI_DEV_URL` |
| `packages/eval/scripts/metrics-report.ts` | `DOCS_VALIDATION_LABELS_PATH` |
