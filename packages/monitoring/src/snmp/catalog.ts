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
  | 'auth_failure'
  | 'config_change'
  | 'unknown_trap';

export interface SnmpTrapDefinition {
  oid: string;
  name: string;
  category: SnmpTrapCategory;
  severity: 'critical' | 'warning' | 'info';
  vendor?: string;
  description: string;
  source_id?: string;
  source_grade?: 'A' | 'B' | 'C' | 'D' | 'E';
  license?: 'standard' | 'permissive' | 'restricted' | 'review-required';
  target_models?: ReadonlyArray<string>;
  firmware?: string;
}

export const KNOWN_TRAP_DEFINITIONS: ReadonlyArray<SnmpTrapDefinition> = [
  // ── RFC 1215 / RFC 3418 / IF-MIB / ENTITY-MIB Standard Traps ───────────────
  {
    oid: '1.3.6.1.6.3.1.1.5.1',
    name: 'coldStart',
    category: 'restart',
    severity: 'info',
    vendor: 'Standard',
    description: 'Device reinitialized without configuration preserved',
    source_id: 'rfc-3418-snmpv2-mib',
    source_grade: 'A',
    license: 'standard',
    target_models: ['RFC-Compliant-OLT'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.6.3.1.1.5.2',
    name: 'warmStart',
    category: 'restart',
    severity: 'info',
    vendor: 'Standard',
    description: 'Device reinitialized with configuration preserved',
    source_id: 'rfc-3418-snmpv2-mib',
    source_grade: 'A',
    license: 'standard',
    target_models: ['RFC-Compliant-OLT'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.6.3.1.1.5.3',
    name: 'linkDown',
    category: 'link_down',
    severity: 'warning',
    vendor: 'Standard',
    description: 'Communication link transition from up to down',
    source_id: 'rfc-2863-if-mib',
    source_grade: 'A',
    license: 'standard',
    target_models: ['RFC-Compliant-OLT'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.6.3.1.1.5.4',
    name: 'linkUp',
    category: 'link_up',
    severity: 'info',
    vendor: 'Standard',
    description: 'Communication link transition from down to up',
    source_id: 'rfc-2863-if-mib',
    source_grade: 'A',
    license: 'standard',
    target_models: ['RFC-Compliant-OLT'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.6.3.1.1.5.5',
    name: 'authenticationFailure',
    category: 'auth_failure',
    severity: 'warning',
    vendor: 'Standard',
    description: 'SNMP message received with invalid community or credentials',
    source_id: 'rfc-3418-snmpv2-mib',
    source_grade: 'A',
    license: 'standard',
    target_models: ['RFC-Compliant-OLT'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.2.1.47.2.0.1',
    name: 'entConfigChange',
    category: 'config_change',
    severity: 'info',
    vendor: 'Standard',
    description: 'Entity configuration or module insertion/removal event',
    source_id: 'rfc-6933-entity-mib',
    source_grade: 'A',
    license: 'standard',
    target_models: ['RFC-Compliant-OLT'],
    firmware: 'any',
  },

  // ── Huawei SmartAX GPON Traps (HUAWEI-GPON-MIB / HUAWEI-ALARM-MIB) ─────────
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1',
    name: 'hwGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'Huawei',
    description: 'Loss of optical signal detected on GPON ONT',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2',
    name: 'hwGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'Huawei',
    description: 'Power failure / dying gasp alarm sent by GPON ONT',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.3',
    name: 'hwGponOntLossOfFrame',
    category: 'los',
    severity: 'critical',
    vendor: 'Huawei',
    description: 'Loss of frame synchronization on GPON ONT',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
  },

  // ── ZTE GPON Traps (ZX-GPON-MIB) ───────────────────────────────────────────
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1',
    name: 'zxGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'ZTE',
    description: 'Loss of optical signal on ZTE GPON ONT',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.2',
    name: 'zxGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'ZTE',
    description: 'Dying gasp power cut alarm on ZTE GPON ONT',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
  },

  // ── Fiberhome GPON Traps (FH-GPON-MIB) ─────────────────────────────────────
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.1',
    name: 'fhGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'Fiberhome',
    description: 'Loss of optical signal on Fiberhome GPON ONT',
    source_id: 'fiberhome-an5516-manual-v1',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.2',
    name: 'fhGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'Fiberhome',
    description: 'Dying gasp alarm on Fiberhome GPON ONT',
    source_id: 'fiberhome-an5516-manual-v1',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
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

/**
 * Validates catalog admission rules per Gate 1:
 * Every definition admitted to the catalog must carry:
 * - non-empty source_id
 * - valid source_grade ('A'|'B'|'C'|'D'|'E')
 * - non-empty target_models
 * - explicit firmware declaration (string)
 * - valid license status
 */
export function validateCatalogAdmission(def: SnmpTrapDefinition): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!def.source_id || def.source_id.trim().length === 0) {
    errors.push(`Trap ${def.oid} (${def.name}) is missing source_id`);
  }
  if (!def.source_grade || !['A', 'B', 'C', 'D', 'E'].includes(def.source_grade)) {
    errors.push(`Trap ${def.oid} (${def.name}) has invalid source_grade: ${def.source_grade}`);
  }
  if (!def.target_models || def.target_models.length === 0) {
    errors.push(`Trap ${def.oid} (${def.name}) must declare at least one target model`);
  }
  if (def.firmware === undefined || def.firmware.trim().length === 0) {
    errors.push(`Trap ${def.oid} (${def.name}) must declare firmware (or 'unknown' / 'any')`);
  }
  if (!def.license || !['standard', 'permissive', 'restricted', 'review-required'].includes(def.license)) {
    errors.push(`Trap ${def.oid} (${def.name}) has invalid license status: ${def.license}`);
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}

