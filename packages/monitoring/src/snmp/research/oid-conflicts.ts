/**
 * OID Collision & Semantic Conflict Detector (Roadmap Fase 8).
 *
 * Automatically detects:
 * 1. Enterprise OID collisions across distinct vendors.
 * 2. Enterprise PEN mismatches between declared vendor and IANA registry.
 * 3. Semantic contradictions (e.g. conflicting categories or severities for identical OIDs).
 * 4. Duplicate entries within the canonical trap catalog.
 */

import {
  resolveVendorByOid,
  extractEnterprisePen,
  isStandardOid,
} from '../iana-pen';
import type { SnmpTrapDefinition } from '../catalog';
import type { VendorPackageContent } from './validator';

export interface OidConflictIssue {
  type: 'error' | 'warning';
  oid: string;
  sourceVendors: string[];
  category: 'cross_vendor_collision' | 'pen_mismatch' | 'semantic_mismatch' | 'duplicate_catalog_entry';
  message: string;
}

export interface OidConflictReport {
  valid: boolean;
  totalOidsChecked: number;
  conflicts: OidConflictIssue[];
}

/**
 * Detects collisions and semantic conflicts across research vendor packages and the canonical catalog.
 */
export function detectOidConflicts(
  packages: VendorPackageContent[] = [],
  catalog: ReadonlyArray<SnmpTrapDefinition> = [],
): OidConflictReport {
  const conflicts: OidConflictIssue[] = [];
  const oidsSeen = new Set<string>();

  // 1. Check Catalog Internal Consistency
  const catalogOidMap = new Map<string, SnmpTrapDefinition[]>();
  for (const def of catalog) {
    oidsSeen.add(def.oid);
    const existing = catalogOidMap.get(def.oid) ?? [];
    existing.push(def);
    catalogOidMap.set(def.oid, existing);
  }

  for (const [oid, defs] of catalogOidMap.entries()) {
    if (defs.length > 1) {
      // Check for duplicate definitions
      const vendors = [...new Set(defs.map((d) => d.vendor ?? 'Unknown'))];
      const categories = [...new Set(defs.map((d) => d.category))];
      const severities = [...new Set(defs.map((d) => d.severity))];

      if (categories.length > 1 || severities.length > 1) {
        conflicts.push({
          type: 'error',
          oid,
          sourceVendors: vendors,
          category: 'semantic_mismatch',
          message: `Catalog defines OID '${oid}' multiple times with conflicting semantics (categories: [${categories.join(', ')}], severities: [${severities.join(', ')}])`,
        });
      } else {
        conflicts.push({
          type: 'warning',
          oid,
          sourceVendors: vendors,
          category: 'duplicate_catalog_entry',
          message: `Catalog contains duplicate definition for OID '${oid}'`,
        });
      }
    }

    // Check PEN ownership for enterprise OIDs in catalog
    const pen = extractEnterprisePen(oid);
    if (pen !== null) {
      const vendorRecord = resolveVendorByOid(oid);
      const declaredVendor = defs[0]?.vendor;
      if (vendorRecord && declaredVendor && declaredVendor.toLowerCase() !== 'standard') {
        if (vendorRecord.displayName.toLowerCase() !== declaredVendor.toLowerCase()) {
          conflicts.push({
            type: 'error',
            oid,
            sourceVendors: [declaredVendor, vendorRecord.displayName],
            category: 'pen_mismatch',
            message: `Catalog OID '${oid}' belongs to IANA PEN ${pen} (${vendorRecord.displayName}), but is declared as vendor '${declaredVendor}'`,
          });
        }
      }
    }
  }

  // 2. Cross-Vendor Sources OID Collisions & PEN Ownership
  // Map of enterprise OID -> Set of vendorIds declaring it as a fact
  const factOidVendorMap = new Map<string, Set<string>>();

  for (const pkg of packages) {
    for (const src of pkg.sources) {
      for (const fact of src.facts) {
        oidsSeen.add(fact.oid);
        const vendors = factOidVendorMap.get(fact.oid) ?? new Set<string>();
        vendors.add(pkg.vendorId);
        factOidVendorMap.set(fact.oid, vendors);

        // Check if fact OID matches the package vendor PEN
        const pen = extractEnterprisePen(fact.oid);
        if (pen !== null) {
          const owner = resolveVendorByOid(fact.oid);
          if (owner && owner.vendorId.toLowerCase() !== pkg.vendorId.toLowerCase()) {
            conflicts.push({
              type: 'error',
              oid: fact.oid,
              sourceVendors: [pkg.vendorId, owner.vendorId],
              category: 'cross_vendor_collision',
              message: `Vendor '${pkg.vendorId}' claims fact OID '${fact.oid}' which belongs to IANA PEN ${pen} registered to '${owner.displayName}'`,
            });
          }
        }
      }
    }
  }

  // Check if unrelated vendors claim the same enterprise OID
  for (const [oid, vendorsSet] of factOidVendorMap.entries()) {
    if (vendorsSet.size > 1 && !isStandardOid(oid)) {
      const vendorList = [...vendorsSet];
      conflicts.push({
        type: 'error',
        oid,
        sourceVendors: vendorList,
        category: 'cross_vendor_collision',
        message: `Multiple vendors [${vendorList.join(', ')}] declare the same non-standard OID '${oid}'`,
      });
    }
  }

  return {
    valid: conflicts.every((c) => c.type !== 'error'),
    totalOidsChecked: oidsSeen.size,
    conflicts,
  };
}
