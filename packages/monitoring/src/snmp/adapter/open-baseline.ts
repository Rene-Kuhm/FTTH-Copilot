/**
 * Open Baseline OLT Adapter (Roadmap Fase 6 — baseline coverage).
 *
 * Provides a vendor-neutral interpretation profile for OLT platforms whose
 * alarm MIBs are **not publicly documented**. Without this adapter these
 * devices fall through to `StandardOltAdapter`, which always reports
 * `deviceKind: 'OLT'` and therefore mislabels every ONT-scoped event.
 *
 * What this adapter does:
 * - Classifies OLT vs ONU scope from the catalog category (excluding
 *   OLT-level categories such as pon_down/pon_up/card_failure).
 * - Extracts IF-MIB interface context (ifIndex, ifName, ifOperStatus,
 *   ifAlias) which every conformant SNMP agent exposes.
 * - Detects ONT serials via `decodeVendorSerialNumber`.
 * - Attaches a catalog definition when the OID is registered, and otherwise
 *   degrades honestly to the catalog's `unknown_trap` fallback.
 *
 * What this adapter deliberately does NOT do:
 * - Invent vendor-specific hierarchy (frame/slot/port). Without a public
 *   MIB we cannot know how a vendor encodes its OLT/ONU indices, so any
 *   such value would be fabricated.
 * - Claim severity or category that the catalog does not record.
 *
 * Every event carries `metrics.coverage = 'baseline'` so downstream
 * consumers can distinguish a standards-derived interpretation from a
 * vendor-MIB-derived one and weight them accordingly.
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import { extractIfMibVarbinds } from '../extractors/if-mib';
import { decodeVendorSerialNumber } from '../extractors/vendor-helpers';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';
import type { OltVendorAdapter } from './contract';

/**
 * Platforms covered by this baseline profile, keyed by IANA PEN.
 *
 * These vendors are registered in `research/olt/` with verified hardware
 * documentation but publish no public alarm MIB, so their notification
 * OIDs remain provisional. Add a vendor-specific adapter instead of
 * extending this list as soon as a real MIB becomes available.
 */
const BASELINE_PENS: ReadonlyMap<number, string> = new Map([
  [9, 'Cisco'],
  [890, 'Zyxel'],
  [1931, 'Ericsson'],
  [34592, 'C-Data'],
  [34595, 'Raisecom'],
  [40418, 'Edgecore'],
]);

const BASELINE_VENDORS: ReadonlySet<string> = new Set(
  ['cisco', 'zyxel', 'ericsson', 'c-data', 'cdata', 'raisecom', 'edgecore', 'accton'].map((v) =>
    v.toLowerCase(),
  ),
);

/** Categories that always describe the OLT itself, never a downstream ONT. */
const OLT_SCOPE_CATEGORIES: ReadonlySet<string> = new Set([
  'pon_down',
  'pon_up',
  'card_failure',
  'restart',
  'config_change',
  'auth_failure',
]);

export class OpenBaselineOltAdapter implements OltVendorAdapter {
  readonly vendorId = 'open_baseline';
  readonly displayName = 'Open Baseline OLT';
  readonly supportedPens: readonly number[] = [...BASELINE_PENS.keys()];
  readonly supportedFamilies: readonly string[] = [
    'OLT2404',
    'OLT2406',
    'IES4204',
    'FD1104SN',
    'FD1604S',
    'FD1604E-C1',
    'FD1801S-C1',
    'FD1700S',
    'FD6700S',
    'ISCOM5508-GP',
    'ISCOM6820-GP',
    'ISCOM6860',
    'ISCOM6800',
    'EDA-1500',
    'ASXvOLT16',
    'ASGvOLT64',
    'NCS-1001',
    'NCS-1010',
    'NCS-1020',
  ];

  supports(
    _notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
  ): boolean {
    if (identity.isAmbiguous) return false;
    if (BASELINE_VENDORS.has(identity.vendor.trim().toLowerCase())) return true;
    return identity.pen !== undefined && BASELINE_PENS.has(identity.pen);
  }

  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent {
    const catalogDef = lookupTrapDefinition(notification.trapOid);
    const receivedAt = new Date(notification.receivedAtMs);

    const ifMibData = extractIfMibVarbinds(notification.varbinds);

    // Serial detection is best-effort: a match raises ONU scope, but its
    // absence must not demote a categorically ONU-scoped trap.
    let ontSerial: string | undefined;
    for (const vb of notification.varbinds) {
      const decoded = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (decoded) {
        ontSerial = decoded;
        break;
      }
    }

    const isOltScope = OLT_SCOPE_CATEGORIES.has(catalogDef.category);
    const isOntScope =
      !isOltScope &&
      (ontSerial !== undefined ||
        catalogDef.category === 'los' ||
        catalogDef.category === 'dying_gasp' ||
        catalogDef.category === 'onu_offline' ||
        catalogDef.category === 'onu_online');

    const deviceKind: 'OLT' | 'ONU' = isOntScope ? 'ONU' : 'OLT';
    const deviceId = isOntScope ? (ontSerial ?? `${identity.oltId}:onu:unknown`) : identity.oltId;

    const metrics: Record<string, unknown> = {
      snmpTrapOid: catalogDef.oid,
      trapCategory: catalogDef.category,
      trapName: catalogDef.name,
      severity: catalogDef.severity,
      vendor: identity.vendor || (identity.pen ? BASELINE_PENS.get(identity.pen) : 'Unknown'),
      description: catalogDef.description,
      fingerprint: rawEvidence.fingerprint,
      // Distinguishes a standards-derived reading from a vendor-MIB reading.
      coverage: 'baseline',
      interpretation: 'standards-only',
    };

    if (ontSerial) metrics.serial = ontSerial;
    if (catalogDef.is_clear) metrics.isClear = true;
    if (ifMibData.ifIndex !== undefined) metrics.ifIndex = ifMibData.ifIndex;
    if (ifMibData.ifName !== undefined) metrics.ifName = ifMibData.ifName;
    if (ifMibData.ifDescr !== undefined) metrics.ifDescr = ifMibData.ifDescr;
    if (ifMibData.ifAlias !== undefined) metrics.ifAlias = ifMibData.ifAlias;
    if (ifMibData.ifOperStatus !== undefined) metrics.ifOperStatus = ifMibData.ifOperStatus;
    if (notification.sysUpTime !== undefined) metrics.sysUpTime = notification.sysUpTime;
    if (notification.eventTime !== undefined) metrics.eventTime = notification.eventTime;

    const tags: Record<string, string> = {
      connectionId: identity.connectionId,
      oltId: identity.oltId,
      vendor: identity.vendor || (identity.pen ? BASELINE_PENS.get(identity.pen) ?? 'Unknown' : 'Unknown'),
      trapCategory: catalogDef.category,
      snmpVersion: notification.version,
      pduType: notification.pduType,
      coverage: 'baseline',
    };

    if (ontSerial) tags.serial = ontSerial;
    if (ifMibData.ifName) tags.interface = ifMibData.ifName;
    if (ifMibData.ifOperStatus) tags.operStatus = ifMibData.ifOperStatus;

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
