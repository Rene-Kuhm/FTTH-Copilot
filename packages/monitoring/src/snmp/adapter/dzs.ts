/**
 * DZS/Zhone OLT Vendor Adapter.
 *
 * Implements OltVendorAdapter for DZS Inc. / Zhone Technologies (PEN 5504, 6296, 5597).
 * Supports MXK series and Velocity V6 OLTs:
 * - Extracts GPON hierarchy (frame/slot/port/onuId) and ONT serials
 * - Normalizes ONT alarms with deviceKind: 'ONU' and deviceId: serial
 * - Normalizes PON port alarms with deviceKind: 'OLT'
 * - Based on Zhone-GPON-MIB (enterprise 5504)
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class DzsOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'dzs';
  readonly displayName = 'DZS / Zhone';
  readonly supportedPens: readonly number[] = [5504, 6296, 5597];
  readonly supportedFamilies: readonly string[] = ['MXK', 'Velocity'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }
    return (
      identity.vendor.toLowerCase() === 'dzs' ||
      identity.vendor.toLowerCase() === 'zhone' ||
      this.supportedPens.includes(identity.pen!) ||
      notification.trapOid.startsWith('1.3.6.1.4.1.5504.') ||
      notification.trapOid.startsWith('1.3.6.1.4.1.6296.') ||
      notification.trapOid.startsWith('1.3.6.1.4.1.5597.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract Zhone/DZS GPON hierarchy from varbinds
    const hierarchy = this.extractZhoneGponHierarchy(notification);

    // Extract any IF-MIB standard attributes
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    // Determine alarm clear pairing
    const isClear = catalogDef.is_clear ?? false;
    let clearsCategory: string | undefined;
    if (catalogDef.clears_trap_oid) {
      const clearedDef = lookupTrapDefinition(catalogDef.clears_trap_oid, {
        allowProvisional: true,
      });
      clearsCategory = clearedDef.category;
    } else if (catalogDef.name === 'zhoneGponOntOnline') {
      clearsCategory = 'onu_offline';
    } else if (catalogDef.name === 'zhoneGponOntLosClear') {
      clearsCategory = 'los';
    }

    // Determine device scope: ONT vs OLT
    const isOltLevelCategory =
      catalogDef.category === 'pon_down' ||
      catalogDef.category === 'pon_up' ||
      catalogDef.category === 'card_failure';

    const hasVerifiableOntData =
      !isOltLevelCategory &&
      (hierarchy.onuId !== undefined || hierarchy.serial !== undefined);

    const isOntScope =
      !isOltLevelCategory &&
      (hasVerifiableOntData ||
        catalogDef.category === 'onu_offline' ||
        catalogDef.category === 'onu_online' ||
        catalogDef.name.toLowerCase().includes('ont') ||
        catalogDef.name.toLowerCase().includes('onu') ||
        catalogDef.name.toLowerCase().includes('gpon'));

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    let deviceId: string;
    if (isOntScope) {
      deviceId =
        hierarchy.serial ??
        `${identity.oltId}:onu:${hierarchy.frame ?? 0}/${hierarchy.slot ?? 0}/${hierarchy.port ?? 0}/${hierarchy.onuId ?? 0}`;
    } else {
      deviceId = identity.oltId;
    }

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: catalogDef.category,
      trapName: catalogDef.name,
      severity: catalogDef.severity,
      vendor: 'DZS/Zhone',
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (hierarchy.frame !== undefined) metrics['frame'] = hierarchy.frame;
    if (hierarchy.slot !== undefined) metrics['slot'] = hierarchy.slot;
    if (hierarchy.port !== undefined) metrics['port'] = hierarchy.port;
    if (hierarchy.onuId !== undefined) metrics['onuId'] = hierarchy.onuId;
    if (hierarchy.serial) metrics['serial'] = hierarchy.serial;

    if (isClear) {
      metrics['isClear'] = true;
      if (clearsCategory) {
        metrics['clearsCategory'] = clearsCategory;
      }
    }

    if (notification.sysUpTime !== undefined) metrics['sysUpTime'] = notification.sysUpTime;
    if (notification.eventTime !== undefined) metrics['eventTime'] = notification.eventTime;

    if (ifMibData.ifIndex !== undefined) metrics['ifIndex'] = ifMibData.ifIndex;
    if (ifMibData.ifOperStatus !== undefined) metrics['ifOperStatus'] = ifMibData.ifOperStatus;
    if (ifMibData.ifName !== undefined) metrics['ifName'] = ifMibData.ifName;

    const tags: Record<string, string> = {
      connectionId: identity.connectionId,
      oltId: identity.oltId,
      vendor: 'DZS',
      trapCategory: catalogDef.category,
      snmpVersion: notification.version,
      pduType: notification.pduType,
    };

    if (catalogDef.catalogStatus) {
      metrics['catalogStatus'] = catalogDef.catalogStatus;
      tags['catalogStatus'] = catalogDef.catalogStatus;
    }

    if (catalogDef.candidateTrapName) {
      metrics['candidateTrapName'] = catalogDef.candidateTrapName;
      if (
        catalogDef.candidateTrapName.toLowerCase().includes('ont') ||
        catalogDef.candidateTrapName.toLowerCase().includes('onu')
      ) {
        metrics['candidateDeviceKind'] = 'ONU';
      }
    }

    if (hierarchy.serial) tags['serial'] = hierarchy.serial;
    if (hierarchy.port !== undefined) tags['port'] = String(hierarchy.port);
    if (hierarchy.slot !== undefined) tags['slot'] = String(hierarchy.slot);
    if (ifMibData.ifName) tags['interface'] = ifMibData.ifName;

    return {
      schema: 'ftth.telemetry.v1',
      tenantId: identity.tenantId,
      deviceKind,
      deviceId,
      source: 'snmp-trap',
      ts: receivedAt.toISOString(),
      metrics,
      tags,
    };
  }

  /**
   * Extract GPON hierarchy from Zhone/DZS trap varbinds.
   * Zhone-GPON-MIB uses index patterns like:
   * - zhoneGponOntIndex: 1.3.6.1.4.1.5504.5.14.1.1.{ontIndex}
   * - zhoneGponSerialNumber: serial number string
   */
  private extractZhoneGponHierarchy(
    notification: DecodedSnmpNotification,
  ): {
    frame?: number;
    slot?: number;
    port?: number;
    onuId?: number;
    serial?: string;
  } {
    const result: {
      frame?: number;
      slot?: number;
      port?: number;
      onuId?: number;
      serial?: string;
    } = {};

    // Look for serial number in varbinds
    for (const vb of notification.varbinds) {
      const oid = vb.oid.toLowerCase();

      // Zhone-GPON-MIB OIDs for serial number
      if (
        oid.includes('5504.5.14') ||
        oid.includes('zhonegpon') ||
        oid.includes('serialnumber')
      ) {
        if (typeof vb.value === 'string' && vb.value.length >= 8) {
          result.serial = vb.value;
        }
      }

      // Try to extract index components from OID
      // Pattern: .1.3.6.1.4.1.5504.5.14.1.1.X.Y.Z.W
      // where X=frame, Y=slot, Z=port, W=ontIndex
      const parts = oid.split('.');
      if (parts.length >= 4) {
        const lastParts = parts.slice(-4);
        const numericParts = lastParts.filter((p) => /^\d+$/.test(p));
        if (numericParts.length >= 3) {
          result.frame = parseInt(numericParts[0], 10);
          result.slot = parseInt(numericParts[1], 10);
          result.port = parseInt(numericParts[2], 10);
          if (numericParts.length >= 4) {
            result.onuId = parseInt(numericParts[3], 10);
          }
        }
      }
    }

    return result;
  }
}
