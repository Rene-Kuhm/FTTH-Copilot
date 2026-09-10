/**
 * VSOL (Guangzhou V-Solution) OLT Vendor Adapter (Roadmap Fase 6).
 *
 * Implements OltVendorAdapter for VSOL (authoritative PEN 37950):
 * - Supports V1600 GPON family.
 * - Extracts hierarchy (slot/port/onuId) and serial from varbinds and OID suffixes.
 * - Normalizes ONT alarms with deviceKind: 'ONU' and deviceId: serial.
 * - Normalizes PON port alarms with deviceKind: 'OLT'.
 * - Pairs recovery traps (vsolGponOntOnline, vsolGponPortUp).
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { extractVsolHierarchy } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class VsolOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'vsol';
  readonly displayName = 'VSOL';
  readonly supportedPens: readonly number[] = [37950];
  readonly supportedFamilies: readonly string[] = ['V1600', 'V3600'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }
    const vendorLower = identity.vendor.toLowerCase();
    return (
      vendorLower === 'vsol' ||
      vendorLower === 'v-solution' ||
      identity.pen === 37950 ||
      notification.trapOid.startsWith('1.3.6.1.4.1.37950.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract VSOL hierarchy and serial from varbinds
    const vsolHierarchy = extractVsolHierarchy(notification);

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
      vsolHierarchy.onuId !== undefined ||
      vsolHierarchy.serial !== undefined ||
      category === 'los' ||
      category === 'dying_gasp' ||
      category === 'onu_offline' ||
      category === 'onu_online';

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    let deviceId: string;
    if (isOntScope) {
      deviceId =
        vsolHierarchy.serial ??
        `${identity.oltId}:onu:${vsolHierarchy.slot ?? 1}/${vsolHierarchy.port ?? 1}/${vsolHierarchy.onuId ?? 1}`;
    } else {
      deviceId = identity.oltId;
    }

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: category,
      trapName: catalogDef.name,
      severity,
      vendor: 'VSOL',
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (vsolHierarchy.slot !== undefined) metrics.slot = vsolHierarchy.slot;
    if (vsolHierarchy.port !== undefined) metrics.port = vsolHierarchy.port;
    if (vsolHierarchy.onuId !== undefined) metrics.onuId = vsolHierarchy.onuId;
    if (vsolHierarchy.serial !== undefined) metrics.serial = vsolHierarchy.serial;

    if (isClear) {
      metrics.isClear = true;
      if (clearsCategory) {
        metrics.clearsCategory = clearsCategory;
      }
    }

    if (ifMibData.ifIndex !== undefined) metrics.ifIndex = ifMibData.ifIndex;
    if (ifMibData.ifDescr !== undefined) metrics.ifDescr = ifMibData.ifDescr;

    const tags: Record<string, string> = {
      adapter: 'vsol',
      vendor: 'VSOL',
      trapCategory: category,
      severity,
    };
    if (vsolHierarchy.serial) tags['serial'] = vsolHierarchy.serial;
    if (vsolHierarchy.onuId !== undefined) tags['onuId'] = String(vsolHierarchy.onuId);
    if (vsolHierarchy.port !== undefined) tags['port'] = String(vsolHierarchy.port);
    if (vsolHierarchy.slot !== undefined) tags['slot'] = String(vsolHierarchy.slot);
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
