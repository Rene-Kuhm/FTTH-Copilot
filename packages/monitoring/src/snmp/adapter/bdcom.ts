/**
 * BDCOM (Shanghai Baud Data Communication) OLT Vendor Adapter (Roadmap Fase 6).
 *
 * Implements OltVendorAdapter for BDCOM (authoritative PEN 3320):
 * - Supports P3600 GPON family via NMS-GPON-MIB.
 * - Extracts hierarchy (slot/port/onuId) and serial from varbinds and OID suffixes.
 * - Normalizes ONT alarms with deviceKind: 'ONU' and deviceId: serial.
 * - Normalizes PON port alarms with deviceKind: 'OLT'.
 * - Pairs recovery traps (nmsGponOntOnline, nmsGponPonUp).
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { extractBdcomHierarchy } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class BdcomOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'bdcom';
  readonly displayName = 'BDCOM';
  readonly supportedPens: readonly number[] = [3320];
  readonly supportedFamilies: readonly string[] = ['P3600', 'P3310'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }
    const vendorLower = identity.vendor.toLowerCase();
    return (
      vendorLower === 'bdcom' ||
      vendorLower === 'baud data' ||
      identity.pen === 3320 ||
      notification.trapOid.startsWith('1.3.6.1.4.1.3320.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract BDCOM hierarchy and serial from varbinds
    const bdcomHierarchy = extractBdcomHierarchy(notification);

    // Extract any IF-MIB standard attributes
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    const category = catalogDef.category;
    let severity = catalogDef.severity;
    if (category === 'los' || category === 'dying_gasp' || category === 'pon_down') {
      severity = 'critical';
    } else if (category === 'onu_offline') {
      severity = 'warning';
    } else if (category === 'onu_online' || category === 'pon_up') {
      severity = 'info';
    }

    // Determine alarm clear pairing
    const isClear = catalogDef.is_clear ?? false;
    let clearsCategory: string | undefined;
    if (catalogDef.clears_trap_oid) {
      const clearedDef = lookupTrapDefinition(catalogDef.clears_trap_oid);
      clearsCategory = clearedDef.category;
    }

    // Determine device scope: ONT vs OLT
    const isOntScope =
      bdcomHierarchy.onuId !== undefined ||
      bdcomHierarchy.serial !== undefined ||
      category === 'los' ||
      category === 'dying_gasp' ||
      category === 'onu_offline' ||
      category === 'onu_online';

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    let deviceId: string;
    if (isOntScope) {
      deviceId =
        bdcomHierarchy.serial ??
        `${identity.oltId}:onu:${bdcomHierarchy.slot ?? 1}/${bdcomHierarchy.port ?? 1}/${bdcomHierarchy.onuId ?? 1}`;
    } else {
      deviceId = identity.oltId;
    }

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: category,
      trapName: catalogDef.name,
      severity,
      vendor: 'BDCOM',
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (bdcomHierarchy.slot !== undefined) metrics.slot = bdcomHierarchy.slot;
    if (bdcomHierarchy.port !== undefined) metrics.port = bdcomHierarchy.port;
    if (bdcomHierarchy.onuId !== undefined) metrics.onuId = bdcomHierarchy.onuId;
    if (bdcomHierarchy.serial !== undefined) metrics.serial = bdcomHierarchy.serial;

    if (isClear) {
      metrics.isClear = true;
      if (clearsCategory) {
        metrics.clearsCategory = clearsCategory;
      }
    }

    if (ifMibData.ifIndex !== undefined) metrics.ifIndex = ifMibData.ifIndex;
    if (ifMibData.ifDescr !== undefined) metrics.ifDescr = ifMibData.ifDescr;

    const tags: Record<string, string> = {
      adapter: 'bdcom',
      vendor: 'BDCOM',
      trapCategory: category,
      severity,
    };
    if (bdcomHierarchy.serial) tags['serial'] = bdcomHierarchy.serial;
    if (bdcomHierarchy.onuId !== undefined) tags['onuId'] = String(bdcomHierarchy.onuId);
    if (bdcomHierarchy.port !== undefined) tags['port'] = String(bdcomHierarchy.port);
    if (bdcomHierarchy.slot !== undefined) tags['slot'] = String(bdcomHierarchy.slot);
    if (ifMibData.ifName) tags['interface'] = ifMibData.ifName;

    return {
      schema: 'ftth.telemetry.v1',
      tenantId: identity.tenantId,
      deviceKind,
      deviceId,
      source: 'snmp-trap',
      ts: receivedAt.toISOString(),
      metrics,
      tags: {
        ...tags,
        tenantId: identity.tenantId,
        connectionId: identity.connectionId,
        oltId: identity.oltId,
      },
    };
  }
}
