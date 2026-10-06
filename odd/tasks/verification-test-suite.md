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
- [ ] T5 Rafagas: muchos datagramas rapido, crecimiento de backlog, techo de disco
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
