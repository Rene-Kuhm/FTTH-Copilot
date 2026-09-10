/**
 * Calix Networks OLT Vendor Adapter (Roadmap Fase 5).
 *
 * Implements OltVendorAdapter for Calix (authoritative PEN 6321, legacy alias 1264).
 * Supports Calix E7 family (E7-2, E7-20) using E7-Calix-MIB and E7-Notifications-MIB:
 * - Strictly separates E7 from E9/AXOS architectures per Gate 5.
 * - Extracts optical hierarchy (shelf/slot/port/onuId), CLI object, and serials (CXNK...) from varbinds.
 * - Normalizes ONT alarms with deviceKind: 'ONU' and deviceId: serial.
 * - Normalizes PON port and chassis alarms with deviceKind: 'OLT'.
 * - Pairs clear traps (e7TrapAlarmClear, online/clear event texts).
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { extractCalixHierarchy } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

export class CalixOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'calix';
  readonly displayName = 'Calix';
  readonly supportedPens: readonly number[] = [6321, 1264];
  readonly supportedFamilies: readonly string[] = ['E7'];

  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean {
    if (identity.isAmbiguous) {
      return false;
    }

    // Explicitly reject E9 / AXOS architectures to prevent invalid MIB assumptions (Gate 5)
    const modelLower = (identity.model ?? identity.hardwareModel ?? '').toLowerCase();
    if (modelLower.includes('e9') || modelLower.includes('axos')) {
      return false;
    }

    const vendorLower = identity.vendor.toLowerCase();
    return (
      vendorLower === 'calix' ||
      identity.pen === 6321 ||
      identity.pen === 1264 ||
      notification.trapOid.startsWith('1.3.6.1.4.1.6321.')
    );
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    // Extract Calix hierarchy, event text, and serial from varbinds
    const calixEvent = extractCalixHierarchy(notification);

    // Extract any IF-MIB standard attributes
    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    // Determine semantic category and severity (refined by e7TrapText when available)
    const category = calixEvent.derivedCategory ?? catalogDef.category;
    let severity = catalogDef.severity;
    if (category === 'los' || category === 'dying_gasp' || category === 'pon_down' || category === 'card_failure') {
      severity = 'critical';
    } else if (category === 'onu_offline' || category === 'auth_failure') {
      severity = 'warning';
    } else if (category === 'onu_online' || category === 'pon_up' || category === 'los_clear' || category === 'config_change') {
      severity = 'info';
    }

    // Determine alarm clear pairing
    const isClear = calixEvent.isClear || (catalogDef.is_clear ?? false);
    let clearsCategory: string | undefined;
    if (catalogDef.clears_trap_oid) {
      const clearedDef = lookupTrapDefinition(catalogDef.clears_trap_oid);
      clearsCategory = clearedDef.category;
    } else if (category === 'los_clear') {
      clearsCategory = 'los';
    } else if (category === 'onu_online') {
      clearsCategory = 'onu_offline';
    } else if (category === 'pon_up') {
      clearsCategory = 'pon_down';
    }

    // Determine device scope: ONT vs OLT
    const isOntScope =
      calixEvent.onuId !== undefined ||
      calixEvent.serial !== undefined ||
      calixEvent.cliObject?.toLowerCase().startsWith('ont') === true ||
      category === 'los' ||
      category === 'dying_gasp' ||
      category === 'onu_offline' ||
      category === 'onu_online' ||
      category === 'los_clear';

    const deviceKind = isOntScope ? 'ONU' : 'OLT';
    let deviceId: string;
    if (isOntScope) {
      deviceId =
        calixEvent.serial ??
        `${identity.oltId}:onu:${calixEvent.shelf ?? 1}/${calixEvent.slot ?? 1}/${calixEvent.port ?? 1}/${calixEvent.onuId ?? 1}`;
    } else {
      deviceId = identity.oltId;
    }

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: category,
      trapName: catalogDef.name,
      severity,
      vendor: 'Calix',
      description: calixEvent.eventText ?? catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
    };

    if (calixEvent.shelf !== undefined) metrics.shelf = calixEvent.shelf;
    if (calixEvent.slot !== undefined) metrics.slot = calixEvent.slot;
    if (calixEvent.port !== undefined) metrics.port = calixEvent.port;
    if (calixEvent.onuId !== undefined) metrics.onuId = calixEvent.onuId;
    if (calixEvent.serial !== undefined) metrics.serial = calixEvent.serial;
    if (calixEvent.cliObject !== undefined) metrics.cliObject = calixEvent.cliObject;
    if (calixEvent.eventText !== undefined) metrics.eventText = calixEvent.eventText;

    if (isClear) {
      metrics.isClear = true;
      if (clearsCategory) {
        metrics.clearsCategory = clearsCategory;
      }
    }

    if (ifMibData.ifIndex !== undefined) metrics.ifIndex = ifMibData.ifIndex;
    if (ifMibData.ifDescr !== undefined) metrics.ifDescr = ifMibData.ifDescr;

    const tags: Record<string, string> = {
      adapter: 'calix',
      vendor: 'Calix',
      trapCategory: category,
      severity,
    };
    if (calixEvent.serial) tags['serial'] = calixEvent.serial;
    if (calixEvent.onuId !== undefined) tags['onuId'] = String(calixEvent.onuId);
    if (calixEvent.port !== undefined) tags['port'] = String(calixEvent.port);
    if (calixEvent.slot !== undefined) tags['slot'] = String(calixEvent.slot);
    if (calixEvent.shelf !== undefined) tags['shelf'] = String(calixEvent.shelf);
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
