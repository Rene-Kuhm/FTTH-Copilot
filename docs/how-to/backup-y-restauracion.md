# Backup y restauración

**Objetivo:** respaldar y restaurar la base de PostgreSQL y las métricas de
VictoriaMetrics, y saber qué claves no se pueden regenerar si se pierde el `.env`.

## Requisitos

- `pg_dump` y `pg_restore` (los clientes de PostgreSQL) en el `PATH`.
- `DATABASE_URL` apuntando a la base que se quiere respaldar.
- Para el backup remoto: `aws` (CLI v2) o `rclone` instalados.
- Para VictoriaMetrics: un `systemd` con la unit `docker/vmbackup.service`, o el binario
  `vmbackup-prod` a mano.

## 1. Back up de PostgreSQL

```bash
./scripts/db-backup.sh
```

Qué hace (`scripts/db-backup.sh`):

1. `pg_dump --format=custom --compress=9 --no-owner --no-acl --clean --if-exists` sobre
   `DATABASE_URL`, comprimido con gzip.
2. Escribe `backups/ftth_<YYYYMMDD>_<HHMMSS>.sql.gz`.
3. Actualiza el symlink `backups/latest.sql.gz` → el backup recién creado.

| Variable | Default | Efecto |
|---|---|---|
| `DATABASE_URL` | `postgresql://ftth:demo123@localhost:5432/ftth_copilot` | Base a respaldar. **Poné la de producción explícitamente** |
| `BACKUP_DIR` | `./backups` | Directorio local de backups |
| `BACKUP_RETENTION_DAYS` | `30` | Días que se conservan los backups diarios |
| `BACKUP_RETENTION_WEEKS` | `12` | Semanas que se conservan los backups semanales |

```bash
DATABASE_URL='postgresql://ftth:<password>@postgres:5432/ftth_copilot' \
BACKUP_DIR=/var/backups/ftth-copilot \
./scripts/db-backup.sh
```

### Retención diaria y semanal

El script decide si la corrida es semanal por el día de la semana: **domingo**
(`date +%u` = 7).

| Corrida | Qué hace |
|---|---|
| Diario (cualquier día que no sea domingo) | Purga los `ftth_*.sql.gz` con `-mtime +BACKUP_RETENTION_DAYS`. **No** toca los `ftth_weekly_*` |
| Semanal (domingo) | **No** purga los diarios. Copia el backup a `ftth_weekly_<ts>.sql.gz`, actualiza el symlink `latest_weekly.sql.gz` y purga los semanales con `-mtime +BACKUP_RETENTION_WEEKS*7` días |

O sea: los diarios se borran a los 30 días y los semanales a las 12 semanas. Los
semanales son la copia de largo plazo.

### Subida remota (opcional)

```bash
./scripts/db-backup.sh s3://mi-bucket/ftth-copilot
```

El destino remoto es el primer argumento. El script usa `aws s3 cp` si encuentra el
binario `aws` (con `--storage-class STANDARD_IA` y subiendo también el `latest.sql.gz`),
si no usa `rclone copy --no-traverse`, y si no encuentra ninguno **avisa y sigue** sin
subir nada:

```text
[backup] WARNING: Neither aws nor rclone found. Skipping remote upload.
```

Esa advertencia no es un error: el backup local ya está escrito. Revisá que la subida
occurrió antes de dar por bueno el ciclo.

## 2. Restore de PostgreSQL

```bash
./scripts/db-restore.sh ./backups/latest.sql.gz
```

Qué hace (`scripts/db-restore.sh`):

1. Verifica que el archivo exista.
2. **Pide confirmación interactiva**: hay que escribir `yes` (exactamente) en el prompt.
   Cualquier otra cosa aborta con `[restore] Aborted.`
3. `gunzip -c <archivo> | pg_restore --dbname="$DATABASE_URL" --format=custom --clean
   --if-exists --no-owner --no-acl --single-transaction`.
4. Si `pg_restore` falla, hace fallback a `gunzip -c <archivo> | psql "$DATABASE_URL"`.

`--single-transaction` importa: la restauración es atómica. Si algo falla a mitad de
camino, la base queda como estaba, no en un estado parcial.

Para restaurar en una base vacía (la forma más segura):

```bash
docker compose -f docker-compose.prod.yml stop app
docker compose -f docker-compose.prod.yml run --rm db-migrate \
  sh -c "pnpm --filter @ftth-copilot/db db:deploy"
./scripts/db-restore.sh ./backups/latest.sql.gz
docker compose -f docker-compose.prod.yml up -d app
```

El `db:deploy` previo crea el schema; el `pg_restore --clean --if-exists` reemplaza el
contenido de las tablas.

## 3. Backup de VictoriaMetrics

Las métricas históricas viven en el volumen `victoriametrics_prod_data`, no en Postgres.
El sidecar `vmbackup` las saca:

```ini
# /etc/systemd/system/vmbackup.service
[Unit]
Description=VictoriaMetrics Backup Sidecar
After=network.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c '/vmbackup-prod -storageDataPath=/storage -dest=${BACKUP_DEST:-file:///backups} -loggerLevel=INFO -loggerFormat=json'

[Install]
WantedBy=multi-user.target
```

La plantilla del repo está en `docker/vmbackup.service` (con la unit de timer comentada
para correr cada 6 horas).

| Variable | Default | Efecto |
|---|---|---|
| `BACKUP_DEST` | `file:///backups` | Destino local o `s3://bucket/path`. Es la única que el `ExecStart` de la unit consume |
| `BACKUP_INTERVAL` | cada 6 h | Declarada en el comentario de la unit, pero **el `ExecStart` no la usa**: la cadencia la define el timer de systemd (hay una plantilla comentada en el mismo archivo) |
| `RETENTION_DAYS` | 7 | Declarada en el comentario de la unit; la purga la hace el propio `vmbackup` |

El `ExecStart` apunta a `/vmbackup-prod` y lee el storage en `/storage`: es el path del
volumen dentro del contenedor de VictoriaMetrics. Para correrlo fuera del contenedor hay
que instalar el binario `vmbackup` de VictoriaMetrics y apuntar `BACKUP_DEST` a un disco
con espacio.

## 4. Las claves que NO se pueden regenerar

De todas las variables del `.env`, sólo dos no se pueden volver a crear: las que
**descifran o verifican datos que ya existen**.

| Variable | Para qué sirve | Qué pasa si se pierde |
|---|---|---|
| `KMS_MASTER_KEY` | Deriva la clave AES-256-GCM con la que se cifran las API keys de NMS en `NmsConnection.encryptedKey` (`packages/db/src/crypto.ts`) | **Las API keys de NMS guardadas quedan irrecuperables.** El conector falla con *"No se pudieron descifrar las credenciales del conector. Volvé a configurarlo."* y hay que **re-ingresar cada API key a mano** en la UI o por la API |
| `JWT_SECRET` | Firma HS256 de la cookie de sesión (`packages/db/src/auth.ts`) | **Todas las sesiones abiertas quedan inválidas** y hay que volver a iniciar sesión. No se pierde ningún dato: las cookies son stateless y el estado vive en la tabla `Session`, que se puede vaciar |

El resto de las variables se pueden regenerar o reconfigurar sin perder datos:
`DATABASE_URL` (apunta a la misma base), `SEED_ADMIN_PASSWORD` (se puede volver a
sembrar el admin), las API keys de los LLM (se piden de nuevo al proveedor), las del NMS
(re-ingeribles, pero eso es justamente lo que `KMS_MASTER_KEY` protects), y las de
notificación.

**Consecuencia operativa: `KMS_MASTER_KEY` y `JWT_SECRET` tienen que estar en el backup
del `.env`, en un lugar tan seguro como el backup de la base.** Si restaurás la base con
un `KMS_MASTER_KEY` distinto del que se usó para cifrar, todas las API keys de NMS quedan
inservibles aunque los datos estén íntegros.

## 5. Qué NO respaldar

No hace falta, y no se debe, respaldar:

- **Las API keys de NMS en claro.** No están en el dump: están cifradas en
  `NmsConnection.encryptedKey`. Con `KMS_MASTER_KEY` alcanza.
- **El spool de ingesta** (`EVENT_SPOOL_DIR`, volumen `spool_data`). Es un buffer
  transitorio de eventos que esperan a que Postgres esté disponible.
- **La imagen Docker.** Se reconstruye desde el código.

Lo que sí conviene respaldar, además de la base:

| Qué | Por qué |
|---|---|
| `.env.prod` (o `apps/web/.env` en el caso PM2) | Contiene `KMS_MASTER_KEY` y `JWT_SECRET` |
| `Caddyfile.prod` | Si personalizaste el proxy |
| `docker/victoriametrics-alerts.yml` | Reglas de alerta |
| `research/olt/` | Las fuentes documentadas de cada fabricante (van en el control de versiones, pero conviene un backup del despliegue) |

## Cómo verificar

```bash
# El backup existe y no está vacío
ls -lh backups/
readlink -f backups/latest.sql.gz

# Se puede restaurar en una base de prueba
docker run -d --name ftth-restore-test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_USER=ftth -e POSTGRES_DB=ftth_copilot -p 5433:5432 postgres:16
sleep 5
DATABASE_URL='postgresql://ftth:test@localhost:5433/ftth_copilot' \
  ./scripts/db-restore.sh ./backups/latest.sql.gz
```

El restore pide `yes` de forma interactiva: no se puede correr desatendido sin pasar el
input por stdin.

```bash
# Contenido de la base restaurada
psql 'postgresql://ftth:test@localhost:5433/ftth_copilot' -c 'select count(*) from tenants;'
```

Un restore de prueba **antes** de necesitarlo es la única forma de saber que el backup
sirve.

## Troubleshooting

- **`[backup] Dumping database: ...` muestra un host raro** → el script imprime sólo la
  parte posterior a `@` de la URL, sin la password. Fijate la URL completa con
  `echo "$DATABASE_URL"` antes de correrlo, no en la salida.
- **El restore aborta con `[restore] Aborted.`** → la confirmación no fue exactamente
  `yes`. No hay forma de saltarla: es deliberado.
- **`pg_restore` falla y cae al fallback de `psql`** → el mensaje
  `[restore] WARNING: pg_restore failed. Trying psql fallback...` aparece. El `psql`
  ejecuta el SQL crudo y **no** es atómico como `pg_restore --single-transaction`.
- **La app no ve los datos restaurados** → el `DATABASE_URL` del contenedor apunta a
  otra base, o restauraste mientras la app estaba corriendo y el pool de conexiones
  quedó con el estado viejo. Reiniciá el `app`.
- **Los conectores fallan con "No se pudieron descifrar las credenciales"** → el
  `KMS_MASTER_KEY` en runtime no es el mismo con el que se cifraron las API keys.
  Re-ingresá cada API key.
- **Las sesiones inválidas en el restore** → es el `JWT_SECRET`: no es un problema de
  datos. Limpiá la tabla `Session` o esperá a que expiren los tokens (7 días).
- **El backup remoto no subió nada** → el mensaje
  `[backup] WARNING: Neither aws nor rclone found.` aparece cuando no hay ninguno de los
  dos binarios. Instalá uno o aceptá que el backup queda sólo local.
- **`docker compose down -v` borró los volúmenes** → no hay restore posible salvo que
  tengas un backup externo. Es exactamente el motivo por el que este documento existe.
