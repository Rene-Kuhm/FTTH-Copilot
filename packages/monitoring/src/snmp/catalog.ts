/**
 * Canonical SNMP Trap Catalog for FTTH OLTs and standard RFC traps.
 * (Roadmap Fase 6 — 6.1 + 6.4)
 *
 * 6.1: "Elegir un fabricante/modelo y recopilar MIBs, OIDs, ejemplos
 *      autorizados y semántica de traps."
 * 6.4: "OIDs desconocidos no se convierten en diagnósticos inventados."
 */

export type SnmpTrapCategory =
  | 'los'
  | 'dying_gasp'
  | 'link_down'
  | 'link_up'
  | 'restart'
  | 'unknown_trap';

export interface SnmpTrapDefinition {
  oid: string;
  name: string;
  category: SnmpTrapCategory;
  severity: 'critical' | 'warning' | 'info';
  vendor?: string;
  description: string;
}

export const KNOWN_TRAP_DEFINITIONS: ReadonlyArray<SnmpTrapDefinition> = [
  // ── RFC 1215 / RFC 3877 / IF-MIB Standard Traps ────────────────────────────
  {
    oid: '1.3.6.1.6.3.1.1.5.1',
    name: 'coldStart',
    category: 'restart',
    severity: 'info',
    vendor: 'Standard',
    description: 'Device reinitialized without configuration preserved',
  },
  {
    oid: '1.3.6.1.6.3.1.1.5.2',
    name: 'warmStart',
    category: 'restart',
    severity: 'info',
    vendor: 'Standard',
    description: 'Device reinitialized with configuration preserved',
  },
  {
    oid: '1.3.6.1.6.3.1.1.5.3',
    name: 'linkDown',
    category: 'link_down',
    severity: 'warning',
    vendor: 'Standard',
    description: 'Communication link transition from up to down',
  },
  {
    oid: '1.3.6.1.6.3.1.1.5.4',
    name: 'linkUp',
    category: 'link_up',
    severity: 'info',
    vendor: 'Standard',
    description: 'Communication link transition from down to up',
  },

  // ── Huawei SmartAX GPON Traps (HUAWEI-GPON-MIB / HUAWEI-ALARM-MIB) ─────────
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1',
    name: 'hwGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'Huawei',
    description: 'Loss of optical signal detected on GPON ONT',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2',
    name: 'hwGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'Huawei',
    description: 'Power failure / dying gasp alarm sent by GPON ONT',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.3',
    name: 'hwGponOntLossOfFrame',
    category: 'los',
    severity: 'critical',
    vendor: 'Huawei',
    description: 'Loss of frame synchronization on GPON ONT',
  },

  // ── ZTE GPON Traps (ZX-GPON-MIB) ───────────────────────────────────────────
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1',
    name: 'zxGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'ZTE',
    description: 'Loss of optical signal on ZTE GPON ONT',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.2',
    name: 'zxGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'ZTE',
    description: 'Dying gasp power cut alarm on ZTE GPON ONT',
  },

  // ── Fiberhome GPON Traps (FH-GPON-MIB) ─────────────────────────────────────
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.1',
    name: 'fhGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'Fiberhome',
    description: 'Loss of optical signal on Fiberhome GPON ONT',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.2',
    name: 'fhGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'Fiberhome',
    description: 'Dying gasp alarm on Fiberhome GPON ONT',
  },
];

const TRAP_MAP = new Map<string, SnmpTrapDefinition>(
  KNOWN_TRAP_DEFINITIONS.map((def) => [def.oid, def]),
);

export function isKnownTrapOid(oid: string): boolean {
  return TRAP_MAP.has(oid.trim());
}

/**
 * Looks up a trap definition by OID.
 *
 * For unknown OIDs, returns a safe fallback definition with `category: 'unknown_trap'`
 * and `severity: 'info'` (Rule 6.4: no fabricated diagnoses).
 */
export function lookupTrapDefinition(oid: string): SnmpTrapDefinition {
  const clean = oid.trim();
  const known = TRAP_MAP.get(clean);
  if (known) return known;

  return {
    oid: clean,
    name: 'unknownTrap',
    category: 'unknown_trap',
    severity: 'info',
    description: 'Unregistered SNMP trap OID',
  };
}
