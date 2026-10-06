# Ingest Quality Follow-ups

**Status**: In Progress
**Created**: 2026-10-06
**Origin**: Pendientes detectados tras PR #277 (SNMP) y #278 (CI)

## Alcance

Cinco pendientes que surgieron de la revision del proyecto. Este documento
cubre los que son cambios de codigo claros; el resto queda registrado con su
alcance real.

| ID | Pendiente | Decision |
|----|------------|----------|
| (a) | `prisma db seed \|\| true` se traga fallos | Se resuelve |
| (b) | Evidencia cruda SNMP sin destino | Requiere modelo nuevo; ver abajo |
| (c) | `severity` queda en `null` | Se resuelve |
| (d) | `prometheus-to-victoriametrics.md` con 18 tareas | Doc obsoleto; ver abajo |
| (e) | SEC-007 braces | Bloqueado upstream, sin accion posible |

## (a) El seed de CI traga sus propios fallos

`docker-compose.prod.yml` y `.github/workflows/ci.yml` corren
`prisma db seed || true`. Si el seed rompe, el CI sigue verde.

La razon historica del `|| true` es que el seed no es idempotente
(`prisma.user.create` y `prisma.nmsConnection.create` no son upserts), asi que un
segundo run falla. Pero las tres suites de integracion de `packages/db` y la de
`alerts` crean sus propios datos en `beforeAll`: **ninguna depende del seed**.

## (c) La severidad del catalogo no llegaba al evento

`packages/monitoring/src/snmp/catalog.ts` define
`severity: 'critical' | 'warning' | 'info'` por trap, pero
`parseAndNormalizeSnmpTrap` no lo expone en su retorno, asi que
`DeviceEvent.severity` queda siempre en `null`.

La severidad viaja en `tags`, junto a `trapCategory`, que ya es donde el parser
coloca el contexto del trap. `telemetryEventSchema` declara `tags` como
`z.record(z.string(), z.string())` y no se valida en el camino de traps, asi que
agregar la clave no rompe el contrato compartido.

Mapeo a la numeracion de syslog, que es la que ya usa el camino de syslog
(`DeviceEvent.severity` proviene de `priority % 8`, rango 0..7):

| Catalogo | DeviceEvent.severity |
|---|---|
| `critical` | 2 (crit) |
| `warning` | 4 (warning) |
| `info` | 6 (info) |

## (b) La evidencia cruda no tiene destino — alcance real

No es "conectar un destino": **no existe ningun modelo en el schema para
evidencia cruda**. `RawSnmpEvidenceEnvelope` se produce en
`createRawEvidenceEnvelope` y `onEvidence` no tiene consumidor.

Persistirla es una tabla nueva, y las preguntas de producto no están
respondidas: que campos se guardan, cuanto tiempo se retienen, y si los
varbinds pueden contener datos sensibles que no deban persistirse sin revisar.

No se implementa sin esa definicion.

## (d) El doc de VictoriaMetrics está obsoleto

De las 18 tareas, la mayoria ya estan implementadas:

| Tarea | Estado real |
|---|---|
| VM-2 compose.prod con VM y persistencia | Hecho (18 referencias) |
| VM-3 `.env.example` con `VICTORIAMETRICS_*` | Hecho (10 variables) |
| VM-4 docs de produccion | Hecho (32 referencias) |
| METRICS_BEARER_TOKEN en scrape | Hecho en compose.prod y demo |
| VM-1 VictoriaMetrics en `docker-compose.yml` | **No hecho** |

VM-1 es el unico pendiente real, y es discutible: `docker-compose.yml` es un
compose de desarrollo minimo (solo `postgres` y `laya`), no un espejo de
produccion. Agregar VM ahi no es necesariamente lo que se busca.

El resto (VM-5 a VM-7, mas las tareas de verificacion funcional) no tiene objeto:
no hay `prometheus.yml` de ejemplo que deprecar en el repo.

## (e) SEC-007 braces

`braces` sigue en 3.0.3 y 3.0.4 no esta publicado upstream. El override ya esta
aplicado y solo afecta `fast-glob`, `next-pwa` y `eslint-config-next`, que son
devDependencies de build. Nada que hacer hasta que upstream publique.
