/**
 * Ubiquiti / UISP OLT Vendor Adapter.
 *
 * Implements OltVendorAdapter for Ubiquiti Inc. (PEN 41112).
 * Supports UFiber OLT and UISP Fiber OLT XGS:
 * - UFiber GPON: 8 PON ports, 128 ONUs/port (1,024 total)
 * - UISP Fiber OLT XGS: 8 PON ports (XGS/XG/GPON), 128 ONUs/port (2,048 total)
 * - Management via UISP and SNMP (UBNT-EdgeMAX-MIB)
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class UbiquitiOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'ubiquiti';
  readonly displayName = 'Ubiquiti';
  readonly supportedPens: readonly number[] = [41112];
  readonly supportedFamilies: readonly string[] = ['UFiber', 'UISP-Fiber-OLT-XGS'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }
    return (
      identity.vendor.toLowerCase() === 'ubiquiti' ||
      identity.vendor.toLowerCase() === 'ui' ||
      this.supportedPens.includes(identity.pen!) ||
      notification.trapOid.startsWith('1.3.6.1.4.1.41112.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract IF-MIB attributes
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    // Extract Ubiquiti GPON hierarchy from varbinds
    const hierarchy = this.extractUbiquitiGponHierarchy(notification, ifMibData);

    // Determine alarm clear pairing
    const isClear = catalogDef.is_clear ?? false;
    let clearsCategory: string | undefined;
    if (catalogDef.clears_trap_oid) {
      const clearedDef = lookupTrapDefinition(catalogDef.clears_trap_oid, {
        allowProvisional: true,
      });
      clearsCategory = clearedDef.category;
    }

    // Determine device scope: ONT vs OLT
    const hasVerifiableOntData =
      hierarchy.onuId !== undefined ||
      hierarchy.serial !== undefined;

    const isOntScope =
      hasVerifiableOntData ||
      catalogDef.category === 'onu_offline' ||
      catalogDef.category === 'onu_online' ||
      catalogDef.name.toLowerCase().includes('ont') ||
      catalogDef.name.toLowerCase().includes('onu');

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    let deviceId: string;
    if (isOntScope) {
      deviceId =
        hierarchy.serial ??
        `${identity.oltId}:onu:${hierarchy.port ?? 0}/${hierarchy.onuId ?? 0}`;
    } else {
      deviceId = identity.oltId;
    }

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: catalogDef.category,
      trapName: catalogDef.name,
      severity: catalogDef.severity,
      vendor: 'Ubiquiti',
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

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
    if (ifMibData.ifIndex !== undefined) metrics['ifIndex'] = ifMibData.ifIndex;
    if (ifMibData.ifOperStatus !== undefined) metrics['ifOperStatus'] = ifMibData.ifOperStatus;
    if (ifMibData.ifName !== undefined) metrics['ifName'] = ifMibData.ifName;

    const tags: Record<string, string> = {
      connectionId: identity.connectionId,
      oltId: identity.oltId,
      vendor: 'Ubiquiti',
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
   * Extract GPON hierarchy from Ubiquiti trap varbinds.
   * Uses IF-MIB index pattern: ifIndex encodes port/onu info.
   */
  private extractUbiquitiGponHierarchy(
    notification: DecodedSnmpNotification,
    ifMibData: { ifIndex?: number },
  ): {
    port?: number;
    onuId?: number;
    serial?: string;
  } {
    const result: {
      port?: number;
      onuId?: number;
      serial?: string;
    } = {};

    // Look for serial number in varbinds
    for (const vb of notification.varbinds) {
      const oid = vb.oid.toLowerCase();

      // Look for serial number in OID or value
      if (
        oid.includes('serial') ||
        oid.includes('onu') ||
        oid.includes('gpon')
      ) {
        if (typeof vb.value === 'string' && vb.value.length >= 8) {
          result.serial = vb.value;
        }
      }
    }

    // Ubiquiti uses IF-MIB ifIndex for PON interfaces
    // Pattern: 1-based interface index for PON ports
    if (ifMibData?.ifIndex !== undefined) {
      // ifIndex 1-8 are typically PON ports on UFiber
      if (ifMibData.ifIndex >= 1 && ifMibData.ifIndex <= 8) {
        result.port = ifMibData.ifIndex;
      }
    }

    return result;
  }
}
