/**
 * Generic xPON Fallback OLT Adapter (Roadmap Fase 6).
 *
 * Provides a safe baseline profile for unknown or white-label xPON OLTs:
 * - Preserves raw trap details without pretending false vendor compatibility.
 * - Extracts standard IF-MIB metrics (ifIndex, ifDescr, ifName).
 * - Scans varbinds for valid GPON serial numbers using decodeVendorSerialNumber.
 * - Normalizes to canonical TelemetryEvent ('ftth.telemetry.v1').
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { decodeVendorSerialNumber } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class GenericXponAdapter implements OltVendorAdapter {
  readonly vendorId = 'generic_xpon';
  readonly displayName = 'Generic xPON';
  readonly supportedPens: readonly number[] = [];
  readonly supportedFamilies: readonly string[] = ['generic_xpon'];

  supports(_notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    const vendorLower = identity.vendor.toLowerCase();
    return vendorLower === 'generic_xpon' || vendorLower === 'generic' || vendorLower === 'xpon';
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract standard IF-MIB attributes
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    // Check if any varbind holds an ONT serial number
    let ontSerial: string | undefined;
    for (const vb of notification.varbinds) {
      const decoded = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (decoded) {
        ontSerial = decoded;
        break;
      }
    }

    const category = catalogDef.category;
    const severity = catalogDef.severity;
    const isClear = catalogDef.is_clear ?? false;

    // Scope to ONU if serial is detected or category is ONT-specific
    const isOntScope =
      ontSerial !== undefined ||
      category === 'los' ||
      category === 'dying_gasp' ||
      category === 'onu_offline' ||
      category === 'onu_online';

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    const deviceId = isOntScope ? (ontSerial ?? `${identity.oltId}:onu:unknown`) : identity.oltId;

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: category,
      trapName: catalogDef.name,
      severity,
      vendor: identity.vendor || 'Generic',
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (ontSerial) metrics.serial = ontSerial;
    if (isClear) metrics.isClear = true;
    if (ifMibData.ifIndex !== undefined) metrics.ifIndex = ifMibData.ifIndex;
    if (ifMibData.ifDescr !== undefined) metrics.ifDescr = ifMibData.ifDescr;

    const tags: Record<string, string> = {
      adapter: 'generic_xpon',
      vendor: identity.vendor || 'Generic',
      trapCategory: category,
      severity,
    };
    if (ontSerial) tags['serial'] = ontSerial;
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
