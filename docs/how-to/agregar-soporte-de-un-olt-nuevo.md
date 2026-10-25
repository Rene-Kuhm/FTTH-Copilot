# Agregar soporte de un OLT nuevo

**Objetivo:** incorporar soporte SNMP para un fabricante de OLT que todavía no está
interpretado: registrar sus fuentes, escribir el adapter, sumar fixtures, tests y golden
files, y pasar todos los gates de CI.

> **Ojo con la documentación anterior.** `docs/contributing-snmp.md` describe un API
> `canHandle(trap)` que **no existe** en el código. El contrato real es la interfaz
> `OltVendorAdapter` con `supports(notification, identity)`, que se describe abajo. Esta
> receta sigue el contrato real.

## Requisitos

- Node ≥ 22, pnpm 11.22.0.
- El PEN IANA (Private Enterprise Number) del fabricante y su URL de MIB o manual oficial.
- Al menos un fixture real (o sintético verificado) de las trampas del fabricante.

## 1. Registrá el vendor en el catálogo IANA de PENs

La identidad del fabricante **no se deduce del texto libre**: está enraizada en el árbol
IANA de Private Enterprise Numbers (`1.3.6.1.4.1.<PEN>`).

En `packages/monitoring/src/snmp/iana-pen.ts`, agregá una entrada a
`IANA_VENDOR_REGISTRY` (el array está congelado con `Object.freeze`):

```ts
{
  vendorId: 'acme',                 // id en minúsculas, sin espacios
  displayName: 'ACME Networks',
  pens: [12345],                   // uno o más PENs IANA
  priority: 'P1',                  // P0 | P1 | P2
  description: 'ACME Networks (ACM-4000 series)',
}
```

El mapa inverso `PEN_TO_VENDOR_MAP` se reconstruye solo a partir del array, y
`resolveVendorByPen(pen)` / `resolveVendorByOid(oid)` lo consultan. `resolveDeviceIdentity`
(`packages/monitoring/src/snmp/identity.ts`) usa esa resolución para fijar `identity.vendor`
y `identity.pen`.

Si el PEN **no** está en el registro, `resolveVendorByOid` devuelve `null` y la trampa se
trata como estándar (`isStandardTrap: true`, `vendor: 'Standard'`). La identidad **no**
queda ambigua en ese caso, pero el match por PEN nunca ocurre, así que tu adapter no llega
a seleccionarse: por eso el paso 1 no es opcional.

La identidad sí queda ambigua (`isAmbiguous: true`) cuando hay evidencia contradictoria:
el vendor declarado en el registro de emisores no coincide con el vendor del PEN de la
trampa, o el `sysObjectID` y el OID de la trampa resuelven a vendors distintos.

## 2. Registrá las fuentes bajo `research/olt/<vendor>/`

La carpeta del vendor tiene que tener **dos** archivos: `sources.yaml` y
`compatibility.yaml`. El validador (`scripts/validate-contribution.ts`) falla si falta
alguno.

### `sources.yaml`

Lista de fuentes con grado de confianza y licencia. El schema es
`packages/monitoring/src/snmp/research/schema.ts` (`SourceRecordSchema`):

```yaml
- source_id: acme-alm-mib-001        # kebab-case en minúsculas
  vendor: ACME Networks
  families:
    - ACM-4000
  firmware: V3.2.1
  title: ACME OLT Alarm MIB
  publisher: ACME Networks
  url: https://www.acme.example.com/mibs/ALM-MIB.txt
  source_grade: A                    # A | B | C | D | E
  retrieved_at: 2026-10-01           # YYYY-MM-DD
  license: restricted                # permissive | restricted | review-required | standard
  sha256: null
  facts:
    - notification_name: acmeOnuDyingGasp
      oid: 1.3.6.1.4.1.12345.1.1.2.1
      status: recognized              # provisional | recognized | deprecated
      severity: critical
      category: dying_gasp
```

Grados de confianza (`docs/procedimiento-fuentes-mibs.md`):

| Grado | Naturaleza | Requisito |
|---|---|---|
| **A** | Estándar oficial (IETF/ITU-T/BBF) o portal/documento oficial del fabricante con versión | Autosuficiente |
| **B** | MIB publicada en proyectos maduros reconocidos (LibreNMS, Observium, Net-SNMP) | Verificar origen, revisión y licencia |
| **C** | Proyecto comunitario o herramienta con evidencia sobre hardware identificado | Al menos una segunda fuente concordante |
| **D** | Manual espejo, blog, plantilla o script no verificado | Sólo descubrimiento |
| **E** | Comentario en foro o fragmento no documentado | Hipótesis de investigación |

Reglas de admisibilidad que no se negocian:

- **Ninguna** credencial SNMP (comunidad, usuario USM, claves), IP privada de producción,
  identificador de abonado ni serial real de cliente en el repo.
- Para fuentes `restricted` o `review-required` **no** se redistribuyen archivos MIB
  propietarios: se registra la URL oficial, el editor, la fecha de consulta, el hash
  SHA-256 local (si se obtuvo lícitamente) y sólo los hechos mínimos observables (OID,
  nombre de trampa, tipos de varbinds).

### `compatibility.yaml`

Declara el vendor, sus PENs y las familias de hardware con su nivel de soporte
(`VendorCompatibilityRecordSchema`):

```yaml
vendor: ACME Networks
priority: P1
iana_pens:
  - 12345
families:
  - family: ACM-4000
    level: L2                        # L0 | L1 | L2 | L3 | L4
    confidence_grade: A
    firmware: V3.2.1
    supported_traps:
      - acmeOnuDyingGasp
      - acmeOnuOpticalPowerLoss
    sources:
      - acme-alm-mib-001
```

Niveles de soporte y la evidencia mínima que exige cada uno:

| Nivel | Denominación | Evidencia mínima | Uso permitido |
|---|---|---|---|
| **L0** | Detectado | Enterprise OID o sysObjectID | Inventario de red, sin interpretación |
| **L1** | Documentado | MIB o especificación oficial (grado A o 2× B) | Decodificación en observación |
| **L2** | Simulado | L1 + tests unitarios con datagramas binarios reales | Laboratorio y simulación offline |
| **L3** | Captura real | L2 + captura sanitizada aportada por un operador | Modo sombra en infraestructura real |
| **L4** | Certificado en campo | Generación, recepción e incidentes en red viva | Producción activa para ese modelo y firmware |

**Declarar L2+ obliga a tener fixture y test unitario.** `scripts/validate-contribution.ts`
lo verifica: si alguna familia declara `L2`, `L3` o `L4`, exige que exista
`research/olt/<vendor>/fixtures/*.json` y que exista
`packages/monitoring/tests/snmp/<vendor>-adapter.test.ts`. Sin los dos, el gate falla.

## 3. Saneá las capturas antes de commitear

Si la fuente del fixture es una captura real, pasala por el saneador **antes** de
commitearla:

```bash
pnpm sanitize:snmp --input raw-capture.log --output sanitized-capture.log
pnpm sanitize:snmp --input raw-trap.json --output sanitized-trap.json

# Sin archivos: stdin → stdout
cat raw.json | pnpm sanitize:snmp > clean.json
```

| Flag | Default | Efecto |
|---|---|---|
| `--input`, `-i` | stdin | Archivo de entrada |
| `--output`, `-o` | stdout | Archivo de salida |
| `--community`, `-c` | — | Comunidad a redactar (repetible) |
| `--token-ip` | — | Reemplazar IPs por `<REDACTED_IP>` en vez de los rangos de documentación RFC 5737 |
| `--mask-all-serials` | — | Enmascarar el serial completo, sin preservar el prefijo de 4 caracteres del vendor |
| `--help`, `-h` | — | Ayuda |

El saneador reemplaza las comunidades por `<REDACTED_COMMUNITY>`, mapea las IPs a los rangos
de documentación (`192.0.2.x`, `198.51.100.x`) y enmascara los seriales preservando el
prefijo de 4 caracteres (`HWTC`, `ZTEG`, `ALCL`, `FHTT`).

## 4. Escribí el adapter

El contrato vive en `packages/monitoring/src/snmp/adapter/contract.ts`:

```ts
export interface OltVendorAdapter {
  readonly vendorId: string;
  readonly displayName: string;
  readonly supportedPens: readonly number[];
  readonly supportedFamilies: readonly string[];

  supports(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
  ): boolean;

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent;
}
```

Reglas del contrato:

- `supports()` es el filtro: **no** debe lanzar ni tener efectos. Si la identidad es
  ambigua, tiene que devolver `false` (el registry ya la descarta, pero el adapter no
  debe confiar en eso).
- `normalize()` es una **transformación pura**: recibe la notificación, la identidad y la
  evidencia cruda y devuelve un `TelemetryEvent` (`schema: 'ftth.telemetry.v1'`). No hace
  I/O, no consulta la base, no muta sus argumentos.
- El `vendorId` es en minúsculas y es la clave con la que el registry indexa el adapter.
  El match directo del registry compara `identity.vendor.toLowerCase()` contra ese
  `vendorId`, y `identity.vendor` es el `displayName` del registro IANA: conviene que
  `vendorId === displayName.toLowerCase()` para que ese match se dispare.
- `supportedPens` y `supportedFamilies` deben coincidir con lo declarado en
  `compatibility.yaml`.

Esqueleto mínimo, en `packages/monitoring/src/snmp/adapter/<vendor>.ts`:

```ts
import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { decodeVendorSerialNumber } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class AcmeOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'acme';
  readonly displayName = 'ACME Networks';
  readonly supportedPens: readonly number[] = [12345];
  readonly supportedFamilies: readonly string[] = ['ACM-4000'];

  supports(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
  ): boolean {
    if (identity.isAmbiguous) return false;
    return (
      identity.vendor.toLowerCase() === 'acme' ||
      identity.pen === 12345 ||
      notification.trapOid.startsWith('1.3.6.1.4.1.12345.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const ifMib = extractIfMibVarbinds(notification.varbinds);

    // El serial de la ONU vive en un varbind; el helper genérico lo detecta.
    let serial: string | undefined;
    for (const vb of notification.varbinds) {
      const decoded = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (decoded) {
        serial = decoded;
        break;
      }
    }

    const isOnuScope = serial !== undefined || catalogDef.category === 'los';

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: catalogDef.category,
      trapName: catalogDef.name,
      severity: catalogDef.severity,
      fingerprint: rawEvidence.fingerprint,
    };
    if (serial) metrics.serial = serial;
    if (ifMib.ifName !== undefined) metrics.ifName = ifMib.ifName;

    return {
      schema: 'ftth.telemetry.v1',
      tenantId: identity.tenantId,
      deviceKind: isOnuScope ? 'ONU' : 'OLT',
      deviceId: isOnuScope ? (serial ?? identity.oltId) : identity.oltId,
      source: 'snmp-trap',
      ts: new Date(notification.receivedAtMs).toISOString(),
      metrics,
      tags: {
        connectionId: identity.connectionId,
        oltId: identity.oltId,
        vendor: identity.vendor,
        trapCategory: catalogDef.category,
      },
    };
  }
}
```

**La severidad sale del catálogo, no del adapter.** `lookupTrapDefinition` es la fuente de
la categoría y la severidad; si el adapter la inventa, el guard anti-inflación la rechaza
(paso siguiente). La categoría y la severidad de cada OID se registran en el catálogo
(`packages/monitoring/src/snmp/catalog.ts`).

## 5. Entendé los guardas que te van a frenar

`executeAdapterSafe` (`packages/monitoring/src/snmp/adapter/contract.ts`) envuelve a
`normalize()` y aplica cuatro invariantes:

1. **Inmutabilidad del tenant.** Si el evento devuelto tiene un `tenantId` distinto del de
   la identidad, lanza `AdapterSecurityViolationError`. El adapter no puede mover datos de
   un tenant a otro.
2. **Guarda anti-inflación de severidad.** Si el catálogo dice `info` para ese OID y el
   adapter devuelve `critical` en `metrics.severity`, lanza
   `AdapterSecurityViolationError`. La severidad tiene que estar respaldada por el
   catálogo o por las fuentes.
3. **Tags y schema.** El harness agrega `tenantId`, `connectionId`, `oltId`, `vendor` y
   `adapter` a los tags, y fuerza `catalogStatus` desde el catálogo.
4. **Hints de ODN.** El harness adjunta los hints de componentes ODN extraídos de los
   varbinds (NAP, CTO, splitter, FDH, FAT) como `metrics.odnHints`. Son **advisory**: nunca
   reemplazan la señal primaria del adapter.

O sea: el adapter no puede mutar el tenant, no puede inflar severidad sin respaldo, y no
tiene que construir los tags de identidad a mano (los pisa el harness).

## 6. Registrá el adapter en el registry

En `packages/monitoring/src/snmp/adapter/registry.ts`:

```ts
import { AcmeOltAdapter } from './acme';

export const defaultAdapterRegistry = new OltAdapterRegistry();
// ...
defaultAdapterRegistry.register(new AcmeOltAdapter());
```

Dos cosas sobre el orden y la precedencia:

- `OltAdapterRegistry.resolve()` decide así: (1) si la identidad es ambigua, devuelve el
  adapter **estándar** sin preguntar a nadie; (2) match directo por `vendorId` +
  `supports()`; (3) match por PEN de IANA + `supports()`; (4) fallback al adapter
  estándar.
- **`OpenBaselineOltAdapter` se registra antes que `GenericXponAdapter`** a propósito (el
  comentario lo dice en el archivo): las plataformas con una MIB de alarmas pública
  conservan su interpretación vendor-específica, y lo que no matchea degrada a
  `GenericXponAdapter` y después a `StandardOltAdapter`.
- **El match por PEN itera los adapters en orden de inserción** y se queda con el
  primero que declara ese PEN en `supportedPens` y acepta la notificación. Como
  `OpenBaselineOltAdapter` reclama seis PENs (Cisco, Zyxel, Ericsson, C-Data, Raisecom,
  Edgecore) y su `supports()` es permisivo, **registrá tu adapter antes que él**: si el
  baseline está primero, se queda con la trampa y el tuyo nunca corre. `GenericXponAdapter`
  no compite por PEN (`supportedPens` es vacío): entra sólo por match directo de
  `vendorId`.

## 7. Sumá el fixture y el test unitario

Fixture en `research/olt/<vendor>/fixtures/<model>-<scenario>.json`. La forma que usan los
existentes (`research/olt/huawei/fixtures/ma5600-traps.json`):

```json
[
  {
    "description": "ACME ACM-4000 ONT dying gasp alarm",
    "version": "v2c",
    "trapOid": "1.3.6.1.4.1.12345.1.1.2.1.0.2.1.14",
    "senderIp": "10.100.1.10",
    "senderPort": 162,
    "varbinds": [
      { "oid": "1.3.6.1.2.1.1.3.0", "type": "TimeTicks", "value": 345600 },
      { "oid": "1.3.6.1.4.1.12345.1.1.2.1.1", "type": "OctetString", "value": "ACME12345678" }
    ],
    "expected": {
      "vendor": "ACME Networks",
      "deviceKind": "ONU",
      "deviceId": "ACME12345678",
      "severity": "critical"
    }
  }
]
```

Test en `packages/monitoring/tests/snmp/<vendor>-adapter.test.ts`. El nombre del archivo
importa: el gate de contribución lo busca exactamente con ese patrón
(`<vendor>-adapter.test.ts`) cuando la familia declara L2+. Mirá
`packages/monitoring/tests/snmp/huawei-adapter.test.ts` como plantilla: verificá que
`supports()` acepta la identidad del vendor y rechaza la ambigua, y que `normalize()`
devuelve el `deviceKind`/`deviceId`/`severity` esperados.

## 8. Generá el golden file

El generador escribe un snapshot por vendor en
`packages/monitoring/tests/conformance/golden/`:

```bash
npx tsx scripts/generate-golden-files.ts
```

Genera 9 snapshots (Huawei, ZTE, Nokia, FiberHome, Calix, Adtran, VSOL, BDCOM y RFC
Standard) en `packages/monitoring/tests/conformance/golden/*.golden.json`. **Muta
archivos**: revisá el diff y commiteá el golden de tu vendor junto con el adapter. La
suite `packages/monitoring/tests/conformance/golden-snapshots.test.ts` compara el snapshot
contra el adapter; si el adapter cambia de comportamiento, el golden hay que regenerarlo.

Para agregar tu vendor al generador, agregá una entrada a `CONFIGS` en
`scripts/generate-golden-files.ts` con la identidad, la notificación y el nombre de
archivo (`<vendor>.golden.json`).

## 9. Corré los gates

```bash
pnpm check:sources        # drift de la matriz de compatibilidad (docs/compatibility-matrix.md)
pnpm check:conflicts      # colisiones de OID entre vendors y PEN que no coinciden
pnpm check:contribution   # Gate 1 + Gate 8 por vendor
pnpm test:conformance     # suite de conformidad SNMP
pnpm turbo run lint typecheck test
```

Qué falla cada uno:

| Comando | Qué verifica |
|---|---|
| `pnpm check:sources` | Que `docs/compatibility-matrix.md` refleje el estado actual de `research/olt/`. Si falla por drift: `pnpm generate:matrix:write` y commiteá el archivo regenerado |
| `pnpm check:conflicts` | Colisiones de OID entre vendors, PEN que no coinciden con el registro IANA y contradicciones semánticas de categoría/severidad. Sale con código 1 si hay errores |
| `pnpm check:contribution` | Que cada vendor tenga `sources.yaml` y `compatibility.yaml` válidos, y que si declara L2+ tenga fixture en `research/olt/<vendor>/fixtures/` y test en `packages/monitoring/tests/snmp/<vendor>-adapter.test.ts`. Para un vendor puntual: `pnpm check:contribution -- --vendor acme` |
| `pnpm test:conformance` | Golden snapshots, aislamiento por tenant, escenarios de falla, property-based de ASN.1 y ciclo de vida de contribución Gate 8 |
| `pnpm turbo run lint typecheck test` | Lint, typecheck y toda la suite unitaria del monorepo |

El CI corre los mismos checks en el job `lint-and-typecheck` de
`.github/workflows/ci.yml`, más `check:sources` con `git diff --exit-code` sobre la matriz.

## 10. Actualizá la matriz de compatibilidad

```bash
pnpm generate:matrix:write
```

Escribe `docs/compatibility-matrix.md`. Si no lo hacés, `pnpm check:sources` falla por
drift en el CI.

## Cómo verificar

```bash
# El vendor quedó registrado en el catálogo IANA
pnpm --filter @ftth-copilot/monitoring run test tests/snmp/iana-pen.test.ts

# Tu adapter aislado
pnpm --filter @ftth-copilot/monitoring run test tests/snmp/acme-adapter.test.ts

# El pipeline completo (identidad → adapter → safe normalize → errata → telemetría)
pnpm --filter @ftth-copilot/monitoring run test tests/snmp/pipeline.test.ts

# La conformidad, con golden files
pnpm test:conformance
```

El pipeline real es `processSnmpNotification`
(`packages/monitoring/src/snmp/pipeline.ts`), y sus etapas son:

```text
1. resolveDeviceIdentity(notification, senderContext)     → identidad autoritativa
2. registry.resolve(notification, identity)                → adapter determinista
3. executeAdapterSafe(adapter, notification, identity, ev) → evento + invariantes
4. evaluateSnmpErrata(...)                                 → suppress / remap
5. onTelemetryEvent?.(event, evidence, identity)            → telemetría
```

Si la etapa 3 lanza `AdapterSecurityViolationError`, el problema es el adapter: está
mutando el tenant o inflando la severidad.

## Erratas de firmware (opcional)

Si el fabricante emite trampas de prueba o falsos positivos conocidos, se documentan en
`research/olt/errata.yaml` y se aplican en la etapa 4 del pipeline:

```yaml
- errata_id: ERR-ACME-001
  vendor: ACME Networks
  target_models:
    - ACM-4000
  firmware_versions:
    - V3.2.1
  oid: "1.3.6.1.4.1.12345.1.1.2.9.9"
  action: suppress            # suppress | remap
  reason: "Trampa de loopback de autodiagnóstico en builds tempranos"
  source_reference: "ACME Field Bulletin 2026-01"
```

Con `action: suppress` el evento queda marcado con `errata_action: "suppressed"`; con
`remap` se le puede cambiar `category` y `severity`.

## Troubleshooting

- **"Adapter 'acme' attempted to mutate tenantId"** → el `normalize()` está armando el
  evento con un tenant distinto del de `identity.tenantId`. Usá `identity.tenantId`.
- **"Adapter 'acme' attempted unjustified severity inflation from 'info' to 'critical'"** →
  el catálogo define ese OID como `info`. Registrá el OID en el catálogo con la severidad
  correcta y respaldada por la fuente, o devolvé la severidad del catálogo.
- **El adapter nunca se ejecuta** → revisá el orden de precedencia: match por `vendorId`
  (minúsculas) o por PEN, y que `supports()` no devuelva `false` en una identidad no
  ambigua. Si el PEN no está en `IANA_VENDOR_REGISTRY`, la trampa se trata como estándar y
  el match por PEN nunca ocurre; el registry devuelve el adapter estándar sin preguntar.
- **`pnpm check:contribution` dice "lacks adapter unit test"** → el archivo tiene que
  llamarse exactamente `packages/monitoring/tests/snmp/<vendor>-adapter.test.ts`, con
  `<vendor>` igual al nombre de la carpeta en `research/olt/`.
- **`pnpm check:contribution` dice "lacks reproduction fixture"** → falta al menos un
  `*.json` en `research/olt/<vendor>/fixtures/`.
- **`pnpm check:sources` falla por drift** → `pnpm generate:matrix:write` y commiteá
  `docs/compatibility-matrix.md`.
- **`pnpm check:conflicts` reporta un PEN que no coincide** → el `iana_pens` de
  `compatibility.yaml` no coincide con el `IANA_VENDOR_REGISTRY` de
  `packages/monitoring/src/snmp/iana-pen.ts`.
- **El golden snapshot falla después de tocar el adapter** → regenerá con
  `npx tsx scripts/generate-golden-files.ts` y revisá el diff.
- **El OID queda como `provisionalTrap` / `unknown_trap`** → el OID no está registrado en el
  catálogo (`packages/monitoring/src/snmp/catalog.ts`) o la trampa es provisional y el
  simulador está apagado (`FTTH_SIMULATOR_ALLOW_PROVISIONAL`).
