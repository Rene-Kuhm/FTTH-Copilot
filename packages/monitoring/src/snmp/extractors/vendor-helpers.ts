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

const NON_SERIAL_PREFIXES = new Set([
  'LOSS', 'LINK', 'INFO', 'WARN', 'FAIL', 'PORT', 'CARD', 'DOWN',
  'SLOT', 'TEST', 'NAME', 'TYPE', 'DATA', 'USER', 'AUTH', 'TRAP',
]);

/**
 * Decodes GPON ONT serial numbers from ASCII or hexadecimal strings.
 *
 * GPON serial numbers consist of a 4-character vendor prefix (e.g. HWTC, ZTEG, CXNK, ADTN)
 * followed by vendor-specific serial data (either ASCII digits or hex octets).
 *
 * Serial numbers NEVER contain spaces or non-alphanumeric punctuation.
 */
export function decodeVendorSerialNumber(value: unknown, rawHex?: string): string | undefined {
  const candidates: string[] = [];

  if (typeof value === 'string' && value.trim()) {
    candidates.push(value.trim());
  }
  if (Buffer.isBuffer(value)) {
    candidates.push(value.toString('hex'));
    const str = value.toString('utf8').trim();
    if (str) candidates.push(str);
  }
  if (typeof rawHex === 'string' && rawHex.trim()) {
    candidates.push(rawHex.trim());
  }

  for (const cand of candidates) {
    // 1. Direct ASCII representation matching standard 4-char prefix + 4..16 alphanumeric without spaces
    // e.g. HWTC12345678, ZTEGC8765432, CXNK00123456, ADTN12345678
    if (/^[A-Za-z]{4}[A-Za-z0-9_-]{4,16}$/.test(cand)) {
      const prefix = cand.slice(0, 4).toUpperCase();
      if (!NON_SERIAL_PREFIXES.has(prefix)) {
        return cand.toUpperCase();
      }
    }

    // 2. Hexadecimal encoded string (e.g. "4857544331323334" -> "HWTC1234")
    // Must strictly contain only hex characters and be between 16 and 32 chars (8..16 bytes)
    if (/^[0-9a-fA-F]{16,32}$/i.test(cand) && cand.length % 2 === 0) {
      try {
        const buf = Buffer.from(cand, 'hex');
        const prefix = buf.subarray(0, 4).toString('utf8');

        if (/^[A-Za-z]{4}$/.test(prefix) && !NON_SERIAL_PREFIXES.has(prefix.toUpperCase())) {
          const remainderBuf = buf.subarray(4);
          const remainderStr = remainderBuf.toString('utf8');

          // Alphanumeric ASCII remainder without spaces
          if (/^[A-Za-z0-9_-]{4,16}$/.test(remainderStr)) {
            return (prefix.toUpperCase() + remainderStr).trim();
          }

          // Mixed ASCII prefix + binary serial hex (4 bytes -> 8 hex chars, standard 12-char serial)
          if (remainderBuf.length === 4) {
            return (prefix.toUpperCase() + remainderBuf.toString('hex')).toUpperCase();
          }
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

export interface CalixParsedEvent extends GponOpticalHierarchy {
  eventText?: string;
  cliObject?: string;
  derivedCategory?:
    | 'los'
    | 'dying_gasp'
    | 'onu_offline'
    | 'onu_online'
    | 'pon_down'
    | 'pon_up'
    | 'card_failure'
    | 'los_clear';
  isClear?: boolean;
}

/**
 * Extracts Calix E7 hierarchy, serial, and event condition from varbinds (e7TrapCliObject, e7TrapText).
 */
export function extractCalixHierarchy(
  notification: DecodedSnmpNotification,
): CalixParsedEvent {
  const result: CalixParsedEvent = {};

  for (const vb of notification.varbinds) {
    if (typeof vb.value === 'string') {
      const val = vb.value.trim();

      // Check for CLI object string, e.g. "ont 1/1/2/4", "ont 1/2/4", "port 1/1/2", "card 1/1"
      const ontMatch4 =
        val.match(/^ont\s+(\d+)\/(\d+)\/(\d+)\/(\d+)/i) ||
        val.match(/^ont\/(\d+)\/(\d+)\/(\d+)\/(\d+)/i);
      if (ontMatch4) {
        result.cliObject = val;
        result.shelf = parseInt(ontMatch4[1], 10);
        result.slot = parseInt(ontMatch4[2], 10);
        result.port = parseInt(ontMatch4[3], 10);
        result.onuId = parseInt(ontMatch4[4], 10);
      } else {
        const ontMatch3 =
          val.match(/^ont\s+(\d+)\/(\d+)\/(\d+)/i) ||
          val.match(/^ont\/(\d+)\/(\d+)\/(\d+)/i);
        if (ontMatch3 && !result.onuId) {
          result.cliObject = val;
          result.slot = parseInt(ontMatch3[1], 10);
          result.port = parseInt(ontMatch3[2], 10);
          result.onuId = parseInt(ontMatch3[3], 10);
        } else {
          const portMatch3 =
            val.match(/^port\s+(\d+)\/(\d+)\/(\d+)/i) ||
            val.match(/^port\/(\d+)\/(\d+)\/(\d+)/i);
          if (portMatch3 && !result.port) {
            result.cliObject = val;
            result.shelf = parseInt(portMatch3[1], 10);
            result.slot = parseInt(portMatch3[2], 10);
            result.port = parseInt(portMatch3[3], 10);
          } else {
            const portMatch2 =
              val.match(/^port\s+(\d+)\/(\d+)/i) ||
              val.match(/^port\/(\d+)\/(\d+)/i);
            if (portMatch2 && !result.port) {
              result.cliObject = val;
              result.slot = parseInt(portMatch2[1], 10);
              result.port = parseInt(portMatch2[2], 10);
            }
          }
        }
      }

      // Check for event text, e.g. "Loss of Signal", "Dying Gasp", "ONT Offline", "PON Link Down", etc.
      const lower = val.toLowerCase();
      if (
        lower.includes('loss of signal') ||
        lower.includes('dying gasp') ||
        lower.includes('offline') ||
        lower.includes('online') ||
        lower.includes('activated') ||
        lower.includes('link down') ||
        lower.includes('link up') ||
        lower.includes('card failure') ||
        lower.includes('card fault') ||
        lower.includes('cleared')
      ) {
        result.eventText = val;
        if (lower.includes('cleared') || lower.includes('clear')) {
          result.isClear = true;
          result.derivedCategory = 'los_clear';
        } else if (lower.includes('loss of signal') || lower.includes('los')) {
          result.derivedCategory = 'los';
        } else if (lower.includes('dying gasp')) {
          result.derivedCategory = 'dying_gasp';
        } else if (lower.includes('offline')) {
          result.derivedCategory = 'onu_offline';
        } else if (lower.includes('online') || lower.includes('activated')) {
          result.derivedCategory = 'onu_online';
          result.isClear = true;
        } else if (lower.includes('link down') || lower.includes('port down')) {
          result.derivedCategory = 'pon_down';
        } else if (lower.includes('link up') || lower.includes('port up')) {
          result.derivedCategory = 'pon_up';
          result.isClear = true;
        } else if (lower.includes('card failure') || lower.includes('card fault')) {
          result.derivedCategory = 'card_failure';
        }
      }
    }

    // Specific check for Calix ONT serial OID (.1.1.10)
    if (vb.oid.endsWith('.1.1.10')) {
      const serial = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (serial) {
        result.serial = serial;
      } else if (typeof vb.value === 'string' && vb.value.trim()) {
        result.serial = vb.value.trim().toUpperCase();
      }
    } else if (
      !result.serial &&
      (!result.eventText || result.eventText !== vb.value) &&
      (!result.cliObject || result.cliObject !== vb.value)
    ) {
      const serial = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (serial) {
        result.serial = serial;
      }
    }
  }

  return result;
}

/**
 * Extracts Adtran TA5000 GPON hierarchy and serial from notification trap OID and varbinds (ifDescr).
 */
export function extractAdtranHierarchy(
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

    if (parts.length >= 3) {
      const [sl, p, o] = parts.slice(-3);
      hierarchy.slot = sl;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 2) {
      const [sl, p] = parts;
      hierarchy.slot = sl;
      hierarchy.port = p;
    }
  }

  // 2. Scan varbinds for ifDescr ("ont 1/2.4", "ont 1/2/4", "gpon 1/2") and serial
  for (const vb of notification.varbinds) {
    if (typeof vb.value === 'string') {
      const val = vb.value.trim();
      const ontMatch = val.match(/^ont\s+(\d+)\/(\d+)[./](\d+)/i);
      if (ontMatch) {
        hierarchy.slot = parseInt(ontMatch[1], 10);
        hierarchy.port = parseInt(ontMatch[2], 10);
        hierarchy.onuId = parseInt(ontMatch[3], 10);
      } else {
        const gponMatch = val.match(/^gpon\s+(\d+)\/(\d+)/i);
        if (gponMatch && !hierarchy.port) {
          hierarchy.slot = parseInt(gponMatch[1], 10);
          hierarchy.port = parseInt(gponMatch[2], 10);
        }
      }
    }

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
 * Extracts VSOL V1600 GPON hierarchy and serial from notification trap OID and varbinds.
 */
export function extractVsolHierarchy(
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

    if (parts.length >= 3) {
      const [sl, p, o] = parts.slice(-3);
      hierarchy.slot = sl;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 2) {
      const [sl, p] = parts;
      hierarchy.slot = sl;
      hierarchy.port = p;
    }
  }

  // 2. Scan varbinds for explicit OID indexes or string descriptions
  for (const vb of notification.varbinds) {
    if (vb.oid.endsWith('.10.1') && typeof vb.value === 'number') {
      hierarchy.slot = vb.value;
    } else if (vb.oid.endsWith('.10.2') && typeof vb.value === 'number') {
      hierarchy.port = vb.value;
    } else if (vb.oid.endsWith('.10.3') && typeof vb.value === 'number') {
      hierarchy.onuId = vb.value;
    } else if (typeof vb.value === 'string') {
      const val = vb.value.trim();
      // Match patterns like "gpon 1/2:5", "ont 1/2/5", "epon 0/1:3"
      const match3 = val.match(/(?:gpon|epon|ont)\s*(\d+)\/(\d+)[:/](\d+)/i);
      if (match3) {
        hierarchy.slot = parseInt(match3[1], 10);
        hierarchy.port = parseInt(match3[2], 10);
        hierarchy.onuId = parseInt(match3[3], 10);
      } else {
        const match2 = val.match(/(?:gpon|epon|port)\s*(\d+)\/(\d+)/i);
        if (match2 && !hierarchy.port) {
          hierarchy.slot = parseInt(match2[1], 10);
          hierarchy.port = parseInt(match2[2], 10);
        }
      }
    }

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
 * Extracts BDCOM P3600 GPON hierarchy and serial from notification trap OID and varbinds.
 */
export function extractBdcomHierarchy(
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

    if (parts.length >= 3) {
      const [sl, p, o] = parts.slice(-3);
      hierarchy.slot = sl;
      hierarchy.port = p;
      hierarchy.onuId = o;
    } else if (parts.length === 2) {
      const [sl, p] = parts;
      hierarchy.slot = sl;
      hierarchy.port = p;
    }
  }

  // 2. Scan varbinds for NMS-GPON-MIB attributes (.1.1.1=slot, .1.1.2=port, .1.1.3=onuId)
  for (const vb of notification.varbinds) {
    if (vb.oid.endsWith('.1.1.1') && typeof vb.value === 'number') {
      hierarchy.slot = vb.value;
    } else if (vb.oid.endsWith('.1.1.2') && typeof vb.value === 'number') {
      hierarchy.port = vb.value;
    } else if (vb.oid.endsWith('.1.1.3') && typeof vb.value === 'number') {
      hierarchy.onuId = vb.value;
    } else if (typeof vb.value === 'string') {
      const val = vb.value.trim();
      // Match patterns like "gpon0/4:12", "GPON 0/4:12"
      const match3 = val.match(/gpon\s*(\d+)\/(\d+)[:/](\d+)/i);
      if (match3) {
        hierarchy.slot = parseInt(match3[1], 10);
        hierarchy.port = parseInt(match3[2], 10);
        hierarchy.onuId = parseInt(match3[3], 10);
      } else {
        const match2 = val.match(/gpon\s*(\d+)\/(\d+)/i);
        if (match2 && !hierarchy.port) {
          hierarchy.slot = parseInt(match2[1], 10);
          hierarchy.port = parseInt(match2[2], 10);
        }
      }
    }

    if (!hierarchy.serial) {
      const serial = decodeVendorSerialNumber(vb.value, vb.rawHex);
      if (serial) {
        hierarchy.serial = serial;
      }
    }
  }

  return hierarchy;
}
