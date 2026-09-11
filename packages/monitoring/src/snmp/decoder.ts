/**
 * ASN.1 / BER SNMP Datagram Decoder (Roadmap Fase 0).
 *
 * Extracts true OIDs, sysUpTime, timestamps, and typed varbinds from
 * decoded SNMP v1, v2c (TrapV2, Inform), and v3 datagrams.
 */

import * as snmp from 'net-snmp';
import type {
  DecodedSnmpNotification,
  SnmpPduType,
  SnmpVarbindDetail,
  SnmpVersion,
} from './types';

const GENERIC_V1_TRAP_OIDS: Record<number, string> = {
  0: '1.3.6.1.6.3.1.1.5.1', // coldStart
  1: '1.3.6.1.6.3.1.1.5.2', // warmStart
  2: '1.3.6.1.6.3.1.1.5.3', // linkDown
  3: '1.3.6.1.6.3.1.1.5.4', // linkUp
  4: '1.3.6.1.6.3.1.1.5.5', // authenticationFailure
  5: '1.3.6.1.6.3.1.1.5.6', // egpNeighborLoss
};

const SYS_UP_TIME_OID = '1.3.6.1.2.1.1.3.0';
const SNMP_TRAP_OID = '1.3.6.1.6.3.1.1.4.1.0';

export function formatVarbindValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) {
    const isAscii = /^[\x20-\x7E]*$/.test(value.toString('binary'));
    return isAscii ? value.toString('utf8') : value.toString('hex');
  }
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

interface RawTrapPayload {
  pdu?: {
    type?: number;
    id?: number;
    enterprise?: string;
    genericTrap?: number;
    specificTrap?: number;
    upTime?: number;
    user?: { name?: string };
    msgSecurityModel?: number;
    scoped?: boolean;
    contextEngineID?: string | Buffer;
    varbinds?: Array<{ oid?: unknown; type?: unknown; value?: unknown }>;
  };
  user?: unknown;
  rinfo?: {
    address: string;
    port: number;
    family?: string;
    size?: number;
  };
}

/**
 * Decodes a raw net-snmp trap/inform notification into a structured DecodedSnmpNotification.
 */
export function decodeSnmpTrap(
  trap: unknown,
  options: { versionHint?: SnmpVersion; receivedAtMs?: number } = {},
): DecodedSnmpNotification {
  const raw = (trap ?? {}) as RawTrapPayload;
  const pdu = raw.pdu ?? {};
  const rinfo = raw.rinfo ?? { address: '127.0.0.1', port: 162 };
  const receivedAtMs = options.receivedAtMs ?? Date.now();

  let pduType: SnmpPduType = 'TrapV2';
  if (pdu.type === snmp.PduType.Trap) {
    pduType = 'Trap';
  } else if (pdu.type === snmp.PduType.InformRequest) {
    pduType = 'InformRequest';
  }

  let version: SnmpVersion = 'v2c';
  if (pduType === 'Trap') {
    version = 'v1';
  } else if (pdu.scoped === true || Boolean(pdu.contextEngineID) || pdu.msgSecurityModel === 3 || pdu.user || raw.user) {
    version = 'v3';
  } else if (options.versionHint) {
    version = options.versionHint;
  }

  const rawVarbinds = Array.isArray(pdu.varbinds) ? pdu.varbinds : [];
  const varbinds: SnmpVarbindDetail[] = [];
  let sysUpTime: number | undefined = undefined;
  let trapOid: string | undefined = undefined;
  let eventTime: string | undefined = undefined;

  if (pduType === 'Trap') {
    // SNMPv1
    sysUpTime = typeof pdu.upTime === 'number' ? pdu.upTime : undefined;
    const generic = pdu.genericTrap;
    if (typeof generic === 'number' && generic in GENERIC_V1_TRAP_OIDS) {
      trapOid = GENERIC_V1_TRAP_OIDS[generic];
    } else if (generic === 6 && pdu.enterprise) {
      const specific = pdu.specificTrap ?? 1;
      trapOid = `${pdu.enterprise}.0.${specific}`;
    } else if (pdu.enterprise) {
      trapOid = pdu.enterprise;
    }
  }

  // Process varbinds
  for (const vb of rawVarbinds) {
    const oid = String(vb.oid || '').trim();
    const typeNum = vb.type;
    const typeMap = snmp.ObjectType as unknown as Record<string | number, string>;
    const typeStr = (typeof typeNum === 'number' || typeof typeNum === 'string') && typeMap[typeNum]
      ? typeMap[typeNum]
      : (typeof typeNum === 'string' ? typeNum : 'Unknown');
    const value = formatVarbindValue(vb.value);
    const rawHex = Buffer.isBuffer(vb.value) ? vb.value.toString('hex') : undefined;

    if (oid === SYS_UP_TIME_OID && sysUpTime === undefined) {
      sysUpTime = typeof vb.value === 'number' ? vb.value : Number.parseInt(String(value), 10) || 0;
    } else if (oid === SNMP_TRAP_OID && trapOid === undefined) {
      trapOid = String(value);
    } else {
      varbinds.push({
        oid,
        type: typeStr,
        value,
        rawHex,
      });
    }

    // Check if varbind looks like an ISO event time
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      eventTime = value;
    }
  }

  if (!trapOid) {
    trapOid = '1.3.6.1.6.3.1.1.5.0'; // Fallback generic notification OID
  }

  return {
    version,
    pduType,
    senderIp: rinfo.address,
    senderPort: rinfo.port,
    trapOid,
    sysUpTime,
    eventTime,
    receivedAtMs,
    varbinds,
    requestId: typeof pdu.id === 'number' ? pdu.id : undefined,
  };
}
