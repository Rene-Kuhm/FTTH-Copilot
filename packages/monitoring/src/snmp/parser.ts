/**
 * SNMP Trap Parser and Normalizer (Roadmap Fase 6 — 6.3 + 6.4 & Roadmap Fase 0).
 *
 * 6.3: "Reutilizar TypeScript si alcanza; no introducir Go, Redis o NATS sin mediciones."
 * 6.4: "Implementar recepción acotada, validación, parsing y normalización al contrato
 *      de telemetría vigente. OIDs desconocidos no se convierten en diagnósticos inventados."
 * Fase 0: "Separar eventTime, sysUpTime y receivedAt. Preservar OID, tipos y valores de varbinds."
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from './catalog';
import type { SnmpSenderContext } from './mapping';

export interface SnmpVarbind {
  oid: string;
  type?: string;
  value: unknown;
  rawHex?: string;
}

export interface RawSnmpTrapPacket {
  version: 'v1' | 'v2c' | 'v3';
  community?: string;
  trapOid: string;
  varbinds: SnmpVarbind[];
  receivedAtMs?: number;
  sysUpTime?: number;
  eventTime?: string;
  pduType?: string;
}

/** Regex for typical GPON ONT Serial Numbers (e.g. HWTC12345678, ZTEGC1234567). */
const ONT_SN_REGEX = /^[A-Z]{4}[0-9A-Fa-f]{8}$/;

/**
 * Parses and normalizes an SNMP trap packet into a canonical TelemetryEvent.
 */
export function parseAndNormalizeSnmpTrap(
  packet: RawSnmpTrapPacket,
  senderContext: SnmpSenderContext,
): TelemetryEvent {
  const trapDef = lookupTrapDefinition(packet.trapOid);
  const receivedAt = packet.receivedAtMs ? new Date(packet.receivedAtMs) : new Date();

  // Extract ONU identifier from varbinds if applicable
  let onuIdentifier: string | null = null;
  for (const vb of packet.varbinds) {
    if (typeof vb.value === 'string') {
      const trimmed = vb.value.trim();
      if (ONT_SN_REGEX.test(trimmed)) {
        onuIdentifier = trimmed;
        break;
      }
    }
  }

  // Determine device kind and id
  const isOntTrap =
    trapDef.category === 'los' ||
    trapDef.category === 'dying_gasp' ||
    onuIdentifier !== null;

  const deviceKind: 'OLT' | 'ONU' = isOntTrap ? 'ONU' : 'OLT';
  const deviceId: string = isOntTrap
    ? (onuIdentifier ?? `${senderContext.oltId}-ONU-UNKNOWN`)
    : senderContext.oltId;

  const metrics: Record<string, unknown> = {
    snmpTrapOid: trapDef.oid,
    trapCategory: trapDef.category,
    trapName: trapDef.name,
    severity: trapDef.severity,
    vendor: trapDef.vendor ?? senderContext.vendor ?? 'Standard',
    description: trapDef.description,
  };

  if (packet.sysUpTime !== undefined) {
    metrics['sysUpTime'] = packet.sysUpTime;
  }
  if (packet.eventTime !== undefined) {
    metrics['eventTime'] = packet.eventTime;
  }

  return {
    schema: 'ftth.telemetry.v1',
    tenantId: senderContext.tenantId,
    deviceKind,
    deviceId,
    source: 'snmp-trap',
    ts: receivedAt.toISOString(),
    metrics,
    tags: {
      connectionId: senderContext.connectionId,
      oltId: senderContext.oltId,
      vendor: trapDef.vendor ?? senderContext.vendor ?? 'Standard',
      trapCategory: trapDef.category,
      snmpVersion: packet.version,
      pduType: packet.pduType ?? 'TrapV2',
    },
  };
}
