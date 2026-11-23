# T3 — Fuzz de SNMP (`packages/monitoring`)

**Feature**: `odd/tasks/fuzz-parsers.md`
**Specs**: S1, S3, S4, S5, S7
**Ruta**: worker

## Qué hacer

Suite de fuzzing sobre `packages/monitoring/src/snmp/`:

- `extractEnterprisePen(oid: string): number | null` (`iana-pen.ts:118`) — arcs
  numéricos, OID con punto inicial, OID vacío, OID con segmentos no numéricos,
  overflow de `Number`.
- `resolveVendorByPen` / `resolveVendorByOid` / `isStandardOid` (`iana-pen.ts:129-148`).
- `decodeSnmpTrap(trap: unknown, options)` (`decoder.ts:73`) — la entrada tipa como
  `unknown`, así que se fuzzea con objetos arbitrarios y con PDUs construidos.
- `formatVarbindValue` (`decoder.ts:32`).
- `createRawEvidenceEnvelope` (`evidence.ts:13`).
- `computeSnmpNotificationFingerprint` / `createSnmpIngestionGuard` (`guard.ts:43,86`).
- `sanitizeSnmpText` / `sanitizeSnmpObject` / `sanitizeSnmpCapture` (`sanitizer.ts:54,137,166`).
- `parseAndNormalizeSnmpTrap(packet, senderContext)` (`parser.ts:49`) — debe quedar
  tenant-aware: el `tenantId` del contexto es el único que aparece en el evento, el
  `connectionId` viaja en `tags`, y nada de la credencial (`community`) se filtra.

Guardas obligatorias: anti-crash (toda excepción debe ser de las permitidas), ReDoS
(deadline sobre OIDs y texto largos) y fuga (marcador de community sintético ausente
del evento y de la evidencia; ningún dato de `tenant-lab-a` en el evento de
`tenant-lab-b`).

Corpus semilla sintético en `packages/monitoring/tests/fuzz/corpus/`: OIDs de
documentación y de厂家 conocidos del catálogo, trampas v1/v2c con varbinds de
proveedores inventados, community sintética y texto Unicode.

## Superficie de edición permitida

- `packages/monitoring/tests/**` (suite y corpus)
- `packages/monitoring/package.json` (script `test:fuzz`)

## Fuera de superficie

No tocar `packages/monitoring/src/**`, ni `tests/conformance/golden/**`, ni
`research/olt/**`, ni `docs/compatibility-matrix.md`. No commitear.

## Criterios de aceptación

- `pnpm --filter @ftth-copilot/monitoring test:fuzz` pasa.
- Existe al menos un caso que verifica aislamiento entre dos tenants.
- El corpus semilla se carga y se ejecuta en cada corrida.
