/**
 * OLT Research Sources & Compatibility Schemas (Roadmap Fase 1).
 */

import { z } from 'zod';

export const SourceGradeSchema = z.enum(['A', 'B', 'C', 'D', 'E']);
export type SourceGrade = z.infer<typeof SourceGradeSchema>;

export const LicenseStatusSchema = z.enum([
  'permissive',
  'restricted',
  'review-required',
  'standard',
]);
export type LicenseStatus = z.infer<typeof LicenseStatusSchema>;

export const FactStatusSchema = z.enum(['provisional', 'recognized', 'deprecated']);
export type FactStatus = z.infer<typeof FactStatusSchema>;

export const FactRecordSchema = z.object({
  notification_name: z.string().min(1),
  oid: z.string().regex(/^\d+(\.\d+)+$/, 'Invalid OID notation'),
  status: FactStatusSchema,
  severity: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  reference: z.string().optional(),
});
export type FactRecord = z.infer<typeof FactRecordSchema>;

export const SourceRecordSchema = z.object({
  source_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'source_id must be lowercase kebab-case'),
  vendor: z.string().min(1),
  families: z.array(z.string().min(1)).min(1),
  firmware: z.string().min(1), // can be 'unknown' or specific version string
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  source_grade: SourceGradeSchema,
  retrieved_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  license: LicenseStatusSchema,
  sha256: z.string().nullable().optional(),
  facts: z.array(FactRecordSchema).default([]),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const SourcesFileSchema = z.array(SourceRecordSchema);
export type SourcesFile = z.infer<typeof SourcesFileSchema>;

export const SupportLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4']);
export type SupportLevel = z.infer<typeof SupportLevelSchema>;

export const CompatibilityFamilyRecordSchema = z.object({
  family: z.string().min(1),
  level: SupportLevelSchema,
  confidence_grade: SourceGradeSchema,
  firmware: z.string().min(1),
  supported_traps: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type CompatibilityFamilyRecord = z.infer<typeof CompatibilityFamilyRecordSchema>;

export const VendorCompatibilityRecordSchema = z.object({
  vendor: z.string().min(1),
  priority: z.enum(['P0', 'P1', 'P2']),
  iana_pens: z.array(z.number().int().positive()).min(1),
  families: z.array(CompatibilityFamilyRecordSchema).min(1),
});
export type VendorCompatibilityRecord = z.infer<typeof VendorCompatibilityRecordSchema>;
