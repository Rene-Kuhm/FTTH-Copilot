/**
 * Phase F-7.1 — labels CSV schema + parser tests.
 *
 * The labels CSV (`docs/validation/labels.csv`) is the single source of
 * truth for precision ground truth (F-7 design AD-12). Until the NOC
 * tech lead fills in rows, `precision` stays `TBD` in the nightly
 * summary; once rows exist, the metrics-report computes real precision
 * over them.
 *
 * RED proof: before `labels-schema.ts` exists, the imports below resolve
 * to `undefined` and every assertion fails. GREEN proof: after the
 * module ships, the parser round-trips a header-only CSV (0 rows), a
 * two-row CSV (2 rows), and throws `LabelsParseError` with the offending
 * row index on every invalid input.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  labelsCsvSchema,
  parseLabelsCsv,
  loadLabelsFromFile,
  LabelsParseError,
  type LabelRow,
} from '../src/labels-schema';

const HEADER =
  'case_id,factual_claim_supported,ground_truth_severity,labeled_by,labeled_at';

describe('@ftth-copilot/eval — labels CSV schema (F-7.1)', () => {
  describe('labelsCsvSchema', () => {
    it('accepts a valid row with all required fields', () => {
      const row: LabelRow = {
        caseId: 'Q1',
        factualClaimSupported: true,
        groundTruthSeverity: 'minor',
        labeledBy: 'jperez',
        labeledAt: '2026-08-20T10:00:00.000Z',
      };
      const result = labelsCsvSchema.safeParse(row);
      expect(result.success).toBe(true);
    });

    it('rejects an empty caseId at the schema level', () => {
      const row = {
        caseId: '',
        factualClaimSupported: true,
        groundTruthSeverity: 'minor',
        labeledBy: 'jperez',
        labeledAt: '2026-08-20T10:00:00.000Z',
      };
      const result = labelsCsvSchema.safeParse(row);
      expect(result.success).toBe(false);
    });

    it('rejects an unknown severity enum value', () => {
      const row = {
        caseId: 'Q1',
        factualClaimSupported: true,
        groundTruthSeverity: 'severe',
        labeledBy: 'jperez',
        labeledAt: '2026-08-20T10:00:00.000Z',
      };
      const result = labelsCsvSchema.safeParse(row);
      expect(result.success).toBe(false);
    });

    it('rejects a non-ISO datetime', () => {
      const row = {
        caseId: 'Q1',
        factualClaimSupported: true,
        groundTruthSeverity: 'minor',
        labeledBy: 'jperez',
        labeledAt: 'not-a-date',
      };
      const result = labelsCsvSchema.safeParse(row);
      expect(result.success).toBe(false);
    });
  });

  describe('parseLabelsCsv', () => {
    it('returns 0 rows for a header-only CSV', () => {
      const rows = parseLabelsCsv(HEADER);
      expect(rows).toEqual([]);
    });

    it('parses two valid rows into LabelRow objects with parsed fields', () => {
      const text = [
        HEADER,
        'Q1,true,minor,jperez,2026-08-20T10:00:00.000Z',
        'Q2,false,major,jperez,2026-08-20T10:05:00.000Z',
      ].join('\n');
      const rows = parseLabelsCsv(text);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        caseId: 'Q1',
        factualClaimSupported: true,
        groundTruthSeverity: 'minor',
        labeledBy: 'jperez',
        labeledAt: '2026-08-20T10:00:00.000Z',
      });
      expect(rows[1]).toEqual({
        caseId: 'Q2',
        factualClaimSupported: false,
        groundTruthSeverity: 'major',
        labeledBy: 'jperez',
        labeledAt: '2026-08-20T10:05:00.000Z',
      });
    });

    it('throws LabelsParseError with the offending row index when caseId is empty', () => {
      const text = [
        HEADER,
        ',true,minor,jperez,2026-08-20T10:00:00.000Z',
      ].join('\n');
      expect(() => parseLabelsCsv(text)).toThrow(LabelsParseError);
      try {
        parseLabelsCsv(text);
      } catch (err) {
        expect(err).toBeInstanceOf(LabelsParseError);
        expect((err as LabelsParseError).rowIndex).toBe(1);
        expect((err as Error).message).toMatch(/row 1/);
      }
    });

    it('throws LabelsParseError when severity is invalid', () => {
      const text = [
        HEADER,
        'Q1,true,severe,jperez,2026-08-20T10:00:00.000Z',
      ].join('\n');
      expect(() => parseLabelsCsv(text)).toThrow(LabelsParseError);
    });

    it('throws LabelsParseError when datetime is not ISO 8601', () => {
      const text = [
        HEADER,
        'Q1,true,minor,jperez,not-a-date',
      ].join('\n');
      expect(() => parseLabelsCsv(text)).toThrow(LabelsParseError);
    });

    it('throws LabelsParseError when a row is missing a column', () => {
      const text = [
        HEADER,
        'Q1,true,minor,jperez',
      ].join('\n');
      expect(() => parseLabelsCsv(text)).toThrow(LabelsParseError);
    });

    it('tolerates trailing blank lines', () => {
      const text = [
        HEADER,
        'Q1,true,minor,jperez,2026-08-20T10:00:00.000Z',
        '',
      ].join('\n');
      const rows = parseLabelsCsv(text);
      expect(rows).toHaveLength(1);
      expect(rows[0].caseId).toBe('Q1');
    });
  });

  describe('LabelsParseError', () => {
    it('is an Error subclass with rowIndex + issue fields', () => {
      const err = new LabelsParseError({ rowIndex: 3, message: 'broken' });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(LabelsParseError);
      expect(err.name).toBe('LabelsParseError');
      expect(err.rowIndex).toBe(3);
      expect(err.message).toContain('broken');
    });
  });

  describe('loadLabelsFromFile', () => {
    it('reads + parses a CSV file from disk', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'eval-labels-'));
      try {
        const path = join(dir, 'labels.csv');
        writeFileSync(
          path,
          [
            HEADER,
            'Q1,true,minor,jperez,2026-08-20T10:00:00.000Z',
          ].join('\n'),
        );
        const rows = await loadLabelsFromFile(path);
        expect(rows).toHaveLength(1);
        expect(rows[0].caseId).toBe('Q1');
        expect(rows[0].factualClaimSupported).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('propagates LabelsParseError when the file content is malformed', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'eval-labels-'));
      try {
        const path = join(dir, 'labels.csv');
        writeFileSync(
          path,
          [
            HEADER,
            'Q1,true,severe,jperez,2026-08-20T10:00:00.000Z',
          ].join('\n'),
        );
        await expect(loadLabelsFromFile(path)).rejects.toThrow(LabelsParseError);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('rejects with a read error when the file is missing', async () => {
      await expect(
        loadLabelsFromFile('does-not-exist-1234567890.csv'),
      ).rejects.toThrow();
    });
  });
});
