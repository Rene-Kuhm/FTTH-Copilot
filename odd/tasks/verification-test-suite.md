# Verification Test Suite

**Status**: In Progress
**Created**: 2026-10-06
**Contexto**: el proyecto todavia no esta conectado a equipo real, asi que los
protocolos se prueban con fixtures sinteticas y el socket UDP real.

## Linea de base medida (apps/web)

| Modulo | Statements | Branches |
|---|---|---|
| `event-spool.ts` | 93.06% | 100% |
| `event-drainer.ts` | 92.45% | 75% |
| `event-ingest.ts` | 79.16% | 63.63% |
| `snmp.ts` | 77.19% | 66.66% |
| `syslog.ts` | 67.92% | **53.84%** |
| `lib/auth` (completo) | **15.38%** | **16%** |
| **apps/web total** | **27.75%** | **22.13%** |

## Hueco declarado

El circuito completo **spool -> drainer -> Postgres** nunca se probo. El spool y
el drainer se verificaron por separado con dobles inyectados, y los writes a
Postgres por separado con mocks de prisma. El camino completo solo existe en CI,
y solo con la suite de integracion de `packages/db`.

## Plan por tiers

### Tier 1 — critico

- [x] T1 Circuito completo spool -> drainer -> Postgres (PR #280)
- [x] T2 Ramas de error de `syslog.ts` (PR #280)
- [x] T3 `lib/auth`: `server.ts` y `totp.ts` (este PR)

### Tier 2 — siguiente

- [x] T4 Matriz ruta x metodo x rol del middleware
      → `apps/web/tests/middleware/authorization-matrix.test.ts`: 10 rutas ×
      5 métodos × 6 identidades (anónimo + MEMBER/OPERATOR/ADMIN/OWNER + un rol
      desconocido), 63 casos. Fija la frontera de la autorización: las rutas
      de API no exigen sesión en el middleware (la autorización vive en la
      ruta) pero sí CSRF en las mutaciones; las rutas protegidas exigen
      sesión y admiten cualquier rol; las de admin exigen ADMIN u OWNER.
- [x] T5 Rafagas: 300 datagramas por UDP, backlog de 600 eventos con la base
      caida, techo de disco, escritura partida a mitad de rafaga
- [x] T6 Adaptadores de vendor con payloads sinteticos por fabricante

### Tier 3 — posterior

- [x] T7 Capa de AI/agente
- [x] T8 Performance y concurrencia

## Bugs encontrados por los tests

1. **`base32Encode` alineaba los bits a 8 en vez de 5** (RFC 4648). 224 de 256
   valores de un byte colapsaban a 32 cadenas. Corregido en el PR #280. No era
   explotable porque `generateSecret` usa 10 bytes, multiplo de 5.
2. **El login con MFA no podia completarse.** `handleLogin` parseaba el body y
   despues lo volvia a leer en la rama MFA; el segundo `req.json()` lanza
   "Body is unusable" y el `.catch(() => ({}))` lo convertia en un objeto vacio,
   asi que el codigo nunca se leia y la respuesta era siempre `mfaRequired`.
   Cualquier usuario con MFA activated quedaba bloqueado.

## Decision sobre Postgres

No hay PostgreSQL disponible en este entorno y tampoco Docker, asi que no se
pueden usar testcontainers. El doble en memoria debe modelar fielmente la
semantica que el codigo depende:

- `createMany({ data, skipDuplicates: true })` inserta solo las filas cuyo
  `ingestId` no existe ya, y devuelve el conteo de insertadas.

Si el doble no modela eso, el test no probaria nada: pasaria con cualquier
comportamiento. La limitacion queda documentada en el propio test.

## T6 - Adaptadores de vendor (hecho)

Medicion previa: el paquete `monitoring` ya tenia 262 tests y un archivo por
vendor, asi que la brecha real no era "sin tests" sino ramas concretas.

| Archivo | Antes | Despues |
|---|---|---|
| `registry.ts` (funciones 60%) | 93.1% | **100%** |
| `ubiquiti.ts` | 74.24% | 87.87% |

### Hallazgo: el serial de ONU nunca se extrae en Ubiquiti

`src/snmp/adapter/ubiquiti.ts` busca el serial con
`oid.includes('serial') || oid.includes('onu') || oid.includes('gpon')` sobre el
OID del **varbind**. El decoder emite OIDs numericos
(`String(vb.oid)` en `decoder.ts:116`), que nunca contienen esas palabras, asi
que la rama es inalcanzable.

Consecuencia operativa: todos los ONU de una OLT colapsan al mismo `deviceId`
(`ufiber-edge-01:onu:0/0`). Un NOC no puede distinguir que ONU cayo.

Aclaracion: `dzs.ts`, `zte.ts` y `contract.ts` matchean contra
`catalogDef.name`, no contra el OID del varbind, asi que esos si son alcanzables.
Solo Ubiquiti tiene el problema.

Los tests fijan el comportamiento actual y demuestran la intencion con un OID
simbolico, para que la brecha quede visible si alguna vez se corrige el matching.

### Codigo defensivo inalcanzable

Las ramas de `clearsCategory` por nombre (`hwGponOntOnline`, `hwGponOntLosClear`,
`hwGponPortUp` en Huawei, y equivalentes en otros) solo se disparan cuando la
entrada del catalogo **no** tiene `clears_trap_oid`. Las tres lo tienen, asi que
son inalcanzables con el catalogo actual. No se testearon.

## T5 - Rafagas y backpressure (hecho)

### Hallazgo: `/api/health` reportaba backlog cero tras un reinicio

`stats().backlog` contaba un contador en memoria que soloavasena para los
registros escritos por esa instancia del proceso. Al reabrir el spool tras un
reinicio, el backlog real era 300 y el reporte era **0**.

Consecuencia: durante una caida, un operador mirando `/api/health` veia la cola
vacia mientras los eventos seguian en disco.

Correccion: el pending se deriva del disco de forma perezosa en la primera
llamada a `stats()` y se cachea. Es un escaneo por proceso, no por health check,
porque `/api/health` llama a `stats()` en cada request.

### Cobertura de T5

- Rafaga de 2000 registros en el spool, sin perdida y **en orden**
- Backlog de 600 eventos con la base caida, drenado completo y en orden al
  recuperar
- Reinicio a mitad de caida: los 300 eventos se recuperan sin duplicar
- Techo de disco: rechazo contado, datos previos intactos, rotacion al drenar
- Escritura partida (crash a mitad de linea): se descarta solo la cola incompleta
- 300 datagramas UDP reales contra el socket bindeado

Nota: en la rafaga UDP se afirma que lo encolado sea lo que realmente llego, y
que la perdida en el socket no sea total ni silenciosa. No se afirma perdida
cero: UDP no tiene control de flujo.

## T7 - Capa de AI/agente (hecho)

### Correccion: la capa de AI estaba mejor cubierta de lo que supuse

Medi antes de escribir. `packages/agent-core` tiene 87.55% y 12 archivos de
tests; `app/api/chat` tiene 27 tests.

Escribi 29 tests para `FallbackLlmClient` e `isTransientError` asumiendo que
estaban sin cubrir. Al medir el delta con `coverage-summary`-json` resulto
**0.00 de diferencia**: `llm.ts` daba 62.5% de lineas con y sin mis tests.

Causa: `tests/llm.test.ts` ya los cubria (lineas 168 y 195). Los borre en vez
de dejar 29 tests duplicados: inflar la suite no agrega seguridad.

Advertencia sobre el metodo: `git stash` sin `-u` **no** incluye archivos sin
trackear, asi que la comparacion dio identica por error. Repetir midiendo con el
archivo movido fuera revelo la redundancia.

### Lo que si aporto

`apps/web/lib/connectors/chat-client.ts` estaba en **0%** y resuelve el conector
NMS del tenant, descifrando credenciales para mandarlas a equipment del ISP.
Ahora en 78.57%.

Ramas cubiertas, todas con impacto operativo:

- Sin `baseUrl` no construye conector (mandaria credenciales a un host no configurado)
- Clave que no descifra -> 409 con mensaje accionable, sin filtrar el error del KMS
- Dispatch por provider: SMARTOLT, MIKROWISP, MIKROTIK
- **Credenciales MikroTik**: JSON `{username,password}`, `user:password` partido
  en el primer dos puntos, y token suelto con default `admin`
- TLS y puerto derivados de la URL base
- **Provider no implementado -> 422**: nunca devuelve datos simulados, porque en
  un NOC datos falsos se ven como telemetria real

### Verificacion adicional del fix de CSRF

El guard test de CSRF escanea `components/*.tsx`. Revise `lib/` y `app/`:
las unicas mutaciones fuera de components son a `/api/auth/login`, `/signup` y
`/logout`, que estan **exentas** por diseno. No hay gap, pero el guard podria
ampliarse a `lib/` como proteccion futura.

## T8 - Concurrencia (hecho)

### Hallazgo: carrera TOCTOU al confirmar incidentes

`POST /api/incidents/:id/confirm` hacia check-then-act:

```
findFirst({ tenantId, sourceIncidentId })  -> si existe, 200
confirmedIncident.create({ ... })          -> 201
```

Y `ConfirmedIncident` **no tenia ninguna restriccion unica** sobre
`sourceIncidentId`: sus unicos indices eran
`[tenantId, deviceKind, deviceId]`, `[tenantId, resolvedAt]`,
`[tenantId, connectionId]` y `[tenantId, investigationFeedbackId]`.

Dos operadores confirmando el mismo incidente al mismo tiempo (escenario
rutinario en un NOC) pasan ambos el chequeo y ambos insertan: el incidente
queda duplicado en los post-mortems, con dos entradas de auditoria.

`promotePendingIncidents` era el caso peor: **no chequeaba existencia en
absoluto**, dependia del update de estado del candidato que ocurre despues.

### Correccion en dos capas

1. `@@unique([tenantId, sourceIncidentId])` + migracion que colapsa duplicados
   previos (manteniendo el mas antiguo, con desempate por id) y reporta el
   numero de grupos afectados via `RAISE NOTICE`, en vez de borrar en silencio.
2. Manejo de `P2002` como segunda linea de defensa en ambas rutas, siguiendo el
   patron que ya existe en `feedback/route.ts`. En confirm devuelve la fila
   ganadora con 200; en promote cuenta como promovido.

`sourceIncidentId` es nullable, asi que las filas sin incidente de origen no se
ven afectadas: Postgres trata los NULL como distintos en un indice unico.

### T8c - N+1 e indices (hecho)

Los tres puntos que quedaban abiertos ("N+1, indices faltantes y paginacion sin limite") se
auditaron y se corrigieron los que eran reales.

#### Busqueda del N+1

Se revisaron las 61 rutas de `app/api/**` y los paquetes, buscando una query de Prisma
dentro de un bucle. Salieron cinco candidatos, y sólo dos eran N+1 de verdad:

| Candidato | Veredicto |
|---|---|
| `GET /api/ops/oncall` | **N+1 real**: una query de `onCallEntry` por horario |
| `POST /api/maintenance-windows/:id/reevaluate` | **N+1 real**, y ademas **cuadratico** |
| `apps/web/lib/ops-notify-dispatch.ts` | No: una query por canal de notificacion, y los canales son pocos (1-5 por tenant) |
| `apps/web/lib/promote-pending-incidents.ts` | No: ya esta mitigated; lee en lote y el bucle solo escribe |
| `packages/investigations/src/await.ts` | No: es un sondeo con presupuesto, no una iteracion sobre una coleccion |

#### El N+1 de oncall

`GET /api/ops/oncall` pedia la entrada vigente de cada horario con su propia query:

```
schedules.map(async (schedule) => prisma.onCallEntry.findFirst({ scheduleId: schedule.id, ... }))
```

El numero de horarios es dato del tenant y crece con el tamano del NOC: 50 horarios
significaban 51 queries para dibujar una pantalla. Ahora las entradas vigentes salen en
**una** query (`scheduleId IN (...)`), y el reparto en memoria usa el mismo criterio que
el `orderBy` viejo (`startUtc desc`): la primera entrada de cada horario es la vigente.

#### El N+1 cuadratico de la reevaluacion

La ruta de reevaluacion de ventanas comprobaba, **por incidente**, si ya lo habia
notificado:

```
for (const inc of incidents) {
  await prisma.agentActionLog.findFirst({
    where: { ..., parameters: { path: ['windowId'], equals: id },
                 result:    { path: ['incidentId'], equals: inc.id } },
  });
}
```

Dos problemas que se multiplican:

1. era una query por incidente;
2. el filtro es sobre **paths de JSON** (`parameters->>'windowId'`,
   `result->>'incidentId'`), que ningun indice btree puede servir, asi que cada una de
   esas queries **escaneaba toda la auditoria del tenant**. Y `AgentActionLog` no tiene
   retencion: crece para siempre. La ruta era cuadratica en el tamano de la historia de
   auditoria del tenant.

Ahora la comprobacion es **una** query por ventana: se traen los logs de esa ventana y de
ahi sale el conjunto de incidentes ya notificados.

#### El indice que faltaba

Con una sola query, el filtro por `toolName` seguia sin indice: el unico utilizable era
`(tenantId, createdAt)`, que no puede servir el filtro por herramienta, asi que Postgres
tenia que leer todas las filas de auditoria del tenant.

Se agrega `@@index([tenantId, toolName, createdAt])` a `AgentActionLog` (migracion
`20261102160000_agent_action_log_tool_index`). Con el, la query acota por tenant y
herramienta, y el filtro JSON queda sobre un conjunto acotado: los logs de las ventanas
de reevaluacion de ese tenant, no toda su auditoria.

#### Medicion

Contra Postgres real, con una ventana de 100 incidentes y una auditoria de un solo
tenant (que es el caso que la ruta tenian):

| Filas de auditoria | Ruta vieja (100 `findFirst`) | Ruta nueva (1 `findMany`) |
|---|---|---|
| 20.000 | 44 ms | 0,8 ms |
| 200.000 | 442 ms | 5,8 ms |

La ruta vieja escala linealmente con el tamano de la auditoria —que no tiene
retencion—: es la misma forma cuadratica, solo que en el eje del historial. El plan de
la query nueva es un `Bitmap Index Scan` sobre
`agent_action_log_tenantId_toolName_createdAt_idx`: lee 3 paginas del indice en vez de
las 344 del heap.

#### Lo que queda sin indice, y por que

- **El filtro JSON de `parameters` sigue sin indice GIN.** Se podria crear a mano
  (`jsonb_path_ops`), pero Prisma no declara indices GIN sobre columnas `Json`: si la
  migracion lo crea a mano, el schema no lo declara y `prisma migrate diff` reporta
  deriva. Preferible el escaneo acotado a un indice que el repo no puede representar.
- **`Message.role` no tiene indice.** Revisado: la consulta de la sesion del chat filtra
  por `conversationId` y ordena por `createdAt`, y el indice `(conversationId, createdAt)`
  cubre las dos cosas; `role` queda como filtro residual sobre una conversacion, que no
  tiene volumen. No hace falta un indice mas.

#### Paginacion sin limite

Ya estaba resuelta en T8b y T8b bis (cursor por `(lastSeenAt, id)` en incidentes y
predicciones). `GET /api/topology/tree` sigue sin limite a proposito: es un grafo
completo.

### Otros puntos de T8 aun sin cubrir

La paginacion de incidentes y predicciones ya esta cerrada (T8b, T8b bis). Del barrido de
N+1 e indices quedan los dos puntos de arriba, ambos documentados y con el motivo de no
cerrarlos.

## Pendientes atacados (2026-10-06)

### 1. CI nunca ejecutaba migraciones

El job de integracion (y el de E2E) usaban `prisma db push --accept-data-loss`,
que construye el schema directo desde `schema.prisma` y **nunca ejecuta el SQL
de `prisma/migrations`**. El step se llamaba "Apply migrations", que era
falso: no aplicaba migraciones.

Produccion si usa `db:deploy` (`migrate deploy`, en `db-migrate` del compose),
o sea CI validaba un camino que produccion nunca recorre. Una migracion con
logica —como la deduplicacion de #287— podia estar rota y el CI seguia verde.

Ambos jobs ahora corren `pnpm --filter @ftth-copilot/db db:deploy`, el mismo
comando que produccion.

### 2. Guard de CSRF ampliado a `lib/`

Escaneaba solo `components/*.tsx`. Ahora recorre `components/` y `lib/`
recursivamente, saltando arboles de test.

Al ampliarlo aparecieron las 3 llamadas de `lib/auth/client.ts` (login, signup,
logout). **No son un bypass**: el middleware exime `/api/auth/*` de la gate
porque deben funcionar justo cuando todavia no hay cookie de sesion. El guard
codifica esa exencion explicitamente para que no se vuelva a reportar.

### 3. Serial de ONU en Ubiquiti corregido

Reutiliza `ONT_SN_REGEX` del parser (ahora exportado) para identificar el serial
por la **forma del valor** del varbind, en vez de buscar las palabras
'serial'/'onu'/'gpon' dentro del OID, que el decoder nunca produce por ser
numerico.

Dos ONUs del mismo OLT ahora producen deviceIds distintos. Los tests que
documentaban el bug se invirtieron a afirmar el comportamiento correcto.

### Pendiente de T8b que NO se toco

`GET /api/incidents` devuelve **todos** los incidentes del tenant, incluidos los
resueltos, sin `take`. Los resueltos se acumulan para siempre, asi que el
endpoint crece sin cota. Lo mismo con `GET /api/predictions` sobre alertas
abiertas y confirmadas.

No se aplico un `take` porque truncar en silencio puede **ocultar incidentes
abiertos** al operador, que es peor que el problema que resuelve. Requiere una
decision de producto: limite generoso con flag de truncado visible, o paginacion
con cursor que el frontend consuma.

`GET /api/topology/tree` sin limite es intencional: es un grafo completo.

## T8b - Paginacion de incidentes (hecho)

`GET /api/incidents` devolvia **todos** los incidentes del tenant, incluidos
los resueltos, sin `take`. Los resueltos se acumulan para siempre.

### Decision de diseno

- **Por defecto, solo `open` y `acknowledged`**: acotado por trabajo pendiente
  real, no por cuanto tiempo lleva corriendo el sistema.
- **Historial resuelto, solo bajo pedido**: `?status=resolved` o `?status=all`.
- **Cursor**, no `offset`: coldestquear un incidente entre dos pedidos desplaza
  la pagina y saltea una fila en silencio. `offset` ademas se degrada en
  offsets grandes, que es justo el caso que motivo el cursor.
- **Metadatos**: `page: { scope, hasMore, nextCursor }`. Se toma `limit + 1`
  filas para saber si hay otra pagina sin una segunda consulta `COUNT`.

### Por que el orden es `lastSeenAt`, no `severity`

El orden anterior era `severity desc, lastSeenAt desc`. **Prisma rechaza `<`
en campos enum**, asi que un cursor que empiece por severidad no se puede
escribir como consulta tipada.

Ordenar por `lastSeenAt desc, id desc` ademas deja la consulta alineada con el
indice existente `@@index([tenantId, status, lastSeenAt])`, en vez de ordenar
detras de el.

Es un cambio de comportamiento visible para el operador: el panel pasa a
mostrar primero lo mas reciente, no lo mas severo.

### Compatibilidad

La forma de la respuesta se mantiene: `{ incidents, count }` sigue presente, asi
que `IncidentsPanel` (que lee `body.incidents`) no cambia. Lo nuevo es
`page`.

### Cobertura

16 tests: scope por defecto, los tres scopes explicitos, clamp de `limit`
(hostigoso y no numerico), cursor ausente/corrupto/valido, `hasMore` y
`nextCursor`, forma legacy, resultado vacio, y aislamiento de tenant en cada
pagina del recorrido por cursor.

## T8b bis - Paginacion de predicciones (hecho)

`GET /api/predictions` ya filtraba por `open`/`acknowledged`, pero sin `take` ni
cursor: toda la cola abierta de alertas de un tenant en una sola respuesta.

Mismo patron que incidentes: `?status=resolved` / `?status=all`, cursor sobre
`(lastSeenAt, id)`, `page: { scope, hasMore, nextCursor }`, y la forma legacy
`{ predictions, count }` intacta para que `PredictiveAlerts` no cambie.

### Modulo compartido

La logica de cursor vivia inline en la ruta de incidentes, unos 40 lineas.
Duplicarla en predictions era peor que extraerla, asi que ahora vive en
`apps/web/lib/api/pagination.ts` y ambas rutas la importan.

`cursorFilter` va **sin tipo de retorno** a proposito: los `where` input de
Prisma generados son especificos por modelo, asi que anotarlo para `Incident` lo
volvia inusable para `DetectedAlert`. La forma es estructuralmente identica.

14 tests para predictions; los 16 de incidents siguen verdes tras el refactor.

### T8b ter - El frontend pide de a paginas (hecho)

T8b y T8b bis dejaron el backend paginando, pero el frontend seguia leyendo la
primera pagina y listo: los incidentes abiertos que no entraban en ella quedaban
escondidos, y el operador no tenia forma de saber que faltaban. El riesgo que
T8b queria evitar seguia presente del lado del cliente.

#### El total del scope

Una pagina no puede decir cuantos hay. Las dos rutas ahora contestan ademas
`page.total`: cuantos hay en el scope, sin contar la paginacion (un `COUNT` con
el mismo filtro, que el indice del scope ya cubre). `count` no cambia de
significado: sigue siendo el largo de **esta** pagina.

Sin ese numero, los tiles del dashboard contaban lo que entro en la pagina. Y
el MTTR se calculaba sobre los incidentes **resueltos**, que el scope por
defecto (`unresolved`) no trae: desde T8b el promedio salia **siempre en cero**,
sin que nadie supiera por que. Ahora se piden los resueltos explicitamente y,
cuando no entran todos, el numero se rotula como muestra.

#### El cliente de la paginacion

`apps/web/lib/api/paged-list.ts`: `readPage` lee la respuesta, `nextPageUrl` arma
la URL de la pagina siguiente y `fetchAllPages` recorre el recorrido con un tope
**explicito**. Si el tope corta antes del final, `truncated` lo dice: un conteo
truncado en silencio es peor que ningun conteo.

#### Los paneles

- `IncidentsPanel` y `PredictiveAlerts` (dashboard del usuario): muestran cuantos
  hay en total y ofrecen "cargar mas", que pide la pagina siguiente con el cursor y
  la **agrega** a la lista. Sin mas paginas, el boton desaparece.
- `MetricsDashboard` (console): los tiles usan el total del scope.
- `NetworkTopologyMap`: colorea cada dispositivo con la severidad de su incidente.
  Si la respuesta viene recortada, un equipo con incidente se ve sin incidente, asi
  que pide la mayor parte posible y avisa cuando no alcanzo.

## SEC-008b - Advisory lock en schedulers (hecho)

### Problema

Los loops (`startPollingLoop`, `startFirmwareAuditLoop`,
`startFecCollectionLoop`) solo tenian guardia in-process (`IN_FLIGHT`, un Map).
Con N instancias de la app, **N** pollers consultando el NMS y **N** escrituras
del mismo sample. El propio codigo lo reconocia: el comentario de
`scheduler.ts` decia que un advisory lock de Postgres era el target de
produccion.

### Decision: lock de ambito de transaccion, no de sesion

`pg_try_advisory_xact_lock` dentro de `prisma.$transaction`, **no**
`pg_advisory_lock`. Prisma hace pool de conexiones: un lock de sesion
quedaria tomado en una conexion devuelta al pool y nunca se liberaria. El de
transaccion se libera en commit, rollback o crash.

La clave es un hash FNV-1a de 63 bits del nombre del loop, con namespace, para
que dos loops distintos no colisionen y ningun otro advisory lock de la misma
base se mezcle.

### Si la base esta caida, el tick corre igual

Si el lock no se puede consultar, `acquireSchedulerLock` devuelve `true` y el
comportamiento degrada al in-process de antes. La alternativa —quedarse en
silencio— dejaria `/api/health` en verde mientras no corre nada. Correr y que el
error aparezca en el registro de salud es lo observable.

### Regresion que casi se cuela

El `await` del lock abria una ventana: el flag `IN_FLIGHT` se marcaba **despues**
del await, asi que dos ticks concurrentes pasaban ambos el chequeo y corrian en
paralelo. Exactamente lo que el guard evita. Se corrige reclamando el flag de
forma sincronica antes del await y liberandolo si el lock es denegado.

El test `single-flight-scheduler.test.ts` lo detecto. Ese test hacia su trabajo.

### Cambio de contrato en los tests

`tryStart` ahora tarda un await antes de invocar el run, asi que "el primer run
 empezo" ya no es cierto de forma sincrona al llamar. Ese test ahora mockea
Prisma (el contrato de single-flight no tiene que ver con la base) y espera con
`vi.waitFor`. El comportamiento del lock esta en `scheduler-advisory-lock.test.ts`.

12 tests nuevos: estabilidad y rango de la clave, lock de transaccion y no de
sesion, casteo a bigint, concedido/denegado/sin filas, base inalcanzable, y
dos instancias donde solo una corre, mas la independencia entre loops.

## Evidencia SNMP - politica definida e implementada

Decisiones tomadas por el usuario:

1. **Que guardar**: metadatos del trap + varbinds **normalizados**. Nunca el
   paquete crudo ni `rawHex`, que es el grueso del payload sin aportar nada.
2. **Retencion**: 90 dias, carried per row en `expiresAt` para que el purge no
   tenga que re-derivar la constante por fila.
3. **Datos personales**: varbinds identificadores (MAC, serial de ONU) se
   **cifran en reposo** con la KMS master key que ya existe en el proyecto, y
   se **borran por completo** al dar de baja el tenant.

### Implementacion

- Modelo `SnmpEvidence` (`snmp_evidence`) con columna `varbinds` en claro y
  `identifyingVarsEncrypted` cifrada. Unique en `(tenantId, evidenceId)`, mas
  indices por `expiresAt` y `fingerprint`.
- `apps/web/lib/monitoring/snmp-evidence.ts`: normalizacion que separa
  identificables, `storeEvidence` idempotente, `purgeExpiredEvidence`,
  `purgeTenantEvidence` y `readIdentifyingVars`.
- `onEvidence` en `instrumentation.ts` deja de ser un callback sin consumidor.

### Detalle de deteccion

Un identificador se detecta por **OID o por valor**. El patron por OID solo
cubriria los OID que llevan la palabra, y un serial puede llegar en un OID
inocuo; el patron por valor (`^[A-Z]{4}[0-9A-F]{8,12}$` y MAC) cubre ese caso.
Test dedicado: `ZZTE1234567890` en un OID cualquiera si se clasifica como
identificador.

### Verificado

18 tests. Migracion aplicada contra Postgres real, drift residual 0.
