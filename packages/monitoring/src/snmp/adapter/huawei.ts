/**
 * Huawei OLT Vendor Adapter (Roadmap Fase 3).
 *
 * Implements OltVendorAdapter for Huawei Technologies (PEN 2011).
 * Supports MA5600 and MA5800 series OLTs:
 * - Extracts GPON hierarchy (frame/slot/port/onuId) and ONT serials (HWTC...)
 * - Normalizes ONT alarms with deviceKind: 'ONU' and deviceId: serial
 * - Normalizes PON port alarms with deviceKind: 'OLT'
 * - Pairs clear traps (hwGponOntOnline, hwGponOntLosClear, hwGponPortUp)
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { extractHuaweiGponHierarchy } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class HuaweiOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'huawei';
  readonly displayName = 'Huawei';
  readonly supportedPens: readonly number[] = [2011];
  readonly supportedFamilies: readonly string[] = ['MA5600', 'MA5800'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }
    return (
      identity.vendor.toLowerCase() === 'huawei' ||
      identity.pen === 2011 ||
      notification.trapOid.startsWith('1.3.6.1.4.1.2011.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract GPON hierarchy and serial
    const hierarchy = extractHuaweiGponHierarchy(notification, catalogDef.oid);

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
    } else if (catalogDef.name === 'hwGponOntOnline') {
      clearsCategory = 'onu_offline';
    } else if (catalogDef.name === 'hwGponOntLosClear') {
      clearsCategory = 'los';
    } else if (catalogDef.name === 'hwGponPortUp') {
      clearsCategory = 'pon_down';
    }

    // Determine device scope: ONT vs OLT
    const isOntScope =
      hierarchy.onuId !== undefined ||
      hierarchy.serial !== undefined ||
      catalogDef.category === 'onu_offline' ||
      catalogDef.category === 'onu_online' ||
      catalogDef.name.toLowerCase().includes('ont');

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
      vendor: 'Huawei',
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
    if (ifMibData.ifAdminStatus !== undefined) metrics['ifAdminStatus'] = ifMibData.ifAdminStatus;
    if (ifMibData.ifOperStatus !== undefined) metrics['ifOperStatus'] = ifMibData.ifOperStatus;
    if (ifMibData.ifDescr !== undefined) metrics['ifDescr'] = ifMibData.ifDescr;
    if (ifMibData.ifName !== undefined) metrics['ifName'] = ifMibData.ifName;
    if (ifMibData.ifAlias !== undefined) metrics['ifAlias'] = ifMibData.ifAlias;

    const tags: Record<string, string> = {
      connectionId: identity.connectionId,
      oltId: identity.oltId,
      vendor: 'Huawei',
      trapCategory: catalogDef.category,
      snmpVersion: notification.version,
      pduType: notification.pduType,
    };

    if (catalogDef.catalogStatus) {
      metrics['catalogStatus'] = catalogDef.catalogStatus;
      tags['catalogStatus'] = catalogDef.catalogStatus;
    }

    if (hierarchy.serial) tags['serial'] = hierarchy.serial;
    if (hierarchy.port !== undefined) tags['port'] = String(hierarchy.port);
    if (hierarchy.slot !== undefined) tags['slot'] = String(hierarchy.slot);
    if (hierarchy.frame !== undefined) tags['frame'] = String(hierarchy.frame);
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
}
