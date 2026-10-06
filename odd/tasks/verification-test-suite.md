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

- [ ] T4 Matriz ruta x metodo x rol del middleware
- [x] T5 Rafagas: 300 datagramas por UDP, backlog de 600 eventos con la base
      caida, techo de disco, escritura partida a mitad de rafaga
- [ ] T6 Adaptadores de vendor con payloads sinteticos por fabricante

### Tier 3 — posterior

- [ ] T7 Capa de AI/agente
- [ ] T8 Performance y concurrencia

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

### Otros puntos de T8 aun sin cubrir

N+1, indices faltantes y paginacion sin limite siguen sin auditar.

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
