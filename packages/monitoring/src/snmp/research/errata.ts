/**
 * OLT Errata & False-Positive Rule Management Engine (Roadmap Fase 8).
 *
 * Enforces Gate 8: Suppresses or remaps known vendor firmware bugs,
 * transient test traps, and deprecated definitions before incident correlation.
 */

import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const SnmpErrataActionSchema = z.enum(['suppress', 'remap', 'correct_oid']);
export type SnmpErrataAction = z.infer<typeof SnmpErrataActionSchema>;

export const SnmpErrataRecordSchema = z.object({
  errata_id: z.string().regex(/^ERR-[A-Z0-9]+-\d+$/, 'Invalid errata ID format'),
  vendor: z.string().min(1),
  target_models: z.array(z.string()).optional(),
  firmware_versions: z.array(z.string()).optional(),
  oid: z.string().regex(/^\d+(\.\d+)+$/, 'Invalid OID notation'),
  action: SnmpErrataActionSchema,
  reason: z.string().min(1),
  source_reference: z.string().optional(),
  remap_category: z.string().optional(),
  remap_severity: z.enum(['critical', 'warning', 'info']).optional(),
  corrected_oid: z.string().optional(),
});

export type SnmpErrataRecord = z.infer<typeof SnmpErrataRecordSchema>;
export const ErrataFileSchema = z.array(SnmpErrataRecordSchema);

export interface SnmpErrataEvaluation {
  matched: boolean;
  errata?: SnmpErrataRecord;
  action: 'none' | 'suppress' | 'remap' | 'correct_oid';
  remappedCategory?: string;
  remappedSeverity?: 'critical' | 'warning' | 'info';
  correctedOid?: string;
}

const DEFAULT_ERRATA_PATH = path.resolve(__dirname, '../../../../../research/olt/errata.yaml');

/**
 * Loads and validates errata records from YAML.
 */
export function loadErrataRegistry(filePath = DEFAULT_ERRATA_PATH): {
  erratas: SnmpErrataRecord[];
  errors: string[];
} {
  const errors: string[] = [];
  if (!fs.existsSync(filePath)) {
    return { erratas: [], errors };
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    errors.push(`Failed parsing errata YAML: ${String(err)}`);
    return { erratas: [], errors };
  }

  const result = ErrataFileSchema.safeParse(parsed);
  if (!result.success) {
    for (const err of result.error.errors) {
      errors.push(`${err.path.join('.')}: ${err.message}`);
    }
    return { erratas: [], errors };
  }

  return { erratas: result.data, errors: [] };
}

/**
 * Evaluates whether an incoming trap matches any active errata rules.
 */
export function evaluateSnmpErrata(
  trap: { oid: string; vendor?: string; model?: string; firmware?: string },
  errataList: SnmpErrataRecord[],
): SnmpErrataEvaluation {
  const cleanOid = trap.oid.trim();

  for (const rule of errataList) {
    if (rule.oid !== cleanOid) continue;

    // Check vendor match if specified
    if (rule.vendor && trap.vendor) {
      if (rule.vendor.toLowerCase() !== trap.vendor.toLowerCase()) continue;
    }

    // Check model match if specified
    if (rule.target_models && rule.target_models.length > 0 && trap.model) {
      const matchModel = rule.target_models.some((m) =>
        trap.model!.toLowerCase().includes(m.toLowerCase()),
      );
      if (!matchModel) continue;
    }

    // Check firmware match if specified
    if (rule.firmware_versions && rule.firmware_versions.length > 0 && trap.firmware) {
      const matchFw = rule.firmware_versions.some((fw) =>
        trap.firmware!.toLowerCase().includes(fw.toLowerCase()),
      );
      if (!matchFw) continue;
    }

    return {
      matched: true,
      errata: rule,
      action: rule.action,
      remappedCategory: rule.remap_category,
      remappedSeverity: rule.remap_severity,
      correctedOid: rule.corrected_oid,
    };
  }

  return { matched: false, action: 'none' };
}
