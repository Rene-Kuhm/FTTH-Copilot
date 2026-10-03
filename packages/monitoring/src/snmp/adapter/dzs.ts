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
import { decodeVendorSerialNumber } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

/** Zhone-GPON-MIB ONT index column, without the instance suffix. */
const DZS_GPON_ONT_INDEX_PREFIX = '1.3.6.1.4.1.5504.5.14.1.1';

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
   *
   * Zhone-GPON-MIB documents the ONT index at
   * `1.3.6.1.4.1.5504.5.14.1.1.{ontIndex}`. The index component layout is not
   * published, so frame/slot/port are only reported when the trailing OID
   * segments are unambiguous — a single number is treated as the ONT id alone
   * rather than being spread across invented frame/slot/port fields.
   *
   * Serial extraction goes through `decodeVendorSerialNumber`, which enforces
   * the standard 4-character vendor prefix convention and rejects known
   * non-serial prefixes. Matching on the bare `5504.5.14` subtree is not
   * sufficient: that subtree also carries ODN identifiers such as
   * `CTO-NORTE-12` and `NAP-CENTRO-01`, which are not ONT serials.
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

    // First valid serial wins; later varbinds must not overwrite it.
    for (const vb of notification.varbinds) {
      if (result.serial) break;
      const decoded = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (decoded) result.serial = decoded;
    }

    // Zhone-GPON-MIB ONT index: 1.3.6.1.4.1.5504.5.14.1.1.{ontIndex}
    const indexMatch = notification.varbinds
      .map((vb) => vb.oid.trim())
      .find((oid) => oid.startsWith(`${DZS_GPON_ONT_INDEX_PREFIX}.`));
    if (indexMatch) {
      const suffix = indexMatch.slice(DZS_GPON_ONT_INDEX_PREFIX.length + 1);
      const parts = suffix
        .split('.')
        .map((p) => parseInt(p, 10))
        .filter((n) => !Number.isNaN(n) && n >= 0);
      if (parts.length >= 4) {
        const [frame, slot, port, onuId] = parts.slice(-4);
        result.frame = frame;
        result.slot = slot;
        result.port = port;
        result.onuId = onuId;
      } else if (parts.length === 1) {
        result.onuId = parts[0];
      }
    }

    return result;
  }
}
