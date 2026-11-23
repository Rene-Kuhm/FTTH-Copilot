# Testing FTTH-Copilot without hardware

> **Principio:** los detectores son funciones puras, los conectores tienen `fetch` inyectable, el receptor syslog es UDP, y la UI corre contra fixtures en modo demo. **No necesitás OLTs, ONUs ni NMS físico** para probar todo.

## El modelo mental

```text
sin hardware                          con hardware
─────────────                         ─────────────
detectores: series sintéticas          series reales (poller NMS)
SOC:       UDP syslog sintético        syslog de los equipos
UI/chat:   DEMO_MODE_ENABLED=true      conectores validados
NMS live:  mock-nms scaffold           SmartOLT/Mikrowisp reales
```

Tres niveles de prueba que ya funcionan hoy + tres comandos nuevos para ver el sistema "de punta a punta" sin equipamiento.

## 1. Tests automáticos (cero equipamiento, ya corren en CI)

| Nivel | Qué prueba | Comando | Necesita |
|-------|-----------|---------|---------|
| **Unit** | Detectores puros (RX, FEC, óptica, flapping, SOC) y reglas | `pnpm test` | — |
| **Integración** | Pipeline real contra Postgres sembrado | `pnpm --filter @ftth-copilot/alerts test:integration` | Postgres |
| **E2E** | UI/chat/dashboard/alerts contra fixtures | `pnpm test:e2e` | Chromium |

El CI ya levanta `postgres:16` para la integración. Para correrlo local:

```bash
docker run -d --name ftth-pg -e POSTGRES_USER=ftth -e POSTGRES_PASSWORD=ftth -e POSTGRES_DB=ftth_copilot -p 5432:5432 postgres:16
export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
pnpm --filter @ftth-copilot/alerts test:integration
```

### Pruebas de caos en proceso

Con las dependencias instaladas, ejecutá `pnpm test:chaos`. Los escenarios usan fixtures
sintéticos, un spool en un directorio temporal y fallos inyectados en `fetch` y Prisma.

| Escenario | Qué verifica |
|-----------|--------------|
| SmartOLT y Mikrowisp | Una respuesta lenta dentro del plazo incluye latencia. Una lectura colgada se aborta con el timeout configurado. Un corte de red o JSON truncado produce un error y la siguiente consulta sana vuelve a entregar inventario. |
| Límite HTTP de SmartOLT | Ante un 429, respeta `Retry-After` y reintenta la consulta. |
| Caída de PostgreSQL | El handler real de drenaje falla para que la cola pueda reintentar. El spool retiene eventos de ambos tenants sin cuarentena y los entrega cuando vuelve la escritura. |
| Reinicio del drenaje | Se simula una escritura aplicada cuya confirmación se pierde. El handler se vuelve a cargar con el mismo spool y reenvía los mismos IDs. El doble de Prisma aplica `skipDuplicates`. |
| Caída de Laya | El circuit breaker abre, suprime llamadas durante la espera y vuelve a cerrar tras una consulta exitosa. El cliente devuelve `null` para que el pipeline pueda continuar durante el corte. |

La recuperación de SmartOLT y Mikrowisp se verifica en la siguiente consulta del llamador.
La prueba del worker recrea sus módulos de drenaje en el mismo proceso. Redis, el motor real
de PostgreSQL, el arranque del servicio y la supervisión de procesos quedan fuera de esta suite.

## 2. La app contra fixtures (modo demo)

```bash
cp .env.example .env
# Configurá: DATABASE_URL, JWT_SECRET, KMS_MASTER_KEY
echo 'DEMO_MODE_ENABLED=true' >> .env
pnpm dev
```

Con `DEMO_MODE_ENABLED=true`, el chat, el dashboard y las alertas usan los **fixtures** de SmartOLT/Mikrowisp (no se llama a ningún NMS). La UI queda navegable de punta a punta sin un solo equipo.

## 3. Los tres comandos nuevos (harness de simulación)

Cuando `pnpm install` registra los devDeps del root (tsx + los workspace packages necesarios), quedan disponibles tres comandos que ejercitan el sistema contra datos sintéticos.

### Fuzzing de los bordes de entrada

`pnpm test:fuzz` ejecuta las propiedades de fast-check en Vitest con fixtures sintéticos.
Cubre syslog y extracción de IP, OIDs y notificaciones SNMP ya decodificadas,
payloads de SmartOLT y Mikrowisp y las rutas de alta de usuarios y conectores.
Las rutas conservan sus validaciones y las pruebas simulan la sesión, la base
de datos y las dependencias externas.

El comando usa GNU `timeout` para detener la corrida a los 60 segundos, incluso
si una operación síncrona bloquea Vitest. Syslog también verifica un presupuesto
de 500 ms para parsear y extraer la IP de cada mensaje sintético largo. El
presupuesto mide una regresión en el corpus acotado, no es un límite de producción.

La seed por defecto es `250025`. Para repetir un fallo, copiá el `seed` y el
`path` que imprime fast-check y seleccioná la propiedad por nombre:

```bash
FUZZ_SEED=250025 FUZZ_PATH=0 timeout --kill-after=5s 60s \
  pnpm --filter @ftth-copilot/security exec vitest run /fuzz.test.ts \
  -t 'preserves the priority and payload of RFC 3164 lines'
```

### `pnpm test:scenario` — NOC end-to-end (seed + detección)

Siembra un escenario de degradación (RX cayendo hacia −27 dBm, FEC corregido creciendo, FEC no corregido apareciendo, bias sagging) y corre la pipeline de detección, imprimiendo las alertas e incidentes resultantes.

```bash
docker run -d --name ftth-pg ... postgres:16   # si no lo tenés
export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
pnpm test:scenario
```

Salida esperada (resumen):

```text
Seeded 48 metric samples.
Detection result: { detected: 4, upserted: 4, notified: 0, ... }

Alerts (4):
  - [critical] fec_degradation on onu-scenario-1: FEC no corregido en onu-scenario-1
  - [warning]  fec_degradation on onu-scenario-1: FEC en aumento: onu-scenario-1
  - [warning]  predicted_low_signal on onu-scenario-1: Señal en caída: onu-scenario-1
  - [warning]  optical_degradation on onu-scenario-1: Bias current fuera de rango: onu-scenario-1

Incidents (1):
  - [critical] ...
```

El escenario es **idempotente**: cada corrida borra el tenant `scenario-tenant` y lo recrea.

### `pnpm test:syslog` — SOC end-to-end (fuerza bruta sintética)

Envía por UDP un escenario SOC: 6 fallos de auth desde la misma IP (brute force) + 1 acceso (access_after_failures) + 1 cambio de configuración. Va al receptor syslog local.

Primero levantá la app con el receptor activo:

```bash
export SYSLOG_RECEIVER_ENABLED=true
export SYSLOG_TENANT_ID=local
pnpm dev

# En otra terminal:
pnpm test:syslog
```

Variables opcionales: `SYSLOG_HOST` (default `127.0.0.1`), `SYSLOG_PORT` (default `5514`).

### `pnpm test:mock-nms` — NMS mock (HTTP)

Levanta un servidor HTTP en `:5515` que responde con las formas reales de SmartOLT (`get_olts`, `get_all_onus_details`) y Mikrowisp (`GetRouters`, `GetMonitoreo`). Las rutas se eligen por prefijo:

```text
GET/POST /smartolt/api/system/get_olts
GET/POST /smartolt/api/onu/get_all_onus_details
POST /mikrowisp/GetRouters  (token en el body JSON)
POST /mikrowisp/GetMonitoreo
```

Para usar el NMS mock con la app real, configurá la conexión NMS con:

| Proveedor | Base URL |
|----------|----------|
| SmartOLT | `http://127.0.0.1:5515/smartolt` |
| Mikrowisp | `http://127.0.0.1:5515/mikrowisp` |

Variable opcional: `MOCK_NMS_PORT` (default `5515`).

## 4. Combinando los comandos (recorrido completo sin hardware)

Con Postgres corriendo, podés ver el NOC y el SOC funcionando **en paralelo**:

```bash
# Terminal 1: app con todo el plano de vigilancia activo
export DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot
export SYSLOG_RECEIVER_ENABLED=true
export SYSLOG_TENANT_ID=local
pnpm dev

# Terminal 2: ver el NOC detectar degradación sintética
pnpm test:scenario

# Terminal 3: ver el SOC detectar fuerza bruta sintética
pnpm test:syslog

# Terminal 4: NMS mock (si querés probar el conector "live" contra un NMS local)
pnpm test:mock-nms
```

El tablero (`/dashboard`) mostrará los **paneles de Incidentes, Predicciones, SLA y Accesos** con datos sintéticos sin un solo OLT/ONU físico.

## 5. Banco virtual en Docker Compose (`lab:up` / `lab:check` / `lab:down`)

Los comandos de la sección 3 son sintéticos: el receptor recibe datagramas que
armamos nosotros. Este banco es distinto — habla **protocolos reales** contra tres
implementaciones que no escribimos acá:

```bash
pnpm lab:up      # descarga las capturas, levanta el banco y provisiona el CHR
pnpm lab:check   # PASS/FAIL de los tres servicios
pnpm lab:down    # lo baja
```

`lab:up` es un solo comando: baja las capturas que falten, levanta el Compose,
provisiona el invitado de RouterOS y recién ahí espera los health checks.
`lab:check` no confía en que los contenedores estén arriba: consulta cada
protocolo y sale con código distinto de cero si algo no contesta.

| Servicio | Qué es | Puerto en 127.0.0.1 | Qué prueba |
|---|---|---|---|
| `bbsim` | BroadBand Simulator (ONF/VOLTHA, Apache-2.0) | `15060/tcp` gRPC OpenOLT · `15071/tcp` REST | Un OLT emulado con 4 puertos PON y 8 ONUs: el plano de control OpenOLT/OMCI y sus alarmas |
| `snmpsim` | snmpsim 1.2.2 sirviendo capturas reales de LibreNMS | `16100/udp` | Que el poller lea OIDs reales de Huawei, ZTE, FiberHome y V-SOL |
| `chr` | MikroTik CHR: RouterOS 7.24.6 real en QEMU/KVM | `15080/tcp` REST · `16101/udp` SNMP | Que el conector MikroTik hable `/rest` y SNMP contra un RouterOS de verdad |

Ningún puerto se solapa con el stack de demo (`3001`, syslog `15514`/`15515`) y
todos se publican solo en el loopback. El detalle de imágenes, digests,
credenciales y capturas está en [`docker/lab/README.md`](../docker/lab/README.md).

### BBSim: un OLT con puertos PON y ONUs

```bash
curl -s http://127.0.0.1:15071/v1/olt | jq '{SerialNumber, pon: (.PONPorts | length)}'
curl -s http://127.0.0.1:15071/v1/olt/onus | jq '.items | length'
```

El REST también acepta alarmas por ONU
(`POST /v1/olt/onus/<serial>/alarms/<tipo>/<on|off>`, con tipos como `DYING_GASP`
o `ONU_ALARM_LOFI`). Ojo: la alarma se envía por el canal OMCI, así que con un OLT
que nunca se activó el pedido queda esperando — activalo por OpenOLT primero
(es lo que hace el escenario de fallas de la fase siguiente).

### snmpsim: capturas reales, una comunidad por equipo

Las capturas son caminatas de equipos reales del repositorio de LibreNMS
(`tests/snmpsim/*.snmprec`), fijadas a un commit. **Son GPL-3.0**, así que no se
copian al repo: `lab:up` las descarga en `docker/lab/captures/`, que está en
`.gitignore`. La comunidad SNMP es el nombre del archivo sin `.snmprec`:

```bash
docker compose -f docker-compose.lab.yml exec snmpsim \
  snmpget -v2c -c zxa10_c600 -Oqv 127.0.0.1:1161 1.3.6.1.2.1.1.1.0
```

Hay capturas de Huawei SmartAX (`smartax`, `smartax-mdu`), ZTE ZXA10 (`zxa10`,
`zxa10_c320`, `zxa10_c600`), FiberHome AN5516 (`fiberhome_an5516-01`, `-04`,
`-04b`, `-06`) y V-SOL (`vsolution_v1600d`). `lab:check` compara el `sysDescr` que
sirve snmpsim contra el que dice el archivo, no contra un valor escrito a mano.

### MikroTik CHR: un RouterOS de verdad

```bash
curl -s -u admin:ftth-lab-not-prod http://127.0.0.1:15080/rest/system/resource \
  | jq '{version, "board-name"}'
docker compose -f docker-compose.lab.yml exec snmpsim \
  snmpget -v2c -c ftthlab -Oqv chr:161 1.3.6.1.2.1.1.1.0
```

Las credenciales son de laboratorio (`admin` / `ftth-lab-not-prod`, comunidad
`ftthlab`), nunca productivas. El CHR necesita `/dev/kvm`; sin KVM, QEMU cae a
emulación y el invitado tarda minutos.

### Qué NO prueba este banco

- **Potencia óptica en dBm.** BBSim modela el plano de control, no la óptica: no
  hay RX power ni bias current que degradar. Para eso están las capturas SNMP y
  los fixtures de los detectores.
- **Una captura es estática.** Reproduce lo que el equipo contestó una vez; los
  valores solo cambian si se carga un módulo de variación de snmpsim.
- **No es L3.** Es "L2+ con capturas reales reproducidas": el L3 (equipo físico en
  staging) sigue siendo otra cosa, ver
  [`docs/compatibility-matrix.md`](compatibility-matrix.md).

## 6. Troubleshooting

- **`pnpm test:scenario` falla con `Can't reach database`** → arrancá el Postgres (`docker run ... postgres:16`) y exportá `DATABASE_URL`.
- **`pnpm test:syslog` no muestra nada en el panel de Accesos** → verificá que `SYSLOG_TENANT_ID` esté setado y coincida con un tenant existente (o usá el tenant que crea el seed-scenario).
- **El conector "live" no llega al mock NMS** → revisá que el `baseUrl` de la conexión termine exactamente en `/smartolt` o `/mikrowisp` (sin barra final, con el path raíz del proveedor como prefijo).
- **`pnpm lab:check` marca `snmpsim-captures` en FAIL** → faltan las capturas: corré `pnpm lab:up` (las descarga desde el commit fijado) y volvé a chequear.
- **`pnpm lab:up` se queda esperando al `chr`** → el health check autentica contra `/rest`, así que el invitado no llegó a arrancar o falló la provisión: mirá `docker compose -f docker-compose.lab.yml logs chr` y confirmá que `/dev/kvm` exista.
- **`docker compose -f docker-compose.lab.yml up` falla con "port is already allocated"** → otro proceso tomó uno de los puertos del banco (`15060`, `15071`, `15080`, `16100/udp`, `16101/udp`); liberalo o cambialo en el Compose y en `scripts/lab/lib/lab-config.ts`.
