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

- [ ] T1 Circuito completo spool -> drainer -> Postgres, con un doble que
      modela `createMany` + `skipDuplicates` de forma fiel
- [ ] T2 Ramas de error de `syslog.ts` (escritura fallida, mensaje corrupto,
      rate limit, error de socket)
- [ ] T3 `lib/auth` en 15%: caminos del servidor de autenticacion

### Tier 2 — siguiente

- [ ] T4 Matriz ruta x metodo x rol del middleware
- [ ] T5 Rafagas: muchos datagramas rapido, crecimiento de backlog, techo de disco
- [ ] T6 Adaptadores de vendor con payloads sinteticos por fabricante

### Tier 3 — posterior

- [ ] T7 Capa de AI/agente
- [ ] T8 Performance y concurrencia

## Decision sobre Postgres

No hay PostgreSQL disponible en este entorno y tampoco Docker, asi que no se
pueden usar testcontainers. El doble en memoria debe modelar fielmente la
semantica que el codigo depende:

- `createMany({ data, skipDuplicates: true })` inserta solo las filas cuyo
  `ingestId` no existe ya, y devuelve el conteo de insertadas.

Si el doble no modela eso, el test no probaria nada: pasaria con cualquier
comportamiento. La limitacion queda documentada en el propio test.
