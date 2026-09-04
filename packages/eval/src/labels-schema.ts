/**
 * Phase F-7.1 — labels CSV schema + parser.
 *
 * The labels CSV (`docs/validation/labels.csv`) is the single source of
 * truth for the `precision` ground truth in the nightly metrics summary.
 * The NOC tech lead labels each row by hand (case id + whether the agent's
 * factual claim was supported + severity + their name + the timestamp).
 * The parser converts that CSV into a typed `LabelRow[]` so the
 * metrics-report can feed it into `computePrecision` (F-4.3).
 *
 * Wire format:
 *
 *   case_id,factual_claim_supported,ground_truth_severity,labeled_by,labeled_at
 *   Q1,true,minor,jperez,2026-08-20T10:00:00.000Z
 *   Q2,false,major,jperez,2026-08-20T10:05:00.000Z
 *
 * Columns:
 *   - case_id                 : non-empty stable string; must match the
 *                                corpus case id (e.g. `pink-user-message-001`)
 *   - factual_claim_supported : literal `true` or `false`
 *   - ground_truth_severity   : one of `critical`, `major`, `minor`, `none`
 *   - labeled_by              : non-empty string; the operator's handle
 *   - labeled_at              : ISO-8601 datetime (UTC preferred)
 *
 * The header row is mandatory and column order is fixed. The CSV is
 * intentionally minimal — no quoted values, no escapes — because the
 * operator is editing by hand and `split(',')` keeps the diff reviewable.
 *
 * Why a separate schema + parser split:
 *   The zod schema (`labelsCsvSchema`) is the typed contract consumers
 *   import. The parser (`parseLabelsCsv`) is the CSV → schema adapter.
 *   `loadLabelsFromFile` is the I/O wrapper for the nightly leg.
 */

import { readFile } from 'node:fs/promises';
import { z } from 'zod';

// ── Header + zod schema ─────────────────────────────────────────────────────

/**
 * Canonical header line. Whitespace-tolerant on read but emitted exactly
 * as written in `docs/validation/labels.csv`. Order is fixed; the parser
 * rejects any deviation with `LabelsParseError`.
 */
export const LABELS_CSV_HEADER = [
  'case_id',
  'factual_claim_supported',
  'ground_truth_severity',
  'labeled_by',
  'labeled_at',
] as const;

/**
 * Zod schema for a single labels CSV row. Strict mode rejects unknown
 * keys so the wire format can never drift across the CSV ↔ parser ↔
 * consumer boundary.
 *
 * Field semantics:
 *   - caseId                 : non-empty stable string (corpus case id)
 *   - factualClaimSupported  : boolean — whether the agent's factual
 *                              claim was supported by the ground truth
 *   - groundTruthSeverity    : one of `critical`, `major`, `minor`,
 *                              `none`; used for FP / FN triage downstream
 *   - labeledBy              : non-empty string — operator handle
 *   - labeledAt              : ISO-8601 datetime
 */
export const labelsCsvSchema = z
  .object({
    caseId: z.string().min(1),
    factualClaimSupported: z.boolean(),
    groundTruthSeverity: z.enum(['critical', 'major', 'minor', 'none']),
    labeledBy: z.string().min(1),
    labeledAt: z.string().datetime(),
  })
  .strict();

/** Inferred row type. Re-exported via the package barrel. */
export type LabelRow = z.infer<typeof labelsCsvSchema>;

// ── Error class ──────────────────────────────────────────────────────────────

/**
 * Typed error for the labels CSV parser. Carries the offending `rowIndex`
 * (0 = header, 1..N = data rows) and the underlying zod issue (when the
 * failure is a schema rejection) so PR logs can grep on `rowIndex`.
 */
export class LabelsParseError extends Error {
  public readonly rowIndex: number;
  public readonly issue?: unknown;

  constructor(args: { rowIndex: number; message: string; issue?: unknown }) {
    super(args.message);
    this.name = 'LabelsParseError';
    this.rowIndex = args.rowIndex;
    this.issue = args.issue;
    // Restore the prototype chain for `instanceof` after extending Error.
    Object.setPrototypeOf(this, LabelsParseError.prototype);
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Convert the raw string value of `factual_claim_supported` into a
 * boolean. Anything other than the literal `true` / `false` is a
 * schema violation — we surface it via `LabelsParseError` with the
 * offending row index so the operator can find the bad cell.
 */
function parseBoolColumn(value: string, rowIndex: number): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new LabelsParseError({
    rowIndex,
    message: `LabelsParseError: row ${rowIndex}: invalid boolean for 'factual_claim_supported': expected 'true' or 'false', got '${value}'`,
    issue: 'invalid_boolean',
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a CSV string into a typed `LabelRow[]`. Empty / header-only input
 * yields an empty array. Any deviation from the canonical schema
 * (missing column, invalid severity, non-ISO datetime, etc.) throws
 * `LabelsParseError` with the offending row index.
 *
 * The function is pure (no I/O) so the test suite can drive it with
 * inline strings. `loadLabelsFromFile` is the async I/O wrapper.
 */
export function parseLabelsCsv(text: string): LabelRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  // Validate the header row (row index 0 — not a data row).
  const header = lines[0].split(',').map((cell) => cell.trim());
  if (header.length !== LABELS_CSV_HEADER.length) {
    throw new LabelsParseError({
      rowIndex: 0,
      message: `LabelsParseError: header has ${header.length} columns, expected ${LABELS_CSV_HEADER.length}`,
      issue: 'header_column_count',
    });
  }
  for (let i = 0; i < LABELS_CSV_HEADER.length; i++) {
    if (header[i] !== LABELS_CSV_HEADER[i]) {
      throw new LabelsParseError({
        rowIndex: 0,
        message: `LabelsParseError: header column ${i} expected '${LABELS_CSV_HEADER[i]}' got '${header[i]}'`,
        issue: 'header_mismatch',
      });
    }
  }

  // Parse + validate each data row. `i + 1` is the human-readable row
  // index (the header is line 0 in the source file).
  const rows: LabelRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((cell) => cell.trim());
    if (cells.length !== LABELS_CSV_HEADER.length) {
      throw new LabelsParseError({
        rowIndex: i,
        message: `LabelsParseError: row ${i} has ${cells.length} columns, expected ${LABELS_CSV_HEADER.length}`,
        issue: 'column_count_mismatch',
      });
    }
    const candidate = {
      caseId: cells[0],
      factualClaimSupported: parseBoolColumn(cells[1], i),
      groundTruthSeverity: cells[2],
      labeledBy: cells[3],
      labeledAt: cells[4],
    };
    const result = labelsCsvSchema.safeParse(candidate);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      throw new LabelsParseError({
        rowIndex: i,
        message: `LabelsParseError: row ${i} failed schema validation: ${firstIssue?.message ?? 'unknown'}`,
        issue: firstIssue,
      });
    }
    rows.push(result.data);
  }

  return rows;
}

/**
 * Read + parse the labels CSV at `path`. Async by design (mirrors
 * `loadCorpus`) so a future swap to a remote source keeps the call site
 * unchanged. Throws `LabelsParseError` when the content is malformed;
 * the underlying read error surfaces verbatim otherwise.
 */
export async function loadLabelsFromFile(path: string): Promise<LabelRow[]> {
  const text = await readFile(path, 'utf8');
  return parseLabelsCsv(text);
}
