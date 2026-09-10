/**
 * IF-MIB Varbind Extractor (RFC 2863).
 *
 * Extracts and maps interface status and metadata from SNMP varbinds.
 */

import type { SnmpVarbindDetail } from '../types';

export type IfAdminStatus = 'up' | 'down' | 'testing' | 'unknown';

export type IfOperStatus =
  | 'up'
  | 'down'
  | 'testing'
  | 'unknown'
  | 'dormant'
  | 'notPresent'
  | 'lowerLayerDown';

export interface ExtractedIfMibData {
  ifIndex?: number;
  ifAdminStatus?: IfAdminStatus;
  ifAdminStatusCode?: number;
  ifOperStatus?: IfOperStatus;
  ifOperStatusCode?: number;
  ifDescr?: string;
  ifName?: string;
  ifAlias?: string;
}

const OID_IF_INDEX = '1.3.6.1.2.1.2.2.1.1';
const OID_IF_DESCR = '1.3.6.1.2.1.2.2.1.2';
const OID_IF_ADMIN_STATUS = '1.3.6.1.2.1.2.2.1.7';
const OID_IF_OPER_STATUS = '1.3.6.1.2.1.2.2.1.8';
const OID_IF_NAME = '1.3.6.1.2.1.31.1.1.1.1';
const OID_IF_ALIAS = '1.3.6.1.2.1.31.1.1.1.18';

export function mapIfAdminStatus(code: number): IfAdminStatus {
  switch (code) {
    case 1:
      return 'up';
    case 2:
      return 'down';
    case 3:
      return 'testing';
    default:
      return 'unknown';
  }
}

export function mapIfOperStatus(code: number): IfOperStatus {
  switch (code) {
    case 1:
      return 'up';
    case 2:
      return 'down';
    case 3:
      return 'testing';
    case 4:
      return 'unknown';
    case 5:
      return 'dormant';
    case 6:
      return 'notPresent';
    case 7:
      return 'lowerLayerDown';
    default:
      return 'unknown';
  }
}

function matchesOidPrefix(oid: string, prefix: string): boolean {
  return oid === prefix || oid.startsWith(`${prefix}.`);
}

function extractIndexFromOid(oid: string, prefix: string): number | undefined {
  if (oid.startsWith(`${prefix}.`)) {
    const suffix = oid.slice(prefix.length + 1);
    const parsed = parseInt(suffix, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Extracts structured IF-MIB interface metrics from raw SNMP varbinds.
 */
export function extractIfMibVarbinds(
  varbinds: ReadonlyArray<Pick<SnmpVarbindDetail, 'oid' | 'value'>>,
): ExtractedIfMibData {
  const result: ExtractedIfMibData = {};

  for (const vb of varbinds) {
    const oid = vb.oid.trim();

    // ifIndex
    if (matchesOidPrefix(oid, OID_IF_INDEX)) {
      if (typeof vb.value === 'number') {
        result.ifIndex = vb.value;
      } else if (typeof vb.value === 'string') {
        const num = parseInt(vb.value, 10);
        if (!Number.isNaN(num)) result.ifIndex = num;
      }
      if (result.ifIndex === undefined) {
        result.ifIndex = extractIndexFromOid(oid, OID_IF_INDEX);
      }
    }

    // ifAdminStatus
    if (matchesOidPrefix(oid, OID_IF_ADMIN_STATUS)) {
      const num = typeof vb.value === 'number' ? vb.value : parseInt(String(vb.value), 10);
      if (!Number.isNaN(num)) {
        result.ifAdminStatusCode = num;
        result.ifAdminStatus = mapIfAdminStatus(num);
      }
      if (result.ifIndex === undefined) {
        result.ifIndex = extractIndexFromOid(oid, OID_IF_ADMIN_STATUS);
      }
    }

    // ifOperStatus
    if (matchesOidPrefix(oid, OID_IF_OPER_STATUS)) {
      const num = typeof vb.value === 'number' ? vb.value : parseInt(String(vb.value), 10);
      if (!Number.isNaN(num)) {
        result.ifOperStatusCode = num;
        result.ifOperStatus = mapIfOperStatus(num);
      }
      if (result.ifIndex === undefined) {
        result.ifIndex = extractIndexFromOid(oid, OID_IF_OPER_STATUS);
      }
    }

    // ifDescr
    if (matchesOidPrefix(oid, OID_IF_DESCR)) {
      if (vb.value !== null && vb.value !== undefined) {
        result.ifDescr = String(vb.value).trim();
      }
      if (result.ifIndex === undefined) {
        result.ifIndex = extractIndexFromOid(oid, OID_IF_DESCR);
      }
    }

    // ifName
    if (matchesOidPrefix(oid, OID_IF_NAME)) {
      if (vb.value !== null && vb.value !== undefined) {
        result.ifName = String(vb.value).trim();
      }
      if (result.ifIndex === undefined) {
        result.ifIndex = extractIndexFromOid(oid, OID_IF_NAME);
      }
    }

    // ifAlias
    if (matchesOidPrefix(oid, OID_IF_ALIAS)) {
      if (vb.value !== null && vb.value !== undefined) {
        result.ifAlias = String(vb.value).trim();
      }
      if (result.ifIndex === undefined) {
        result.ifIndex = extractIndexFromOid(oid, OID_IF_ALIAS);
      }
    }
  }

  return result;
}
