/**
 * ADTRAN Total Access 5000 OLT Vendor Adapter (Roadmap Fase 5).
 *
 * Implements OltVendorAdapter for Adtran (PEN 664).
 * Supports ADTRAN Total Access 5000 (TA5000) running AOS and ADTRAN-GENGPON-MIB:
 * - Strictly separates TA5000 from SDX-6000 / Mosaic architectures per Gate 5.
 * - Extracts optical hierarchy (slot/port/onuId), ifDescr, and serials (ADTN...) from varbinds and OID indexes.
 * - Normalizes ONT alarms with deviceKind: 'ONU' and deviceId: serial.
 * - Normalizes PON port alarms with deviceKind: 'OLT'.
 * - Pairs clear traps (adGenGponOntOnline, adGenGponOntLosClear, adGenGponPonUp).
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { extractAdtranHierarchy } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class AdtranOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'adtran';
  readonly displayName = 'Adtran';
  readonly supportedPens: readonly number[] = [664];
  readonly supportedFamilies: readonly string[] = ['TA5000'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }

    // Explicitly reject SDX-6000 / Mosaic architectures to prevent invalid MIB assumptions (Gate 5)
    const modelLower = (identity.model ?? identity.hardwareModel ?? '').toLowerCase();
    if (modelLower.includes('sdx') || modelLower.includes('mosaic')) {
      return false;
    }

    const vendorLower = identity.vendor.toLowerCase();
    return (
      vendorLower === 'adtran' ||
      identity.pen === 664 ||
      notification.trapOid.startsWith('1.3.6.1.4.1.664.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract optical hierarchy and serial
    const hierarchy = extractAdtranHierarchy(notification, catalogDef.oid);

    // Extract any IF-MIB standard attributes
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    // Determine alarm clear pairing
    const isClear = catalogDef.is_clear ?? false;
    let clearsCategory: string | undefined;
    if (catalogDef.clears_trap_oid) {
      const clearedDef = lookupTrapDefinition(catalogDef.clears_trap_oid);
      clearsCategory = clearedDef.category;
    } else if (catalogDef.name === 'adGenGponOntOnline') {
      clearsCategory = 'onu_offline';
    } else if (catalogDef.name === 'adGenGponOntLosClear') {
      clearsCategory = 'los';
    } else if (catalogDef.name === 'adGenGponPonUp') {
      clearsCategory = 'pon_down';
    }

    // Determine device scope: ONT vs OLT
    const isOntScope =
      hierarchy.onuId !== undefined ||
      hierarchy.serial !== undefined ||
      catalogDef.category === 'los' ||
      catalogDef.category === 'dying_gasp' ||
      catalogDef.category === 'onu_offline' ||
      catalogDef.category === 'onu_online' ||
      catalogDef.category === 'los_clear' ||
      catalogDef.name.toLowerCase().includes('ont');

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    let deviceId: string;
    if (isOntScope) {
      deviceId =
        hierarchy.serial ??
        `${identity.oltId}:onu:${hierarchy.slot ?? 1}/${hierarchy.port ?? 1}/${hierarchy.onuId ?? 1}`;
    } else {
      deviceId = identity.oltId;
    }

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: catalogDef.category,
      trapName: catalogDef.name,
      severity: catalogDef.severity,
      vendor: 'Adtran',
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (hierarchy.slot !== undefined) metrics.slot = hierarchy.slot;
    if (hierarchy.port !== undefined) metrics.port = hierarchy.port;
    if (hierarchy.onuId !== undefined) metrics.onuId = hierarchy.onuId;
    if (hierarchy.serial !== undefined) metrics.serial = hierarchy.serial;

    if (isClear) {
      metrics.isClear = true;
      if (clearsCategory) {
        metrics.clearsCategory = clearsCategory;
      }
    }

    if (ifMibData.ifIndex !== undefined) metrics.ifIndex = ifMibData.ifIndex;
    if (ifMibData.ifDescr !== undefined) metrics.ifDescr = ifMibData.ifDescr;

    const tags: Record<string, string> = {
      adapter: 'adtran',
      vendor: 'Adtran',
      trapCategory: catalogDef.category,
      severity: catalogDef.severity,
    };
    if (hierarchy.serial) tags['serial'] = hierarchy.serial;
    if (hierarchy.onuId !== undefined) tags['onuId'] = String(hierarchy.onuId);
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
