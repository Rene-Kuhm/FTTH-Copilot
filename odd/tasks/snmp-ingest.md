# SNMP Trap Ingest

**Status**: In Progress
**Created**: 2026-10-06
**Prerequisite**: `odd/tasks/event-ingest-durability.md` (PR #276)

## Problema

El receptor SNMP existe, esta implementado y sus tests pasan, pero **nunca se
arranca en produccion**.

`apps/web/instrumentation.ts` registra los tres loops de polling y el receptor
syslog, pero no `startSnmpReceiver`. La funcion no tiene ningun caller en todo el
repositorio salvo tests.

Consecuencia: con `SNMP_RECEIVER_ENABLED=true` y el puerto 1162/udp mapeado en
`docker-compose.prod.yml`, **no entra ningun trap**, porque nadie bindea el
socket. Y no hay alarma: la rama deshabilitada llama
`markSchedulerNotExpected('snmp')`, asi que `/api/health` reporta "no esperado" y
todo parece normal.

Revisado `openspec/changes/archive/2026-09-10-fase-0-real-snmp-receiver/`: sus
6 secciones estan completas y el verify-report declara validada la entrega de
traps reales, pero **no menciona `instrumentation` en ningun artefacto**. Es un
olvido, no una decision de diseno.

Ademas, aunque se arrancara, `onEvent` y `onEvidence` no tienen implementacion:
no hay destino definido para un trap.

## Decision

- **Destino: `DeviceEvent`**, entrando por el mismo spool durable que syslog.
  `deviceKind` y `deviceId` ya existen como columnas y hoy nadie las escribe.
- **El receptor sigue apagado por defecto.** Se cablea respetando
  `SNMP_RECEIVER_ENABLED`, sin cambiar el comportamiento por defecto (Regla 10
  del proyecto).

## Mapeo TelemetryEvent -> DeviceEvent

| TelemetryEvent | DeviceEvent |
|---|---|
| `tenantId` | `tenantId` |
| `tags.connectionId` | `connectionId` |
| `deviceKind` | `deviceKind` |
| `deviceId` | `deviceId` |
| `ts` | `occurredAt` |
| `tags.trapCategory` | `category` (mapeado) |
| resumen legible | `message` |

Mapeo de categoria, porque `DeviceEventCategory` solo tiene cuatro valores:

| trapCategory | DeviceEventCategory |
|---|---|
| `auth_failure`, `config_change` | igual (existen en el enum) |
| `los`, `los_clear`, `dying_gasp`, `link_down`, `link_up`, `onu_offline`, `onu_online`, `otdr_fiber_break` | `access` |
| resto (`card_failure`, `ont_discovery`, ...) | `other` |

## Tareas

- [x] T1 `IngestEventInput`: agregar `deviceKind` y `deviceId`
- [x] T2 `snmp-ingest.ts`: mapeo TelemetryEvent -> payload + spool
- [x] T3 Cablear `startSnmpReceiver` en `instrumentation.ts`
- [x] T4 Tests: mapeo, spool y trampa real a traves del receptor

## Limitaciones conocidas

- `severity` queda en `null`: `parseAndNormalizeSnmpTrap` no expone la
  severidad del catalogo en su retorno. Recuperarla requiere tocar el parser.
- El OID y los varbinds crudos no se persisten: solo el resumen. La evidencia
  cruda via `onEvidence` sigue sin destino y queda para un PR aparte.

## Criterio de cierre

Con `SNMP_RECEIVER_ENABLED=true`, un trap real que llega por UDP aparece en
`device_events` con su `deviceKind`/`deviceId`, sobrevive a una caida de la base,
y el estado apagado por defecto se mantiene.