/**
 * Multi-Source Device Identity and Vendor Ambiguity Resolution.
 * (Roadmap Fase 2 — Gate 2).
 *
 * Correlates:
 * 1. Registered sender context (tenantId, connectionId, oltId, declared vendor)
 * 2. Enterprise Trap OID root via authoritative IANA PEN registry
 * 3. sysObjectID (from sender context or varbinds)
 *
 * Strictly rejects ambiguity when conflicting vendor identities are claimed.
 */

import { extractEnterprisePen, resolveVendorByOid } from './iana-pen';
import type { SnmpSenderContext } from './mapping';
import type { DecodedSnmpNotification } from './types';

export interface ResolvedDeviceIdentity {
  tenantId: string;
  connectionId: string;
  oltId: string;
  vendor: string;
  model?: string;
  hardwareModel?: string;
  pen?: number;
  sysObjectID?: string;
  isStandardTrap: boolean;
  isAmbiguous: boolean;
  ambiguityReason?: string;
}

const OID_SYS_OBJECT_ID = '1.3.6.1.2.1.1.2';

/**
 * Resolves the device and vendor identity for an SNMP notification.
 */
export function resolveDeviceIdentity(
  notification: Pick<DecodedSnmpNotification, 'trapOid' | 'varbinds'>,
  senderContext: SnmpSenderContext,
  declaredSysObjectId?: string,
): ResolvedDeviceIdentity {
  // Always lock tenantId, connectionId, and oltId to the managed sender context
  const { tenantId, connectionId, oltId, model, hardwareModel } = senderContext;

  // 1. Look for sysObjectID in varbinds or declared
  let sysObjectId = declaredSysObjectId;
  if (!sysObjectId && notification.varbinds) {
    for (const vb of notification.varbinds) {
      if (vb.oid === OID_SYS_OBJECT_ID || vb.oid.startsWith(`${OID_SYS_OBJECT_ID}.`)) {
        if (typeof vb.value === 'string') {
          sysObjectId = vb.value.trim();
          break;
        }
      }
    }
  }

  // 2. Resolve vendor from trap OID (Enterprise PEN)
  const trapVendorResolution = resolveVendorByOid(notification.trapOid);
  const trapPen = extractEnterprisePen(notification.trapOid) ?? undefined;
  const isStandardTrap = trapVendorResolution === null;

  // 3. Resolve vendor from sysObjectID if present
  const sysObjVendorResolution = sysObjectId ? resolveVendorByOid(sysObjectId) : null;
  const sysObjPen = sysObjectId ? (extractEnterprisePen(sysObjectId) ?? undefined) : undefined;

  // 4. Evaluate registered vendor
  const registeredVendor = senderContext.vendor?.trim();

  // Helper to match declared vendor against record
  const vendorMatches = (declared: string, record: { vendorId: string; displayName: string }) =>
    declared.toLowerCase() === record.vendorId.toLowerCase() ||
    declared.toLowerCase() === record.displayName.toLowerCase();

  // 5. Check for ambiguities and conflicts
  // Case A: Sender context claims Vendor X, but trap OID belongs to distinct Vendor Y's PEN
  if (
    registeredVendor &&
    trapVendorResolution &&
    !vendorMatches(registeredVendor, trapVendorResolution)
  ) {
    return {
      tenantId,
      connectionId,
      oltId,
      vendor: 'Standard',
      model,
      hardwareModel,
      isStandardTrap,
      isAmbiguous: true,
      ambiguityReason: `Vendor mismatch: sender registered as '${registeredVendor}', but trap OID '${notification.trapOid}' belongs to '${trapVendorResolution.displayName}' (PEN ${trapPen ?? 'unknown'})`,
    };
  }

  // Case B: sysObjectID vendor conflicts with trap OID vendor
  if (
    sysObjVendorResolution &&
    trapVendorResolution &&
    sysObjVendorResolution.vendorId !== trapVendorResolution.vendorId
  ) {
    return {
      tenantId,
      connectionId,
      oltId,
      vendor: 'Standard',
      model,
      hardwareModel,
      isStandardTrap,
      isAmbiguous: true,
      ambiguityReason: `Conflicting vendor evidence: sysObjectID resolves to '${sysObjVendorResolution.displayName}' (PEN ${sysObjPen ?? 'unknown'}), but trap OID belongs to '${trapVendorResolution.displayName}' (PEN ${trapPen ?? 'unknown'})`,
    };
  }

  // Case C: Standard trap without enterprise PEN
  if (isStandardTrap) {
    return {
      tenantId,
      connectionId,
      oltId,
      vendor: registeredVendor ?? sysObjVendorResolution?.displayName ?? 'Standard',
      model,
      hardwareModel,
      pen: sysObjPen,
      sysObjectID: sysObjectId,
      isStandardTrap: true,
      isAmbiguous: false,
    };
  }

  // Case D: Clean Enterprise trap resolution
  return {
    tenantId,
    connectionId,
    oltId,
    vendor: trapVendorResolution.displayName,
    model,
    hardwareModel,
    pen: trapPen ?? trapVendorResolution.pens[0],
    sysObjectID: sysObjectId,
    isStandardTrap: false,
    isAmbiguous: false,
  };
}
