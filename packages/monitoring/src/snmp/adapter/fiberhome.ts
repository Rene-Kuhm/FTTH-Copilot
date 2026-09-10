/**
 * FiberHome OLT Vendor Adapter (Roadmap Fase 4).
 *
 * Implements OltVendorAdapter for FiberHome Telecommunication (PEN 3807).
 * Supports AN5516 and AN6000 series OLTs:
 * - Extracts GPON hierarchy (slot/port/onuId or subrack/slot/port/onuId) and ONT serials (FHTT...)
 * - Normalizes ONT alarms with deviceKind: 'ONU' and deviceId: serial
 * - Normalizes PON port and service card alarms with deviceKind: 'OLT'
 * - Pairs clear traps (fhGponOntOnline, fhGponOntLosClear, fhGponPortUp)
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { extractFiberhomeGponHierarchy } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class FiberhomeOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'fiberhome';
  readonly displayName = 'FiberHome';
  readonly supportedPens: readonly number[] = [3807];
  readonly supportedFamilies: readonly string[] = ['AN5516', 'AN6000'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }
    const vendorLower = identity.vendor.toLowerCase();
    return (
      vendorLower === 'fiberhome' ||
      identity.pen === 3807 ||
      notification.trapOid.startsWith('1.3.6.1.4.1.3807.')
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
    const hierarchy = extractFiberhomeGponHierarchy(notification, catalogDef.oid);

    // Extract any IF-MIB standard attributes
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    // Determine alarm clear pairing
    const isClear = catalogDef.is_clear ?? false;
    let clearsCategory: string | undefined;
    if (catalogDef.clears_trap_oid) {
      const clearedDef = lookupTrapDefinition(catalogDef.clears_trap_oid);
      clearsCategory = clearedDef.category;
    } else if (catalogDef.name === 'fhGponOntOnline') {
      clearsCategory = 'onu_offline';
    } else if (catalogDef.name === 'fhGponOntLosClear') {
      clearsCategory = 'los';
    } else if (catalogDef.name === 'fhGponPortUp') {
      clearsCategory = 'pon_down';
    }

    // Determine device scope: ONT vs OLT
    const isOntScope =
      hierarchy.onuId !== undefined ||
      hierarchy.serial !== undefined ||
      catalogDef.category === 'onu_offline' ||
      catalogDef.category === 'onu_online' ||
      catalogDef.category === 'los_clear' ||
      catalogDef.name.toLowerCase().includes('ont');

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    let deviceId: string;
    if (isOntScope) {
      deviceId =
        hierarchy.serial ??
        `${identity.oltId}:onu:${hierarchy.shelf ?? 1}/${hierarchy.slot ?? 1}/${hierarchy.port ?? 1}/${hierarchy.onuId ?? 1}`;
    } else {
      deviceId = identity.oltId;
    }

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: catalogDef.category,
      trapName: catalogDef.name,
      severity: catalogDef.severity,
      vendor: 'FiberHome',
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (hierarchy.shelf !== undefined) metrics['subrack'] = hierarchy.shelf;
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
      vendor: 'FiberHome',
      trapCategory: catalogDef.category,
      snmpVersion: notification.version,
      pduType: notification.pduType,
    };

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
}
