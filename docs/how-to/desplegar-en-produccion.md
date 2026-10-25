# Desplegar en producción

**Objetivo:** levantar FTTH-Copilot en producción con Docker Compose, con las variables
obligatorias, las migraciones aplicadas y el primer usuario admin creado.

## Requisitos

- Docker con Compose v2.
- Node ≥ 22 y pnpm 11.22.0 **sólo** si vas a construir la imagen localmente (el compose
  construye desde el `Dockerfile` de la raíz, así que el host no necesita Node, pero sí
  hace falta el código fuente).
- Un dominio si vas por HTTPS.
- Puertos libres en el host: `3001` (app), `1162/udp` (SNMP), `5514/udp` (syslog) y,
  opcionalmente, `8428` (VictoriaMetrics).

## 1. Prepará el `.env.prod`

```bash
cp .env.example .env.prod
```

Las dos variables que **bloquean el arranque** en producción:

| Variable | Dónde se valida | Qué pasa si falta |
|---|---|---|
| `JWT_SECRET` | `packages/db/src/auth.ts` (`resolveSecret`) | El proceso **lanza**: `JWT_SECRET is not set. Refusing to start in production with an insecure default.` Firma HS256 de la cookie de sesión |
| `KMS_MASTER_KEY` | `packages/db/src/crypto.ts` (`resolveSecret`) | El proceso **lanza** con el mismo texto. Clave AES-256-GCM de las API keys de NMS en reposo |

En desarrollo hay fallbacks inseguros; en producción **no**. Generá los secretos:

```bash
openssl rand -hex 32   # para cada uno
```

El resto del `.env.prod` que suele importar:

```env
NODE_ENV=production
POSTGRES_USER=ftth
POSTGRES_PASSWORD=<password fuerte>
POSTGRES_DB=ftth_copilot
DATABASE_URL=postgresql://ftth:<password>@postgres:5432/ftth_copilot

# Planos de vigilancia (ver "Habilitar NOC y SOC")
METRICS_POLLER_ENABLED=true
SYSLOG_RECEIVER_ENABLED=true
SYSLOG_TENANT_ID=<id del tenant>
```

> `DATABASE_URL` tiene que apuntar al host `postgres` de la red de Compose, no a
> `localhost`: dentro del contenedor, `localhost` es el propio contenedor.

## 2. Construí y levantá el stack

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Los servicios de `docker-compose.prod.yml`:

| Servicio | Qué es | Puertos publicados | Volumen |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | ninguno | `postgres_data` |
| `db-migrate` | Corre las migraciones y sale (`restart: "no"`) | — | — |
| `app` | Imagen `ftth-copilot:latest` (target `runner` del `Dockerfile`) | `${PORT:-3001}:3001`, `${SNMP_UDP_PORT:-1162}:1162/udp`, `${SYSLOG_UDP_PORT:-5514}:5514/udp` | `spool_data:/var/lib/ftth-copilot/spool` |
| `victoriametrics` | TSDS con API Prometheus-compatible | `${VICTORIAMETRICS_PORT:-8428}:8428` | `victoriametrics_prod_data` |
| `vmalert` | Evalúa las reglas de `docker/victoriametrics-alerts.yml` | — | — |
| `laya` | Microservicio Python de decisión | `${LAYA_PORT:-8080}:8080` | — (profile `laya`) |

Servicios opcionales por profile:

```bash
docker compose -f docker-compose.prod.yml --profile laya up -d
```

El `app` depende de `db-migrate` con `condition: service_completed_successfully`, así que
las migraciones se aplican **antes** de que arranque la app.

## 3. Aplicá las migraciones

El compose ya lo hace con el servicio `db-migrate`, que corre:

```bash
pnpm --filter @ftth-copilot/db db:deploy
```

`db:deploy` es `prisma migrate deploy`: aplica las migraciones de
`packages/db/prisma/migrations/` sin generarlas.

> **En producción nunca `pnpm db:migrate`.** `db:migrate` es `prisma migrate dev`, que
> genera una migración nueva a partir del diff con el schema y **puede pedir borrar la
> base**. `migrate deploy` sólo aplica lo que ya está commiteado. El CI usa `db:deploy`
> justamente por esto (`.github/workflows/ci.yml`, job `test-e2e`).

Para correrlas a mano (por ejemplo, si el servicio `db-migrate` ya corrió):

```bash
docker compose -f docker-compose.prod.yml run --rm db-migrate
```

## 4. Creá el usuario admin

El seed **se niega a correr en producción** sin una bandera explícita
(`packages/db/prisma/seed.ts`):

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e ALLOW_PRODUCTION_SEED=true \
  -e SEED_ADMIN_PASSWORD='<password del admin>' \
  db-migrate sh -c "pnpm --filter @ftth-copilot/db db:seed"
```

| Variable | Para qué |
|---|---|
| `ALLOW_PRODUCTION_SEED=true` | Sin esto, con `NODE_ENV=production` el seed lanza `Refusing to seed database in production environment` |
| `SEED_ADMIN_PASSWORD` | Password del admin. Si no se define, el seed genera una aleatoria de 12 bytes en base64url y la imprime |

El seed crea el tenant `demo-tenant` (slug `demo`) y el usuario
`admin@ftth-copilot.local` con rol `ADMIN`. Si el usuario ya existe y pasás
`SEED_ADMIN_PASSWORD`, **actualiza** su password y su rol.

Datos de demo sintéticos (OLTs, ONUs, muestras de métricas y alertas) son opt-in:

```bash
docker compose -f docker-compose.prod.yml run --rm \
  -e ALLOW_PRODUCTION_SEED=true \
  -e SEED_ADMIN_PASSWORD='<password>' \
  -e DEMO_DATA_ENABLED=true \
  db-migrate sh -c "pnpm --filter @ftth-copilot/db db:seed"
```

`DEMO_DATA_ENABLED=true` puebla el tenant `demo-tenant` con el dataset sintético. **No lo
habilites en una instalación real**: los fixtures son del paquete de conectores, no del
tu NMS.

> El seed además crea una fila `NmsConnection` de ejemplo (`provider: SMARTOLT`, `label:
> "Demo SmartOLT (Mock)"`, `status: "connected"`) **sin `baseUrl`**. Con el poller prendido
> esa conexión se saltea en cada ciclo (no se puede construir un conector sin URL base) y
> con el chat la resolución del conector falla con *"El conector no tiene una URL base
> configurada."*. Si vas a producción, borrala y creá el conector real (ver
> [Conectar un NMS real](conectar-un-nms-real.md)).

## 5. Ojo con el build arg `JWT_SECRET`

El `Dockerfile` (stage `builder`) hace:

```dockerfile
ARG JWT_SECRET
ENV JWT_SECRET=${JWT_SECRET}
```

El middleware de Next.js corre en el runtime Edge, que **no puede leer variables de
entorno en runtime**: por eso el valor se inlinea en el bundle durante el build. La
consecuencia de seguridad es real: **el valor de `JWT_SECRET` queda embebido en el bundle
Edge que se sirve al cliente**. Quien tenga acceso al bundle y a la imagen puede leerlo.

Mitigaciones: tratá la imagen como un secreto, no la publiques en un registry accesible, y
rotá `JWT_SECRET` si la imagen se filtró. Rotarlo invalida todas las sesiones abiertas.

Para que el build no falle, pasá el valor explícitamente:

```bash
docker compose -f docker-compose.prod.yml build \
  --build-arg JWT_SECRET="$(grep '^JWT_SECRET=' .env.prod | cut -d= -f2-)"
```

> **`docker-compose.prod.yml` y `docker-compose.https.yml` no declaran `build.args`.** El
> único compose que lo hace es `docker-compose.demo.yml` (`JWT_SECRET: ${JWT_SECRET:?...}`).
> Si construís la imagen de producción sin `--build-arg`, el bundle Edge sale sin secreto:
> el middleware no puede verificar ninguna sesión y toda ruta protegida redirige a
> `/login`, aunque la API Node acepte la misma cookie. Pasalo siempre a mano, o agregá el
> `build.args` al compose que uses.

## 6. Publicá los puertos UDP

El `Dockerfile` expone `3001`, `1162/udp` y `5514/udp`, y el compose los publica:

| Puerto | Servicio | Quién manda |
|---|---|---|
| `1162/udp` | Receptor SNMP | Los OLTs y el NMS |
| `5514/udp` | Receptor syslog | Los routers y firewalls |

El compose los publica con `${SNMP_UDP_PORT:-1162}` y `${SYSLOG_UDP_PORT:-5514}`, así que
pueden mapearse a otros puertos del host si hace falta. El firewall tiene que dejarlos
entrar; sin eso, el receptor funciona pero nunca recibe nada.

El spool de ingesta durable vive en el volumen `spool_data`, montado en
`/var/lib/ftth-copilot/spool` (`EVENT_SPOOL_DIR`). Los eventos que esperan a que Postgres
vuelva se bufferean ahí: **si el volumen no es persistente, esa telemetría se pierde**
cuando el contenedor se recrea.

## 7. HTTPS con Caddy (opcional)

```bash
cp .env.example .env.prod
# En .env.prod:
#   CADDY_DOMAIN=ftth.example.com
#   CADDY_EMAIL=admin@example.com
#   CADDY_HTTP_PORT=80
#   CADDY_HTTPS_PORT=443

docker compose -f docker-compose.https.yml up -d
```

`docker-compose.https.yml` tiene `postgres`, `db-migrate`, `app` y `caddy`. Diferencias
respecto del compose de producción:

- `app` usa `expose: "3001"` en vez de publicar el puerto: **no queda accesible desde el
  host**, sólo desde la red de Compose.
- `caddy` publica 80 y 443, monta `Caddyfile.prod` en solo lectura y recibe
  `CADDY_DOMAIN`.
- Caddy provisiona el certificado Let's Encrypt automáticamente; no hace falta gestionar
  certificados a mano.
- **No incluye VictoriaMetrics ni vmalert.** Si los querés, corré los compose por
  separado o exponé `victoriametrics` detrás de tu propio reverse proxy.

## 8. Alternativa sin Docker: PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

`ecosystem.config.cjs` define dos apps:

| App | Qué corre | Entorno |
|---|---|---|
| `ftth-copilot` | `/bin/bash` + `apps/web/start.sh` | `env_file: './apps/web/.env'`, `NODE_ENV=production` |
| `cloudflared` | `cloudflared tunnel --protocol http2 --no-autoupdate run` | `TUNNEL_TOKEN` leído del `.env` de la raíz (nunca commiteado) |

Dos cosas para tener en cuenta:

- **La ruta de `apps/web/start.sh` y de `cloudflared` en `ecosystem.config.cjs` son
  absolutas y específicas de cada host.** Hay que editarlas antes de arrancar.
- `apps/web/start.sh` hace `cd` a una ruta absoluta y ejecuta
  `npx next start -p 3001 -H 0.0.0.0`. El `sleep 2` del principio existe para que la
  instancia anterior libere el puerto 3001: sin él, cada reinicio de PM2 choca con
  `EADDRINUSE`.
- El `env_file` es `apps/web/.env`, no `.env.prod`. PM2 sólo reenvía su bloque `env`;
  las variables de ese archivo son las que llegan al proceso. El `cloudflared` usa otro
  archivo (el `.env` de la raíz).

## Cómo verificar

```bash
# Estado de los contenedores
docker compose -f docker-compose.prod.yml ps

# Health de la app (503 si está degradada)
curl -sS http://127.0.0.1:3001/api/health

# Logs del arranque (migraciones, errores de secretos)
docker compose -f docker-compose.prod.yml logs app
```

En `/api/health` revisá `database.status`, `services` (qué loops están esperados) y
`ingest` (backlog y pérdidas).

Si la app responde `401`/`403` en `/api/dashboard`, el login falló: casi siempre es
`JWT_SECRET` distinto entre el build y el runtime.

## Troubleshooting

- **El contenedor `app` reinicia en loop** → falta `JWT_SECRET` o `KMS_MASTER_KEY` en
  `.env.prod`. Mirá `docker compose logs app`: el error dice exactamente cuál.
- **`db-migrate` falla con "Can't reach database at ..."** → `DATABASE_URL` apunta a
  `localhost` en vez de `postgres`.
- **El seed dice "Refusing to seed database in production environment"** → falta
  `ALLOW_PRODUCTION_SEED=true`.
- **El admin existe pero no puedo loguearme** → el seed **no** actualiza la password si
  el usuario ya existe y no pasás `SEED_ADMIN_PASSWORD`. Pasalo explícitamente o borrá la
  fila del usuario.
- **La app arranca pero toda request devuelve 401** → el `JWT_SECRET` del build no es el
  mismo que el del runtime. Reconstruí la imagen pasando el build arg.
- **El healthcheck del contenedor falla** → el `Dockerfile` usa
  `wget --spider http://127.0.0.1:3001/api/health`; si `/api/health` devuelve 503
  (base caída o loops colgados) el contenedor se reinicia aunque la app esté viva.
- **Las trampas SNMP o los syslog no llegan** → el firewall del host no abre 1162/udp y
  5514/udp, o el receptor está inerte por falta de `SYSLOG_TENANT_ID`.
- **VictoriaMetrics no levanta** → la imagen es AGPL-3.0: confirmá la forma de despliegue
  con tu asesoría legal antes de un rollout comercial (el propio compose lo advierte).
- **`docker compose down` dejó la base vacía** → mirá el troubleshooting siguiente.

> ### `docker compose down -v` borra el estado de producción
>
> El flag `-v` elimina los volúmenes: `postgres_data` (toda la base), `spool_data`
> (telemetría buffereada) y `victoriametrics_prod_data` (histórico de métricas). El
> propio `docker-compose.prod.yml` lo advierte en un comentario.
>
> Además, `docker compose down` ejecutado en **otro directorio de proyecto** puede dejar
> los volúmenes huérfanos y crear reemplazos vacíos. Por eso los volúmenes del compose
> no declaran `external: true` ni un `name:` explícito: cambiar la identidad del volumen
> hace que Compose cree uno vacío en silencio.
>
> Antes de cualquier `down`/`up`: [Backup y restauración](backup-y-restauracion.md).
