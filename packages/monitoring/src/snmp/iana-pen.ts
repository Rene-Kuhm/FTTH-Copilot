/**
 * Authoritative IANA Private Enterprise Numbers (PEN) Registry (Roadmap Fase 1).
 *
 * Prevents free-text vendor guessing by rooting vendor identity strictly
 * in registered IANA Private Enterprise Numbers under 1.3.6.1.4.1.<PEN>.
 */

export interface IanaVendorRecord {
  vendorId: string;
  displayName: string;
  pens: readonly number[];
  priority: 'P0' | 'P1' | 'P2';
  description: string;
}

export const IANA_ENTERPRISE_ROOT = '1.3.6.1.4.1';
export const STANDARD_MIB2_ROOT = '1.3.6.1.2.1';
export const SNMP_FRAMEWORK_ROOT = '1.3.6.1.6.3';

export const IANA_VENDOR_REGISTRY: readonly IanaVendorRecord[] = Object.freeze([
  {
    vendorId: 'huawei',
    displayName: 'Huawei',
    pens: [2011],
    priority: 'P0',
    description: 'Huawei Technologies Co., Ltd. (MA5600, MA5800 series)',
  },
  {
    vendorId: 'zte',
    displayName: 'ZTE',
    pens: [3902],
    priority: 'P0',
    description: 'ZTE Corporation (ZXA10 C300, C600 series)',
  },
  {
    vendorId: 'nokia',
    displayName: 'Nokia',
    pens: [637, 6527, 28458],
    priority: 'P0',
    description: 'Nokia / Alcatel-Lucent (7360 ISAM, Lightspan MF series)',
  },
  {
    vendorId: 'fiberhome',
    displayName: 'FiberHome',
    pens: [3807],
    priority: 'P0',
    description: 'FiberHome Telecommunication Technologies (AN5516, AN6000 series)',
  },
  {
    vendorId: 'calix',
    displayName: 'Calix',
    pens: [6321, 1264],
    priority: 'P1',
    description: 'Calix Networks (E7, E9 series; authoritative PEN 6321, legacy 1264)',
  },
  {
    vendorId: 'adtran',
    displayName: 'Adtran',
    pens: [664],
    priority: 'P1',
    description: 'ADTRAN, Inc. (Total Access 5000, SDX 6000 series)',
  },
  {
    vendorId: 'dzs',
    displayName: 'DZS',
    pens: [5504, 6296, 5597],
    priority: 'P1',
    description: 'DZS / Zhone Technologies / DASAN Network Solutions (authoritative PENs 5504 and 6296, legacy 5597)',
  },
  {
    vendorId: 'zyxel',
    displayName: 'Zyxel',
    pens: [890],
    priority: 'P1',
    description: 'Zyxel Communications Corp. (IES4204, IES5206, IES5212 series)',
  },
  {
    vendorId: 'vsol',
    displayName: 'VSOL',
    pens: [37950],
    priority: 'P1',
    description: 'Guangzhou V-Solution Telecommunication Technology (V1600, V3600)',
  },
  {
    vendorId: 'cdata',
    displayName: 'C-Data',
    pens: [34592],
    priority: 'P1',
    description: 'Shenzhen C-Data Technology Co., Ltd. (FD11xx, FD12xx, FD16xx)',
  },
  {
    vendorId: 'bdcom',
    displayName: 'BDCOM',
    pens: [3320],
    priority: 'P2',
    description: 'Shanghai Baud Data Communication Co., Ltd. (P33xx, P36xx series)',
  },
  {
    vendorId: 'ubiquiti',
    displayName: 'Ubiquiti',
    pens: [41112],
    priority: 'P2',
    description: 'Ubiquiti Networks, Inc. (UF-OLT, UISP Fiber OLT series)',
  },
]);

const PEN_TO_VENDOR_MAP = new Map<number, IanaVendorRecord>();
for (const v of IANA_VENDOR_REGISTRY) {
  for (const pen of v.pens) {
    PEN_TO_VENDOR_MAP.set(pen, v);
  }
}

/**
 * Extracts the integer Private Enterprise Number from an enterprise OID.
 * E.g. '1.3.6.1.4.1.2011.6.128' -> 2011
 */
export function extractEnterprisePen(oid: string): number | null {
  const trimmed = oid.trim().replace(/^\./, '');
  const prefix = `${IANA_ENTERPRISE_ROOT}.`;
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const remainder = trimmed.slice(prefix.length);
  const dotIndex = remainder.indexOf('.');
  const penStr = dotIndex === -1 ? remainder : remainder.slice(0, dotIndex);
  const pen = Number.parseInt(penStr, 10);
  return Number.isSafeInteger(pen) && pen > 0 ? pen : null;
}

/**
 * Resolves a vendor record from an IANA PEN.
 */
export function resolveVendorByPen(pen: number): IanaVendorRecord | null {
  return PEN_TO_VENDOR_MAP.get(pen) ?? null;
}

/**
 * Resolves the authoritative vendor from an OID based strictly on its IANA PEN root.
 * Returns null if the OID is not in the private enterprise tree or belongs to an uncataloged PEN.
 */
export function resolveVendorByOid(oid: string): IanaVendorRecord | null {
  const pen = extractEnterprisePen(oid);
  if (pen === null) return null;
  return resolveVendorByPen(pen);
}

/**
 * Checks if an OID belongs to standard IETF/ITU-T MIB hierarchies rather than a private enterprise tree.
 */
export function isStandardOid(oid: string): boolean {
  const trimmed = oid.trim().replace(/^\./, '');
  return (
    trimmed.startsWith(STANDARD_MIB2_ROOT) ||
    trimmed.startsWith(SNMP_FRAMEWORK_ROOT)
  );
}
