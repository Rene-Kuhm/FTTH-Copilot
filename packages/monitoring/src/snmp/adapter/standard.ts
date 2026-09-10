/**
 * Standard RFC OLT Adapter (Roadmap Fase 2).
 *
 * Baseline adapter handling:
 * - SNMPv2-MIB (coldStart, warmStart, authenticationFailure)
 * - IF-MIB (linkDown, linkUp, ifIndex, ifOperStatus, ifAdminStatus)
 * - ENTITY-MIB (entConfigChange)
 * - Unknown / generic trap fallback
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class StandardOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'standard';
  readonly displayName = 'Standard RFC';
  readonly supportedPens: readonly number[] = [];
  readonly supportedFamilies: readonly string[] = ['RFC-Compliant-OLT'];

  /**
   * The Standard adapter supports all standard traps and serves as fallback.
   */
  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    return identity.isStandardTrap || identity.isAmbiguous || identity.vendor === 'Standard';
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract IF-MIB attributes if present
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: catalogDef.category,
      trapName: catalogDef.name,
      severity: catalogDef.severity,
      vendor: identity.vendor,
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (notification.sysUpTime !== undefined) {
      metrics['sysUpTime'] = notification.sysUpTime;
    }
    if (notification.eventTime !== undefined) {
      metrics['eventTime'] = notification.eventTime;
    }

    // Embed extracted IF-MIB metrics
    if (ifMibData.ifIndex !== undefined) metrics['ifIndex'] = ifMibData.ifIndex;
    if (ifMibData.ifAdminStatus !== undefined) metrics['ifAdminStatus'] = ifMibData.ifAdminStatus;
    if (ifMibData.ifOperStatus !== undefined) metrics['ifOperStatus'] = ifMibData.ifOperStatus;
    if (ifMibData.ifDescr !== undefined) metrics['ifDescr'] = ifMibData.ifDescr;
    if (ifMibData.ifName !== undefined) metrics['ifName'] = ifMibData.ifName;
    if (ifMibData.ifAlias !== undefined) metrics['ifAlias'] = ifMibData.ifAlias;

    const tags: Record<string, string> = {
      connectionId: identity.connectionId,
      oltId: identity.oltId,
      vendor: identity.vendor,
      trapCategory: catalogDef.category,
      snmpVersion: notification.version,
      pduType: notification.pduType,
    };

    if (ifMibData.ifName) tags['interface'] = ifMibData.ifName;
    if (ifMibData.ifOperStatus) tags['operStatus'] = ifMibData.ifOperStatus;

    return {
      schema: 'ftth.telemetry.v1',
      tenantId: identity.tenantId,
      deviceKind: 'OLT',
      deviceId: identity.oltId,
      source: 'snmp-trap',
      ts: receivedAt.toISOString(),
      metrics,
      tags,
    };
  }
}
