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
  | 'los_clear'
  | 'dying_gasp'
  | 'link_down'
  | 'link_up'
  | 'restart'
  | 'auth_failure'
  | 'config_change'
  | 'onu_offline'
  | 'onu_online'
  | 'pon_down'
  | 'pon_up'
  | 'card_failure'
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
  is_clear?: boolean;
  clears_trap_oid?: string;
  status?: 'recognized' | 'provisional' | 'deprecated';
  catalogStatus?: 'recognized' | 'provisional' | 'deprecated' | 'unregistered';
}

export interface LookupTrapOptions {
  allowProvisional?: boolean;
}

let simulatorProvisionalTrapsEnabled = false;

/**
 * Explicitly enables or disables provisional trap definitions in simulator / lab testing.
 * In production, provisional traps remain disabled by default and degrade to unknown_trap (info).
 */
export function setSimulatorProvisionalTraps(enabled = true): void {
  simulatorProvisionalTrapsEnabled = enabled;
}

export function isSimulatorProvisionalTrapsEnabled(): boolean {
  return (
    simulatorProvisionalTrapsEnabled ||
    process.env.FTTH_SIMULATOR_ALLOW_PROVISIONAL === 'true'
  );
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
    status: 'provisional',
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
    status: 'provisional',
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
    status: 'provisional',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.10',
    name: 'hwGponOntOffline',
    category: 'onu_offline',
    severity: 'warning',
    vendor: 'Huawei',
    description: 'GPON ONT has transitioned to offline state',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.11',
    name: 'hwGponOntOnline',
    category: 'onu_online',
    severity: 'info',
    vendor: 'Huawei',
    description: 'GPON ONT is online and authenticated',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.10',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.12',
    name: 'hwGponOntLosClear',
    category: 'link_up',
    severity: 'info',
    vendor: 'Huawei',
    description: 'GPON ONT optical loss of signal cleared',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.20',
    name: 'hwGponPortDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'Huawei',
    description: 'OLT GPON port operational status down',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.21',
    name: 'hwGponPortUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'Huawei',
    description: 'OLT GPON port operational status up',
    source_id: 'huawei-ma5600-manual-v800',
    source_grade: 'B',
    license: 'restricted',
    target_models: ['MA5600', 'MA5800'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.20',
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
    status: 'provisional',
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
    status: 'provisional',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.3',
    name: 'zxGponOntLossOfFrame',
    category: 'los',
    severity: 'critical',
    vendor: 'ZTE',
    description: 'Loss of frame on ZTE GPON ONT',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.10',
    name: 'zxGponOntOffline',
    category: 'onu_offline',
    severity: 'warning',
    vendor: 'ZTE',
    description: 'ZTE GPON ONT offline event',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.11',
    name: 'zxGponOntOnline',
    category: 'onu_online',
    severity: 'info',
    vendor: 'ZTE',
    description: 'ZTE GPON ONT online registration',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.10',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.12',
    name: 'zxGponOntLosClear',
    category: 'link_up',
    severity: 'info',
    vendor: 'ZTE',
    description: 'ZTE GPON ONT loss of signal recovery',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.20',
    name: 'zxGponPortDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'ZTE',
    description: 'ZTE OLT PON port communication failure',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.21',
    name: 'zxGponPortUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'ZTE',
    description: 'ZTE OLT PON port communication restored',
    source_id: 'zte-c300-mib-librenms',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['C300', 'C600'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.20',
  },

  // ── Fiberhome GPON Traps (FH-GPON-MIB) ─────────────────────────────────────
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.1',
    name: 'fhGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'Fiberhome',
    description: 'Loss of optical signal on Fiberhome GPON ONT',
    source_id: 'fiberhome-snmp-implementation-001',
    source_grade: 'B',
    license: 'permissive',
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
    source_id: 'fiberhome-snmp-implementation-001',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.3',
    name: 'fhGponOntOffline',
    category: 'onu_offline',
    severity: 'warning',
    vendor: 'Fiberhome',
    description: 'Fiberhome GPON ONT disconnected or offline',
    source_id: 'fiberhome-snmp-implementation-001',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.4',
    name: 'fhGponOntOnline',
    category: 'onu_online',
    severity: 'info',
    vendor: 'Fiberhome',
    description: 'Fiberhome GPON ONT reconnected and operational',
    source_id: 'fiberhome-snmp-implementation-001',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3807.1.3.1.1.3',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.1.5',
    name: 'fhGponOntLosClear',
    category: 'los_clear',
    severity: 'info',
    vendor: 'Fiberhome',
    description: 'Fiberhome GPON ONT optical signal restored',
    source_id: 'fiberhome-snmp-implementation-001',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3807.1.3.1.1.1',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.2.1',
    name: 'fhGponPortDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'Fiberhome',
    description: 'Fiberhome GPON PON port link down',
    source_id: 'fiberhome-snmp-implementation-001',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.3.1.2.2',
    name: 'fhGponPortUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'Fiberhome',
    description: 'Fiberhome GPON PON port link restored',
    source_id: 'fiberhome-snmp-implementation-001',
    source_grade: 'B',
    license: 'permissive',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3807.1.3.1.2.1',
  },
  {
    oid: '1.3.6.1.4.1.3807.1.1.1.1',
    name: 'fhCardFailure',
    category: 'card_failure',
    severity: 'critical',
    vendor: 'Fiberhome',
    description: 'Fiberhome OLT service board/card fault',
    source_id: 'fiberhome-librenms-common-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['AN5516', 'AN6000'],
    firmware: 'unknown',
  },

  // ── Nokia / Alcatel-Lucent GPON & Lightspan Traps (ASAM / TIMETRA) ─────────
  {
    oid: '1.3.6.1.4.1.637.61.1.36.1.1.1',
    name: 'nokiaOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'Nokia',
    description: 'Loss of optical signal on Nokia 7360 ISAM ONT',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX', 'Lightspan-MF'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.637.61.1.36.1.1.2',
    name: 'nokiaOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'Nokia',
    description: 'Dying gasp power failure on Nokia 7360 ISAM ONT',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX', 'Lightspan-MF'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.637.61.1.36.1.1.3',
    name: 'nokiaOntOffline',
    category: 'onu_offline',
    severity: 'warning',
    vendor: 'Nokia',
    description: 'Nokia 7360 ISAM ONT offline or unassigned',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX', 'Lightspan-MF'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.637.61.1.36.1.1.4',
    name: 'nokiaOntOnline',
    category: 'onu_online',
    severity: 'info',
    vendor: 'Nokia',
    description: 'Nokia 7360 ISAM ONT discovered and operational',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX', 'Lightspan-MF'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.637.61.1.36.1.1.3',
  },
  {
    oid: '1.3.6.1.4.1.637.61.1.36.1.1.5',
    name: 'nokiaOntLosClear',
    category: 'los_clear',
    severity: 'info',
    vendor: 'Nokia',
    description: 'Nokia 7360 ISAM ONT optical signal restored',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX', 'Lightspan-MF'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.637.61.1.36.1.1.1',
  },
  {
    oid: '1.3.6.1.4.1.637.61.1.36.2.1.1',
    name: 'nokiaPonPortDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'Nokia',
    description: 'Nokia 7360 ISAM GPON port down',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX', 'Lightspan-MF'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.637.61.1.36.2.1.2',
    name: 'nokiaPonPortUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'Nokia',
    description: 'Nokia 7360 ISAM GPON port restored',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX', 'Lightspan-MF'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.637.61.1.36.2.1.1',
  },
  {
    oid: '1.3.6.1.4.1.637.61.1.3.1.1.1',
    name: 'nokiaCardFailure',
    category: 'card_failure',
    severity: 'critical',
    vendor: 'Nokia',
    description: 'Nokia ISAM line card equipment fault',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['7360-ISAM-FX'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.6527.3.1.2.2.4.3',
    name: 'nokiaLightspanPortDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'Nokia',
    description: 'Nokia Lightspan MF port down',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['Lightspan-MF'],
    firmware: 'unknown',
  },
  {
    oid: '1.3.6.1.4.1.6527.3.1.2.2.4.4',
    name: 'nokiaLightspanPortUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'Nokia',
    description: 'Nokia Lightspan MF port restored',
    source_id: 'nokia-broadband-access-001',
    source_grade: 'A',
    license: 'restricted',
    target_models: ['Lightspan-MF'],
    firmware: 'unknown',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.6527.3.1.2.2.4.3',
  },

  // ── Calix Networks E7 Traps (PEN 6321 / 1264) ──────────────────────────────
  {
    oid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
    name: 'e7TrapAlarm',
    category: 'los',
    severity: 'critical',
    vendor: 'Calix',
    description: 'Calix E7 alarm event notification (LOS, dying gasp, ONT offline/online, card or port status)',
    source_id: 'calix-e7-librenms-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['E7'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.6321.1.2.2.4.2.2',
    name: 'e7TrapEvent',
    category: 'unknown_trap',
    severity: 'info',
    vendor: 'Calix',
    description: 'Calix E7 general system event notification',
    source_id: 'calix-e7-librenms-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['E7'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.6321.1.2.2.4.2.3',
    name: 'e7TrapDbChange',
    category: 'config_change',
    severity: 'info',
    vendor: 'Calix',
    description: 'Calix E7 configuration database change notification',
    source_id: 'calix-e7-librenms-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['E7'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.6321.1.2.2.4.2.4',
    name: 'e7TrapSecurity',
    category: 'auth_failure',
    severity: 'warning',
    vendor: 'Calix',
    description: 'Calix E7 security event notification',
    source_id: 'calix-e7-librenms-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['E7'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.6321.1.2.2.4.2.10',
    name: 'e7TrapAlarmClear',
    category: 'los_clear',
    severity: 'info',
    vendor: 'Calix',
    description: 'Calix E7 alarm cleared recovery notification',
    source_id: 'calix-e7-librenms-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['E7'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
  },

  // ── ADTRAN Total Access 5000 GPON Traps (PEN 664) ──────────────────────────
  {
    oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1',
    name: 'adGenGponOntAlarmSlotLosLevel',
    category: 'los',
    severity: 'critical',
    vendor: 'Adtran',
    description: 'Adtran TA5000 GPON ONT loss of signal alarm',
    source_id: 'adtran-ta5000-tc-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['TA5000'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.25',
    name: 'adGenGponOntOMCICommFailAlarmSet',
    category: 'onu_offline',
    severity: 'warning',
    vendor: 'Adtran',
    description: 'Adtran TA5000 GPON ONT OMCI communication failure alarm',
    source_id: 'adtran-ta5000-tc-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['TA5000'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.38',
    name: 'adGenGponOntDyingGaspAlarm',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'Adtran',
    description: 'Adtran TA5000 GPON ONT dying gasp alarm',
    source_id: 'adtran-ta5000-tc-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['TA5000'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.5',
    name: 'adGenGponPonDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'Adtran',
    description: 'Adtran TA5000 GPON PON port link down',
    source_id: 'adtran-ta5000-tc-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['TA5000'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.6',
    name: 'adGenGponPonUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'Adtran',
    description: 'Adtran TA5000 GPON PON port link up restored',
    source_id: 'adtran-ta5000-tc-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['TA5000'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.5',
  },
  {
    oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.26',
    name: 'adGenGponOntOnline',
    category: 'onu_online',
    severity: 'info',
    vendor: 'Adtran',
    description: 'Adtran TA5000 GPON ONT online / OMCI restored',
    source_id: 'adtran-ta5000-tc-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['TA5000'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.25',
  },
  {
    oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.2',
    name: 'adGenGponOntLosClear',
    category: 'los_clear',
    severity: 'info',
    vendor: 'Adtran',
    description: 'Adtran TA5000 GPON ONT loss of signal cleared',
    source_id: 'adtran-ta5000-tc-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['TA5000'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1',
  },

  // -------------------------------------------------------------------------
  // VSOL V1600 Series GPON Traps (Roadmap Fase 6)
  // Source: Guangzhou V-Solution Enterprise MIB (vsol-gpon-mib-002, Grade B)
  // -------------------------------------------------------------------------
  {
    oid: '1.3.6.1.4.1.37950.5.1.1.1',
    name: 'vsolGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'VSOL',
    description: 'VSOL GPON ONT power failure / dying gasp',
    source_id: 'vsol-gpon-mib-002',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['V1600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.37950.5.1.1.2',
    name: 'vsolGponOntLossOfSignal',
    category: 'los',
    severity: 'critical',
    vendor: 'VSOL',
    description: 'VSOL GPON ONT optical loss of signal',
    source_id: 'vsol-gpon-mib-002',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['V1600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.37950.5.1.1.3',
    name: 'vsolGponOntOnline',
    category: 'onu_online',
    severity: 'info',
    vendor: 'VSOL',
    description: 'VSOL GPON ONT online registration',
    source_id: 'vsol-gpon-mib-002',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['V1600'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.37950.5.1.1.4',
  },
  {
    oid: '1.3.6.1.4.1.37950.5.1.1.4',
    name: 'vsolGponOntOffline',
    category: 'onu_offline',
    severity: 'warning',
    vendor: 'VSOL',
    description: 'VSOL GPON ONT de-registration / offline',
    source_id: 'vsol-gpon-mib-002',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['V1600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.37950.5.1.2.1',
    name: 'vsolGponPortDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'VSOL',
    description: 'VSOL OLT PON port link down',
    source_id: 'vsol-gpon-mib-002',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['V1600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.37950.5.1.2.2',
    name: 'vsolGponPortUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'VSOL',
    description: 'VSOL OLT PON port link up',
    source_id: 'vsol-gpon-mib-002',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['V1600'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.37950.5.1.2.1',
  },

  // -------------------------------------------------------------------------
  // BDCOM P3600 Series GPON Traps (Roadmap Fase 6)
  // Source: NMS-GPON-MIB via LibreNMS (bdcom-librenms-gpon-mib-001, Grade B)
  // -------------------------------------------------------------------------
  {
    oid: '1.3.6.1.4.1.3320.101.10.0.1',
    name: 'nmsGponOntDyingGasp',
    category: 'dying_gasp',
    severity: 'critical',
    vendor: 'BDCOM',
    description: 'BDCOM GPON ONT dying gasp alarm',
    source_id: 'bdcom-librenms-gpon-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['P3600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.3320.101.10.0.2',
    name: 'nmsGponOntLos',
    category: 'los',
    severity: 'critical',
    vendor: 'BDCOM',
    description: 'BDCOM GPON ONT loss of signal alarm',
    source_id: 'bdcom-librenms-gpon-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['P3600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.3320.101.10.0.3',
    name: 'nmsGponOntOnline',
    category: 'onu_online',
    severity: 'info',
    vendor: 'BDCOM',
    description: 'BDCOM GPON ONT online registration',
    source_id: 'bdcom-librenms-gpon-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['P3600'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3320.101.10.0.4',
  },
  {
    oid: '1.3.6.1.4.1.3320.101.10.0.4',
    name: 'nmsGponOntOffline',
    category: 'onu_offline',
    severity: 'warning',
    vendor: 'BDCOM',
    description: 'BDCOM GPON ONT offline / de-registration',
    source_id: 'bdcom-librenms-gpon-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['P3600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.3320.101.10.0.5',
    name: 'nmsGponPonDown',
    category: 'pon_down',
    severity: 'critical',
    vendor: 'BDCOM',
    description: 'BDCOM OLT PON port link down',
    source_id: 'bdcom-librenms-gpon-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['P3600'],
    firmware: 'any',
  },
  {
    oid: '1.3.6.1.4.1.3320.101.10.0.6',
    name: 'nmsGponPonUp',
    category: 'pon_up',
    severity: 'info',
    vendor: 'BDCOM',
    description: 'BDCOM OLT PON port link up',
    source_id: 'bdcom-librenms-gpon-mib-001',
    source_grade: 'B',
    license: 'review-required',
    target_models: ['P3600'],
    firmware: 'any',
    is_clear: true,
    clears_trap_oid: '1.3.6.1.4.1.3320.101.10.0.5',
  },
];

const TRAP_MAP = new Map<string, SnmpTrapDefinition>(
  KNOWN_TRAP_DEFINITIONS.map((def) => [def.oid, def]),
);

export function isKnownTrapOid(oid: string): boolean {
  const clean = oid.trim();
  if (TRAP_MAP.has(clean)) return true;
  return KNOWN_TRAP_DEFINITIONS.some((def) => clean.startsWith(`${def.oid}.`));
}

/**
 * Looks up a trap definition by OID.
 *
 * Checks exact match first. If not found, checks for the longest matching
 * registered trap OID prefix (for instance-indexed traps like .frame.slot.port.onuId).
 * For unknown OIDs, returns a safe fallback definition with `category: 'unknown_trap'`
 * and `severity: 'info'` (Rule 6.4: no fabricated diagnoses).
 */
export function lookupTrapDefinition(
  oid: string,
  options?: LookupTrapOptions,
): SnmpTrapDefinition {
  const clean = oid.trim();
  const allowProvisional =
    options?.allowProvisional ?? isSimulatorProvisionalTrapsEnabled();

  const exact = TRAP_MAP.get(clean);
  let def = exact;

  if (!def) {
    for (const d of KNOWN_TRAP_DEFINITIONS) {
      if (clean.startsWith(`${d.oid}.`)) {
        if (!def || d.oid.length > def.oid.length) {
          def = d;
        }
      }
    }
  }

  if (def) {
    if (def.status === 'provisional') {
      if (allowProvisional) {
        return {
          ...def,
          catalogStatus: 'provisional',
        };
      }
      return {
        oid: def.oid,
        name: def.name,
        category: 'unknown_trap',
        severity: 'info',
        description: `${def.description} [PROVISIONAL - Suppressed pending physical confirmation]`,
        status: 'provisional',
        catalogStatus: 'provisional',
      };
    }

    return {
      ...def,
      catalogStatus: def.status ?? 'recognized',
    };
  }

  return {
    oid: clean,
    name: 'unknownTrap',
    category: 'unknown_trap',
    severity: 'info',
    description: 'Unregistered SNMP trap OID',
    status: 'deprecated',
    catalogStatus: 'unregistered',
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

