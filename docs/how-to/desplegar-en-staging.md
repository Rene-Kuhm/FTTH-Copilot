# Desplegar en staging

**Objetivo:** definir y dejar montado el entorno donde se valida el modo `BACKEND_MODE=worker`
(tareas T14 y T15 de [backend-extraction](../../odd/tasks/backend-extraction.md)): el worker
como dueño del trabajo de fondo y la web escalada a varias réplicas sin duplicar trabajo.

**Por qué hace falta:** el modo `worker` no se puede validar en desarrollo. En desarrollo la
web corre sola, en un proceso, contra un Postgres local: no hay segunda réplica que pueda
duplicar el trabajo, ni cola, ni Redis. El flip del default (T15) borra el camino
`embedded` del código, así que antes tiene que haber corrido verde en un entorno con las
piezas de verdad.

---

## 1. La decisión

| Pregunta | Respuesta |
|---|---|
| **Dónde** | Un **VPS Linux** (Ubuntu 24.04 LTS) con Docker Engine + Compose v2, con IPv4 público |
| **Redis** | **Self-hosted en el mismo VPS**: `redis:8.10.2-alpine`, con password, AOF y puerto sólo en loopback |
| **Postgres** | **Self-hosted en el mismo VPS**: `postgres:16-alpine`, puerto sólo en loopback, backup diario |
| **Costo** | Un VPS de 2 vCPU / 4 GB / 40 GB. Redis y Postgres van en la misma máquina: no hay costo adicional |

### Por qué un VPS y no Vercel ni un PaaS

- **Vercel** no sirve: no hay worker de larga vida, no hay UDP de entrada (el receptor
  syslog y el de SNMP son UDP) y el `network_mode: host` del worker no existe.
- **Los PaaS con containers** (Railway, Render, Fly) tampoco: el worker **necesita** la
  red del host. El receptor syslog atribuye los eventos por la IP de origen del datagrama,
  y el proxy de usuario de Docker para UDP reescribe esa dirección a la gateway del bridge:
  con el proxy, todos los OLTs parecerían el mismo origen y los detectores de fuerza
  bruta fusionarían ataques distintos en uno solo. Ningún PaaS expone UDP público con la
  IP real del origen.
- **El servidor local** no sirve como staging: el firewall del host bloquea el tráfico
  contenedor→host, que es exactamente el camino que usa el worker para llegar a Redis y a
  Postgres por `127.0.0.1`. Y un escritorio se apaga.

### Por qué Redis self-hosted

El compose de producción ya lo trae así, y el staging tiene que ejercitar el mismo
camino: `redis:8.10.2-alpine` con `requirepass`, AOF (`appendonly yes`,
`appendfsync everysec`) y el puerto publicado **sólo en loopback**.

Una Redis gestionada (Upstash, Redis Cloud) obligaría a cambiar la URL en el compose, a
salir a internet en cada comando y a sumar TLS: para un entorno de pruebas sale más caro
que el VPS entero.

Lo importante es que **sea una sola Redis** para las dos cosas que la usan: la cola de
BullMQ del worker y el rate limiter global de las rutas que mutan estado (SEC-008). La
misma variable `REDIS_URL` las alcanza a las dos, con la misma contraseña y el mismo
índice de base de datos.

> La AOF está porque la cola guarda el backlog de ingesta: un job que fue aceptado y todavía
> no se drenó tiene que sobrevivir a un reinicio de la Redis.

### Por qué Postgres self-hosted

El staging **no es un sistema de registro**: sus datos son desechables. Una base gestionada
(Neon, Supabase) agrega un salto de red por consulta y una dependencia externa, y el
worker —que corre en la red del host— necesitaría TLS y un `sslmode` en la URL, con el
puerto público expuesto.

Lo que sí hace falta es el backup: `scripts/db-backup.sh` con retención, o el
[backup y restauración](backup-y-restauracion.md) completo.

**Cuándo cambiar a una base gestionada:** si el staging tiene que sobrevivir a la caída
del VPS, o si hay que probar el camino real contra una base administrada.

### Requisitos del VPS

| Recurso | Mínimo | Por qué |
|---|---|---|
| CPU | 2 vCPU | web ×2 + worker + Postgres + Redis + VictoriaMetrics |
| RAM | 4 GB | Postgres con `shared_buffers` por defecto, la web ×2 y el worker |
| Disco | 40 GB | Postgres, la AOF de Redis, el spool de ingesta y las métricas |
| SO | Ubuntu 24.04 LTS | Docker Engine + Compose v2 |
| Red | IPv4 público, puertos UDP 5514 y 1162 entrantes | syslog y SNMP traps |

Los puertos UDP sólo hacen falta si el staging recibe eventos de un NMS real. Si no, los
receptores arrancan igual y no reciben nada.

---

## 2. La topología

| Pieza | Dónde corre | Alcanza a | Puerto |
|---|---|---|---|
| `caddy` | red de Compose | `app:3001` | `8080` en el host (HTTP) |
| `app` ×2 | red de Compose | `postgres:5432`, `redis:6379` | **ninguno publicado** (Caddy entra) |
| `worker` | **red del host** | `127.0.0.1:6379`, `127.0.0.1:5432` | UDP `5514` y `1162` en el host |
| `postgres` | red de Compose + loopback | — | `127.0.0.1:5432` |
| `redis` | red de Compose + loopback | — | `127.0.0.1:6379` |

El `worker` corre en la red del host a propósito, por la IP de origen del datagrama
syslog (ver arriba). Por eso Postgres y Redis se publican en el loopback: son las dos
únicas formas de que un proceso en la red del host los alcance.

### Las dos réplicas de la web

`docker compose --scale app=2` no puede publicar el puerto 3001 dos veces, así que en
staging la web **no publica puerto** y Caddy hace de reverse proxy. `reverse_proxy app:3001`
resuelve el nombre del servicio a las IPs de las dos réplicas y balancea por round-robin.

**No hace falta sticky session, y es importante que siga así:**

- la sesión es un JWT en la cookie `ftth_session`, validado contra la fila `Session` de
  Postgres: el estado no está en el proceso;
- el CSRF es double-submit (cookie `ftth_csrf` + header `X-CSRF-Token`): tampoco hay
  estado en el servidor.

Las dos réplicas pueden atender cualquier request indistintamente. Si alguna vez se agrega
estado en memoria en el proceso web (un cache local, un contador), esto deja de ser cierto
y hay que agregar sticky sessions.

### El spool no se pisa

El volumen `spool_data` lo montan la web y el worker, cada uno en su subdirectorio
(`spool/web` y `spool/worker`), porque un directorio de spool pertenece a **una sola**
instancia viva. Con dos réplicas de la web, las dos escribirían en `spool/web` y se
corromperían.

En modo `worker` esto no pasa: `apps/web/instrumentation.ts` no arranca ni los receptores
(syslog/SNMP) ni el drainer, así que la web no escribe en el spool. El spool es del
worker, y el worker es uno solo.

Lo que evita el trabajo duplicado entre las dos réplicas de la web y el worker es el
**advisory lock de Postgres** de los schedulers (SEC-008b) y el **rate limiter global en
Redis** de las rutas que mutan estado (SEC-008, PR #351).

---

## 3. Montarlo

### 3.1 De cero a arriba

Todo lo que hace falta, en orden y sin pasos a mano, para un host que ya tiene
Docker (§3.2). Cada bloque se puede copiar y pegar tal cual. El detalle de cada
paso y el porqué están en las secciones siguientes:

```bash
# 1. El código y el entorno
git clone https://github.com/Rene-Kuhm/FTTH-Copilot.git
cd FTTH-Copilot
cp .env.staging.example .env.staging

# 2. Los secretos, distintos entre sí
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env.staging
sed -i "s|^KMS_MASTER_KEY=.*|KMS_MASTER_KEY=$(openssl rand -hex 32)|" .env.staging
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.staging
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -hex 32)|" .env.staging

# 3. El puerto de Postgres, si el host ya tiene uno escuchando. El worker llega
#    a Postgres y a Redis por el loopback del host, así que tienen que estar
#    libres. En el VPS de T14 el 5432 ya estaba ocupado: quedó en el 5434.
sed -i "s|^POSTGRES_PORT=.*|POSTGRES_PORT=5434|" .env.staging

# 4. Los receptores syslog y SNMP, que son parte de lo que T14 valida. En la
#    plantilla están apagados: bindear un socket UDP es exclusivo del host y
#    dos procesos no pueden tomar el mismo puerto. El tenant es al que se
#    atribuyen los eventos del syslog.
sed -i "s|^SYSLOG_RECEIVER_ENABLED=.*|SYSLOG_RECEIVER_ENABLED=true|" .env.staging
sed -i "s|^SNMP_RECEIVER_ENABLED=.*|SNMP_RECEIVER_ENABLED=true|" .env.staging
sed -i "s|^SYSLOG_TENANT_ID=.*|SYSLOG_TENANT_ID=demo-tenant|" .env.staging

# 5. Las imágenes. El JWT_SECRET va como build arg: el middleware de Next.js
#    corre en Edge, que no puede leer variables de entorno en runtime.
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  build --build-arg JWT_SECRET="$(grep '^JWT_SECRET=' .env.staging | cut -d= -f2-)"

# 6. El stack: la web en dos réplicas y el worker como dueño del trabajo de
#    fondo. El proyecto se llama ftth-staging, así que este stack y el de
#    producción pueden convivir en el mismo host: sus contenedores se llaman
#    ftth-staging-* y no pisan los de producción.
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  up -d --scale app=2

# 7. El mock NMS. Va detrás de un profile: un staging con un NMS real no lo
#    levanta y no necesita este paso.
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  --profile mock-nms up -d mock-nms

# 8. El seed: el tenant, el admin y la conexión que apunta al mock NMS. La
#    URL base de esa conexión sale de DEMO_NMS_BASE_URL, que ya viene en la
#    plantilla.
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  run --rm -e ALLOW_PRODUCTION_SEED=true -e SEED_ADMIN_PASSWORD='<password>' \
  db-migrate pnpm --filter @ftth-copilot/db db:seed

# 9. El mock NMS responde: el OLT del mock
curl -sS http://127.0.0.1:18080/api/system/get_olts | jq .

# 10. El stack está arriba y el worker es el dueño del trabajo de fondo
curl -sS http://127.0.0.1:8080/api/health | jq '.status, .owner, .services'
```

El paso 3 es el único que depende de lo que ya esté instalado en el host: si
el puerto está libre, el default de la plantilla (`5432`) sirve y el `sed` se
puede saltear.

> Las excepciones de la política SSRF (`NMS_ALLOW_HTTP`, `NMS_ALLOW_PRIVATE_NETWORKS`,
> `NMS_ALLOWED_HOSTS`, `NMS_ALLOWED_PORTS`) vienen activadas en la plantilla: el mock NMS
> vive en el loopback del host y la política, por defecto, no lo admite.
> **Nunca van a producción**: el web y el worker se niegan a arrancar con ellas activadas
> cuando `NODE_ENV=production` y no llevan la marca de staging (`DEPLOY_ENV=staging`).

### 3.2 Preparar el host

```bash
# Ubuntu 24.04 LTS
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"   # cierra la sesión y volvé a entrar
```

### 3.3 Preparar el entorno

```bash
git clone https://github.com/Rene-Kuhm/FTTH-Copilot.git
cd FTTH-Copilot
cp .env.staging.example .env.staging

# Los tres secretos, distintos entre sí
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env.staging
sed -i "s|^KMS_MASTER_KEY=.*|KMS_MASTER_KEY=$(openssl rand -hex 32)|" .env.staging
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env.staging
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -hex 32)|" .env.staging
```

> El `JWT_SECRET` además tiene que pasar como **build arg**: el middleware de Next.js corre
> en Edge, que no puede leer variables de entorno en runtime, así que el valor se inlinea
> en el bundle durante el build. Sin el build arg, el bundle sale sin secreto y toda ruta
> protegida redirige a `/login`.

> Las tres `DATABASE_URL` las arma el compose a partir de `POSTGRES_USER`, `POSTGRES_PASSWORD`
> y `POSTGRES_DB`: la de la web y la del `db-migrate` apuntan a `postgres:5432` (la red de
> Compose) y la del worker a `127.0.0.1:${POSTGRES_PORT}` (la red del host). No hay que
> escribirlas en `.env.staging`, y así no pueden quedar con una password distinta de la de
> `POSTGRES_PASSWORD`. En producción la del `db-migrate` llega por `env_file: .env.prod`.

### 3.4 Levantar

```bash
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  build --build-arg JWT_SECRET="$(grep '^JWT_SECRET=' .env.staging | cut -d= -f2-)"

docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  up -d --scale app=2
```

El `--scale app=2` es el punto del ejercicio: la web tiene que correr en dos réplicas.

### 3.5 El NMS del staging

Los loops del worker consultan un NMS. Sin uno, la conexión que crea el seed no
se puede consultar y los loops no tienen nada que hacer.

El compose de staging declara el **mock NMS** detrás del profile `mock-nms`
(`docker compose --profile mock-nms up -d mock-nms`): sirve el mock que ya
está en el repo (`smartoltMockResponse`) por HTTP, en `127.0.0.1:18080`, de modo
que lo que se ejercita es el conector real —el que aplica la política SSRF y
habla con `fetch`— y no un atajo por dentro.

El seed crea la conexión con esa URL (`DEMO_NMS_BASE_URL` en `.env.staging`).
Sin ella, la conexión queda sin URL base: el conector no se puede construir, el
poll no consulta nada y el health dice `polling OK` sin haber poleado.

Si se cambia el puerto del mock hay que cambiar las tres variables que lo
mencionan: `MOCK_NMS_PORT` (la que escucha el servicio), `DEMO_NMS_BASE_URL`
(la que apunta la conexión) y `NMS_ALLOWED_PORTS` (la que abre la política
SSRF para ese puerto).

Un staging con un NMS real no levanta el mock y deja `DEMO_NMS_BASE_URL` con la
URL de ese NMS.

### 3.6 El primer admin

```bash
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  run --rm -e ALLOW_PRODUCTION_SEED=true -e SEED_ADMIN_PASSWORD='<password>' \
  db-migrate sh -c "pnpm --filter @ftth-copilot/db db:seed"
```

El seed crea el tenant `demo-tenant` (`DEFAULT_TENANT_ID`, en
`packages/db/prisma/seed.ts`) y la conexión que apunta al mock NMS. El receptor
syslog sólo arranca si `SYSLOG_TENANT_ID` está seteado
(`packages/ingest/src/syslog-receiver.ts`): con la variable vacía no bindea el
socket y el health marca el loop como no esperado, así que el paso de syslog de
T14 no se puede validar.

```bash
sed -i "s|^SYSLOG_TENANT_ID=.*|SYSLOG_TENANT_ID=demo-tenant|" .env.staging
```

---

## 4. Qué valida T14

T14 es "correr en staging con `BACKEND_MODE=worker` y validar: poll, firmware, FEC,
syslog, SNMP y drenado funcionan, con web escalada a 2 réplicas sin duplicar trabajo".

| Plano | Cómo se verifica que corre **una** vez |
|---|---|
| Poll de métricas | Los samples de un OLT no se duplican entre las dos réplicas ni entre dos workers |
| Auditoría de firmware | Un ciclo por dispositivo, no uno por réplica |
| Colección FEC | Un ciclo por conexión |
| Syslog | El receptor del worker bindea `5514/udp`; la web **no** lo bindea (una sola instancia puede tomar el socket) |
| SNMP traps | Igual que syslog, con `1162/udp` |
| Drenado del spool | El backlog del spool baja a cero y no queda trabajo en la cola |

Lo que hay que mirar:

```bash
# El worker es el dueño del trabajo de fondo
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml logs worker

# El health dice qué loops se esperan
curl -sS http://127.0.0.1:8080/api/health | jq '.services, .ingest'

# El NMS del staging responde
curl -sS http://127.0.0.1:18080/api/system/get_olts | jq .

# La cola no acumula
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml exec redis \
  redis-cli -a "$REDIS_PASSWORD" --no-auth-warning info keyspace
```

En `/api/health`, `services` lista los loops **del worker**, no los de la web. La web no
puede leer el registro del worker desde su memoria: Next.js empaqueta la instrumentación y
los route handlers por separado, así que cada proceso tiene su propia copia del registro y
la de la web está vacía. El worker publica su estado en Redis
(`ftth:worker:scheduler-health`, con TTL de 60 segundos) y la web lo lee de ahí.

Cada servicio trae su estado (`ok`, `warming`, `error`, `hung`, `inactive`), el instante de
su próximo tick (`nextRunAt`) y su cadencia (`intervalMs`). Un worker recién arrancado tiene
sus loops *calentando*: el registro de salud vive en la memoria del proceso y empieza
vacío, así que sin el plazo del próximo tick el health del sistema quedaría degradado
hasta el primer tick — y con el firmware, casi un día después de cada despliegue. El tick
de calentamiento ocurre de verdad: el worker lo fuerza cuando el próximo tick de la rejilla
está lejos, y su id sale de la ranura de esa rejilla, así que dos workers que arrancan a la
vez producen **un** tick de calentamiento, no dos.

El campo `owner` dice de quién es el registro: `worker` o `embedded`. En modo worker, si el
worker no publica nada —porque está caído o porque todavía no arrancó— el health responde
`503 degraded`: el trabajo de fondo no tiene dueño y el health tiene que decirlo, en vez de
mostrar una lista vacía que parece un sistema tranquilo.

Los contadores del ingest (`backlog`, `dropped`) vienen del worker en ese modo. La web no
ingiere nada cuando el worker es el dueño, así que los suyos serían siempre cero.

```bash
# El estado de los loops, tal como lo ve la web
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml exec redis \
  redis-cli -a "$REDIS_PASSWORD" --no-auth-warning get ftth:worker:scheduler-health | jq .
```

### El criterio de "sin duplicar trabajo"

La señal más directa es la métrica del worker: la profundidad de la cola y la latencia de
los jobs (ver `docs/worker.md`). Si el trabajo se duplica, la cola se drena más rápido de
lo que los jobs producen y aparecen reintentos sobre el mismo job.

---

## 5. Rollback

T14 no cambia código: es un despliegue. Volver atrás es poner `BACKEND_MODE=embedded` y
bajar el worker.

```bash
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  stop worker && rm -f .env.staging   # o BACKEND_MODE=embedded
```

T15 sí es irreversible en código: borra el camino `embedded` de `instrumentation.ts` y el
scheduler en proceso. Por eso T15 espera a que T14 haya corrido verde.

---

## Cómo verificar

```bash
# Las dos réplicas de la web están arriba
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml ps

# Caddy balancea entre las dos
for i in 1 2 3 4; do
  curl -sS -o /dev/null -w '%{http_code} %{remote_ip}\n' http://127.0.0.1:8080/api/health
done

# El worker tiene su health en el loopback del host
curl -sS http://127.0.0.1:3001/healthz
```

## Troubleshooting

- **La web responde 401 en todo** → el `JWT_SECRET` del build no es el del runtime:
  reconstruí la imagen pasando el `--build-arg`.
- **`--scale app=2` falla con "port is already allocated"** → el compose de staging no
  está aplicado: la web tiene que quedar con `expose` y sin `ports`.
- **El worker no levanta** → `network_mode: host` y un puerto ya tomado en el host
  (`5514`, `1162`, `3001`). En el VPS esos puertos tienen que estar libres.
- **El worker no llega a Redis** → la Redis está en `127.0.0.1:${REDIS_PORT}` y necesita
  `REDIS_PASSWORD`; sin password, `redis-cli ping` responde `NOAUTH` y el worker falla
  en silencio.
- **La cookie de sesión no viaja** → el staging sirve HTTP plano: `SESSION_COOKIE_SECURE`
  tiene que estar en `false`. Con HTTPS real, en `true`.
- **El syslog no llega** → el firewall del VPS no abre `5514/udp`, o falta
  `SYSLOG_TENANT_ID`.
- **El health dice que el loop `polling` está en error** → el conector no se pudo
  construir. El motivo está en el propio health: lo más común es que la
  conexión no tenga URL base (falta `DEMO_NMS_BASE_URL` en el seed) o que la
  política SSRF haya rechazado el host del NMS (faltan las excepciones en
  `.env.staging`).
- **El worker no levanta y dice que las excepciones SSRF no van a producción** →
  el entorno tiene `NODE_ENV=production` sin `DEPLOY_ENV=staging`. La plantilla
  del staging trae la marca; si se editó a mano, hay que volver a ponerla.
- **El mock NMS no responde en el 18080** → el profile no está activo: hay que
  levantarlo con `--profile mock-nms up -d mock-nms`. Y si se cambió el puerto,
  tiene que coincidir con `DEMO_NMS_BASE_URL` y con `NMS_ALLOWED_PORTS`.
- **Los contenedores del staging no aparecen con el nombre de producción** →
  el proyecto del staging se llama `ftth-staging` y sus contenedores llevan el
  prefijo `ftth-staging-`. Los de producción ya no tienen nombre fijo: los
  genera Compose a partir del nombre de su proyecto.
