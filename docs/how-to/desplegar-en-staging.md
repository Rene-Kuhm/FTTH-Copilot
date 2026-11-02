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

### 3.1 Preparar el host

```bash
# Ubuntu 24.04 LTS
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker "$USER"   # cierra la sesión y volvé a entrar
```

### 3.2 Preparar el entorno

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

### 3.3 Levantar

```bash
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  build --build-arg JWT_SECRET="$(grep '^JWT_SECRET=' .env.staging | cut -d= -f2-)"

docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  up -d --scale app=2
```

El `--scale app=2` es el punto del ejercicio: la web tiene que correr en dos réplicas.

### 3.4 El primer admin

```bash
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml \
  run --rm -e ALLOW_PRODUCTION_SEED=true -e SEED_ADMIN_PASSWORD='<password>' \
  db-migrate sh -c "pnpm --filter @ftth-copilot/db db:seed"
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

# La cola no acumula
docker compose --env-file .env.staging \
  -f docker-compose.prod.yml -f docker-compose.staging.yml exec redis \
  redis-cli -a "$REDIS_PASSWORD" --no-auth-warning info keyspace
```

En `/api/health`, `services` tiene que listar los loops **esperados en el worker**, no los
de la web: si la web todavía arranca un loop, los dos owners trabajan en paralelo y
nada lo avisa salvo el conteo duplicado.

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
