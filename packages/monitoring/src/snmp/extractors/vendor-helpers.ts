/**
 * Vendor-Specific SNMP Varbind & Hierarchy Helpers (Roadmap Fase 3).
 *
 * Provides decoding utilities for:
 * - Serial numbers (ASCII, hex octet strings, HWTC/ZTEG vendor prefixes)
 * - GPON optical hierarchy (frame, rack, shelf, slot, port, onuId)
 */

import type { DecodedSnmpNotification } from '../types';

export interface GponOpticalHierarchy {
  frame?: number;
  rack?: number;
  shelf?: number;
  slot?: number;
  port?: number;
  onuId?: number;
  serial?: string;
}

/**
 * Decodes GPON ONT serial numbers from ASCII or hexadecimal strings.
 *
 * GPON serial numbers consist of a 4-character vendor prefix (e.g. HWTC, ZTEG)
 * followed by vendor-specific serial data (either ASCII digits or hex octets).
 */
export function decodeVendorSerialNumber(value: unknown, rawHex?: string): string | undefined {
  const candidates: string[] = [];

  if (typeof value === 'string' && value.trim()) {
    candidates.push(value.trim());
  }
  if (Buffer.isBuffer(value)) {
    candidates.push(value.toString('hex'));
    candidates.push(value.toString('utf8'));
  }
  if (typeof rawHex === 'string' && rawHex.trim()) {
    candidates.push(rawHex.trim());
  }

  for (const cand of candidates) {
    // 1. Direct ASCII representation matching standard 4-char prefix + 4..16 alphanumeric
    // e.g. HWTC12345678, ZTEGC8765432
    if (/^(HWTC|ZTEG|[A-Z]{4})[A-Za-z0-9_-]{4,16}$/i.test(cand)) {
      return cand.toUpperCase();
    }

    // 2. Hexadecimal encoded string (e.g. "4857544331323334" -> "HWTC1234")
    const cleanHex = cand.replace(/[^0-9a-fA-F]/g, '');
    if (cleanHex.length >= 8 && cleanHex.length % 2 === 0) {
      try {
        const buf = Buffer.from(cleanHex, 'hex');
        const prefix = buf.subarray(0, 4).toString('utf8');

        if (/^[A-Z]{4}$/i.test(prefix)) {
          const remainderBuf = buf.subarray(4);
          const remainderStr = remainderBuf.toString('utf8');
          const isAllPrintable = /^[\x20-\x7E]+$/.test(remainderStr);

          if (isAllPrintable && remainderStr.length > 0) {
            return (prefix + remainderStr).trim();
          }

          // Mixed ASCII prefix + binary serial hex
          return (prefix + remainderBuf.toString('hex')).toUpperCase();
        }
      } catch {
        // Ignore parsing errors
      }
    }
  }

  return undefined;
}

/**
 * Extracts numeric hierarchy components from an OID suffix.
 */
export function extractHierarchyFromOid(
  oid: string,
  basePrefix?: string,
): GponOpticalHierarchy {
  const result: GponOpticalHierarchy = {};

  let suffix = oid;
  if (basePrefix) {
    if (oid.startsWith(`${basePrefix}.`)) {
      suffix = oid.slice(basePrefix.length + 1);
    } else if (oid === basePrefix) {
      return result;
    }
  }

  const parts = suffix
    .split('.')
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n) && n >= 0);

  if (parts.length === 0) {
    return result;
  }

  // Common patterns:
  // 5 segments (ZTE typical: rack.shelf.slot.port.onuId)
  if (parts.length >= 5) {
    const [rack, shelf, slot, port, onuId] = parts.slice(-5);
    result.rack = rack;
    result.shelf = shelf;
    result.slot = slot;
    result.port = port;
    result.onuId = onuId;
    return result;
  }

  // 4 segments (Huawei typical: frame.slot.port.onuId or ZTE shelf.slot.port.onuId)
  if (parts.length === 4) {
    const [first, second, third, fourth] = parts;
    result.frame = first;
    result.slot = second;
    result.port = third;
    result.onuId = fourth;
    return result;
  }

  // 3 segments (frame.slot.port or slot.port.onuId)
  if (parts.length === 3) {
    const [first, second, third] = parts;
    result.frame = first;
    result.slot = second;
    result.port = third;
    return result;
  }

  // 2 segments (slot.port)
  if (parts.length === 2) {
    const [first, second] = parts;
    result.slot = first;
    result.port = second;
    return result;
  }

  // 1 segment (port)
  if (parts.length === 1) {
    result.port = parts[0];
    return result;
  }

  return result;
}

/**
 * Extracts Huawei GPON hierarchy and serial from notification trap OID and varbinds.
 */
export function extractHuaweiGponHierarchy(
  notification: DecodedSnmpNotification,
  baseTrapOid?: string,
): GponOpticalHierarchy {
  const hierarchy: GponOpticalHierarchy = {};

  // 1. Check trap OID suffix if provided
  if (baseTrapOid && notification.trapOid.startsWith(`${baseTrapOid}.`)) {
    const suffix = notification.trapOid.slice(baseTrapOid.length + 1);
    const parts = suffix
      .split('.')
      .map((p) => parseInt(p, 10))
      .filter((n) => !Number.isNaN(n) && n >= 0);

    if (parts.length >= 4) {
      const [f, s, p, o] = parts.slice(-4);
      hierarchy.frame = f;
      hierarchy.slot = s;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 3) {
      const [f, s, p] = parts;
      hierarchy.frame = f;
      hierarchy.slot = s;
      hierarchy.port = p;
    } else if (parts.length === 2) {
      const [s, p] = parts;
      hierarchy.slot = s;
      hierarchy.port = p;
    } else if (parts.length === 1) {
      hierarchy.port = parts[0];
    }
  }

  // 2. Scan varbinds for serial and topology indexes
  for (const vb of notification.varbinds) {
    if (!hierarchy.serial) {
      const serial = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (serial) {
        hierarchy.serial = serial;
      }
    }
  }

  return hierarchy;
}

/**
 * Extracts ZTE GPON hierarchy and serial from notification trap OID and varbinds.
 */
export function extractZteGponHierarchy(
  notification: DecodedSnmpNotification,
  baseTrapOid?: string,
): GponOpticalHierarchy {
  const hierarchy: GponOpticalHierarchy = {};

  // 1. Check trap OID suffix if provided
  if (baseTrapOid && notification.trapOid.startsWith(`${baseTrapOid}.`)) {
    const suffix = notification.trapOid.slice(baseTrapOid.length + 1);
    const parts = suffix
      .split('.')
      .map((p) => parseInt(p, 10))
      .filter((n) => !Number.isNaN(n) && n >= 0);

    if (parts.length >= 5) {
      const [r, sh, sl, p, o] = parts.slice(-5);
      hierarchy.rack = r;
      hierarchy.shelf = sh;
      hierarchy.slot = sl;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 4) {
      const [r, sh, sl, p] = parts;
      hierarchy.rack = r;
      hierarchy.shelf = sh;
      hierarchy.slot = sl;
      hierarchy.port = p;
    } else if (parts.length === 3) {
      const [sl, p, o] = parts;
      hierarchy.slot = sl;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 2) {
      const [sl, p] = parts;
      hierarchy.slot = sl;
      hierarchy.port = p;
    } else if (parts.length === 1) {
      hierarchy.port = parts[0];
    }
  }

  // 2. Scan varbinds for serial and topology indexes
  for (const vb of notification.varbinds) {
    if (!hierarchy.serial) {
      const serial = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (serial) {
        hierarchy.serial = serial;
      }
    }
  }

  return hierarchy;
}

/**
 * Extracts Nokia / Alcatel ISAM & Lightspan hierarchy and serial from notification trap OID and varbinds.
 */
export function extractNokiaHierarchy(
  notification: DecodedSnmpNotification,
  baseTrapOid?: string,
): GponOpticalHierarchy {
  const hierarchy: GponOpticalHierarchy = {};

  // 1. Check trap OID suffix if provided
  if (baseTrapOid && notification.trapOid.startsWith(`${baseTrapOid}.`)) {
    const suffix = notification.trapOid.slice(baseTrapOid.length + 1);
    const parts = suffix
      .split('.')
      .map((p) => parseInt(p, 10))
      .filter((n) => !Number.isNaN(n) && n >= 0);

    const isOntScope =
      baseTrapOid.includes('.36.1.1.') ||
      notification.trapOid.includes('Ont') ||
      notification.varbinds.some((vb) => {
        const s = decodeVendorSerialNumber(vb.value, vb.rawHex);
        return s !== undefined;
      });

    if (parts.length >= 5) {
      const [r, sh, sl, p, o] = parts.slice(-5);
      hierarchy.rack = r;
      hierarchy.shelf = sh;
      hierarchy.slot = sl;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 4) {
      if (isOntScope) {
        const [sh, sl, p, o] = parts;
        hierarchy.shelf = sh;
        hierarchy.slot = sl;
        hierarchy.port = p;
        hierarchy.onuId = o;
      } else {
        const [r, sh, sl, p] = parts;
        hierarchy.rack = r;
        hierarchy.shelf = sh;
        hierarchy.slot = sl;
        hierarchy.port = p;
      }
    } else if (parts.length === 3) {
      if (isOntScope) {
        const [sl, p, o] = parts;
        hierarchy.slot = sl;
        hierarchy.port = p;
        hierarchy.onuId = o;
      } else {
        const [sh, sl, p] = parts;
        hierarchy.shelf = sh;
        hierarchy.slot = sl;
        hierarchy.port = p;
      }
    } else if (parts.length === 2) {
      const [sl, p] = parts;
      hierarchy.slot = sl;
      hierarchy.port = p;
    } else if (parts.length === 1) {
      if (baseTrapOid.includes('.3.1.1.1')) {
        // Line card equipment trap
        hierarchy.slot = parts[0];
      } else {
        hierarchy.port = parts[0];
      }
    }
  }

  // 2. Scan varbinds for serial number (ALCL..., NOKT..., etc.)
  for (const vb of notification.varbinds) {
    if (!hierarchy.serial) {
      const serial = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (serial) {
        hierarchy.serial = serial;
      }
    }
  }

  return hierarchy;
}

/**
 * Extracts FiberHome GPON hierarchy and serial from notification trap OID and varbinds.
 */
export function extractFiberhomeGponHierarchy(
  notification: DecodedSnmpNotification,
  baseTrapOid?: string,
): GponOpticalHierarchy {
  const hierarchy: GponOpticalHierarchy = {};

  // 1. Check trap OID suffix if provided
  if (baseTrapOid && notification.trapOid.startsWith(`${baseTrapOid}.`)) {
    const suffix = notification.trapOid.slice(baseTrapOid.length + 1);
    const parts = suffix
      .split('.')
      .map((p) => parseInt(p, 10))
      .filter((n) => !Number.isNaN(n) && n >= 0);

    const isOntScope =
      baseTrapOid.includes('.1.3.1.1.') ||
      notification.trapOid.includes('Ont') ||
      notification.varbinds.some((vb) => {
        const s = decodeVendorSerialNumber(vb.value, vb.rawHex);
        return s !== undefined;
      });

    if (parts.length >= 4) {
      const [subrack, sl, p, o] = parts.slice(-4);
      hierarchy.shelf = subrack;
      hierarchy.slot = sl;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 3) {
      if (isOntScope) {
        const [sl, p, o] = parts;
        hierarchy.slot = sl;
        hierarchy.port = p;
        hierarchy.onuId = o;
      } else {
        const [subrack, sl, p] = parts;
        hierarchy.shelf = subrack;
        hierarchy.slot = sl;
        hierarchy.port = p;
      }
    } else if (parts.length === 2) {
      if (baseTrapOid.includes('.1.1.1.1')) {
        // Card failure: subrack.slot
        const [subrack, sl] = parts;
        hierarchy.shelf = subrack;
        hierarchy.slot = sl;
      } else {
        const [sl, p] = parts;
        hierarchy.slot = sl;
        hierarchy.port = p;
      }
    } else if (parts.length === 1) {
      if (baseTrapOid.includes('.1.1.1.1')) {
        hierarchy.slot = parts[0];
      } else {
        hierarchy.port = parts[0];
      }
    }
  }

  // 2. Scan varbinds for serial number (FHTT...)
  for (const vb of notification.varbinds) {
    if (!hierarchy.serial) {
      const serial = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (serial) {
        hierarchy.serial = serial;
      }
    }
  }

  return hierarchy;
}
