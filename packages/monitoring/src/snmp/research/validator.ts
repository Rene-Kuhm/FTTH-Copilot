/**
 * OLT Research Sources & Compatibility Validator (Roadmap Fase 1).
 *
 * Enforces Gate 1: No OID or definition enters without valid source_id,
 * confidence grade, target models, known/unknown firmware, and license status.
 */

import {
  SourcesFileSchema,
  VendorCompatibilityRecordSchema,
  type SourceRecord,
  type VendorCompatibilityRecord,
} from './schema';
import { resolveVendorByOid } from '../iana-pen';
import type { SnmpTrapDefinition } from '../catalog';

export interface ValidationIssue {
  type: 'error' | 'warning';
  file?: string;
  sourceId?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Validates an array of source records from a sources.yaml file.
 */
export function validateSourcesList(sources: unknown, fileName = 'sources.yaml'): ValidationResult {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();

  const parseResult = SourcesFileSchema.safeParse(sources);
  if (!parseResult.success) {
    for (const err of parseResult.error.errors) {
      issues.push({
        type: 'error',
        file: fileName,
        message: `${err.path.join('.')}: ${err.message}`,
      });
    }
    return { valid: false, issues };
  }

  for (const src of parseResult.data) {
    if (seenIds.has(src.source_id)) {
      issues.push({
        type: 'error',
        file: fileName,
        sourceId: src.source_id,
        message: `Duplicate source_id detected: '${src.source_id}'`,
      });
    }
    seenIds.add(src.source_id);

    // Validate facts
    for (const fact of src.facts) {
      const vendorRecord = resolveVendorByOid(fact.oid);
      if (vendorRecord && vendorRecord.displayName.toLowerCase() !== src.vendor.toLowerCase()) {
        issues.push({
          type: 'warning',
          file: fileName,
          sourceId: src.source_id,
          message: `Fact OID '${fact.oid}' belongs to IANA PEN vendor '${vendorRecord.displayName}', but source declares '${src.vendor}'`,
        });
      }
    }
  }

  return {
    valid: issues.every((i) => i.type !== 'error'),
    issues,
  };
}

/**
 * Validates a vendor compatibility record from compatibility.yaml.
 */
export function validateCompatibilityRecord(record: unknown, fileName = 'compatibility.yaml'): ValidationResult {
  const issues: ValidationIssue[] = [];

  const parseResult = VendorCompatibilityRecordSchema.safeParse(record);
  if (!parseResult.success) {
    for (const err of parseResult.error.errors) {
      issues.push({
        type: 'error',
        file: fileName,
        message: `${err.path.join('.')}: ${err.message}`,
      });
    }
    return { valid: false, issues };
  }

  return {
    valid: true,
    issues: [],
  };
}

export interface VendorPackageContent {
  vendorId: string;
  sources: SourceRecord[];
  compatibility: VendorCompatibilityRecord;
}

/**
 * Cross-validates all vendor packages ensuring global uniqueness of source_ids
 * and that all source references inside compatibility.yaml exist.
 */
export function validateCrossVendorRegistry(packages: VendorPackageContent[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const globalSourceIds = new Map<string, string>(); // source_id -> vendorId

  for (const pkg of packages) {
    for (const src of pkg.sources) {
      const existingVendor = globalSourceIds.get(src.source_id);
      if (existingVendor) {
        issues.push({
          type: 'error',
          sourceId: src.source_id,
          message: `Cross-vendor duplicate source_id detected: '${src.source_id}' in '${pkg.vendorId}' already defined in '${existingVendor}'`,
        });
      } else {
        globalSourceIds.set(src.source_id, pkg.vendorId);
      }
    }
  }

  // Check compatibility source references
  for (const pkg of packages) {
    for (const fam of pkg.compatibility.families) {
      for (const srcId of fam.sources) {
        if (!globalSourceIds.has(srcId)) {
          issues.push({
            type: 'error',
            message: `Family '${fam.family}' in vendor '${pkg.vendorId}' references nonexistent source_id: '${srcId}'`,
          });
        }
      }
    }
  }

  return {
    valid: issues.every((i) => i.type !== 'error'),
    issues,
  };
}

/**
 * Cross-validates that every non-standard catalog entry citing a source_id
 * has its OID present in that source's registered facts within the vendor packages.
 */
export function validateCatalogFactsTraceability(
  packages: VendorPackageContent[],
  catalog: ReadonlyArray<SnmpTrapDefinition>
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const sourceMap = new Map<string, { source: SourceRecord; vendorId: string }>();

  for (const pkg of packages) {
    for (const src of pkg.sources) {
      sourceMap.set(src.source_id, { source: src, vendorId: pkg.vendorId });
    }
  }

  for (const def of catalog) {
    if (def.vendor === 'Standard') {
      continue;
    }

    if (!def.source_id) {
      issues.push({
        type: 'error',
        message: `Catalog trap '${def.name}' (${def.oid}) has no source_id declared`,
      });
      continue;
    }

    const entry = sourceMap.get(def.source_id);
    if (!entry) {
      issues.push({
        type: 'error',
        sourceId: def.source_id,
        message: `Catalog trap '${def.name}' (${def.oid}) cites source_id '${def.source_id}', but source is not registered in any vendor package`,
      });
      continue;
    }

    const matchingFact = entry.source.facts.find((f) => f.oid === def.oid);
    if (!matchingFact) {
      issues.push({
        type: 'error',
        sourceId: def.source_id,
        message: `Catalog trap '${def.name}' (${def.oid}) cites source_id '${def.source_id}', but OID is missing from source facts in research/olt/${entry.vendorId}/sources.yaml`,
      });
      continue;
    }

    // Cross-validate semantic alignment
    if (matchingFact.notification_name !== def.name) {
      issues.push({
        type: 'error',
        sourceId: def.source_id,
        message: `Catalog trap '${def.name}' (${def.oid}) name mismatch with source fact '${matchingFact.notification_name}' in '${def.source_id}'`,
      });
    }

    if (matchingFact.category && matchingFact.category !== def.category) {
      issues.push({
        type: 'error',
        sourceId: def.source_id,
        message: `Catalog trap '${def.name}' (${def.oid}) category '${def.category}' does not match source fact category '${matchingFact.category}' in '${def.source_id}'`,
      });
    }

    if (matchingFact.severity && matchingFact.severity !== def.severity) {
      issues.push({
        type: 'error',
        sourceId: def.source_id,
        message: `Catalog trap '${def.name}' (${def.oid}) severity '${def.severity}' does not match source fact severity '${matchingFact.severity}' in '${def.source_id}'`,
      });
    }

    if (def.status && matchingFact.status !== def.status) {
      issues.push({
        type: 'error',
        sourceId: def.source_id,
        message: `Catalog trap '${def.name}' (${def.oid}) status '${def.status}' does not match source fact status '${matchingFact.status}' in '${def.source_id}'`,
      });
    }
  }

  return {
    valid: issues.every((i) => i.type !== 'error'),
    issues,
  };
}
