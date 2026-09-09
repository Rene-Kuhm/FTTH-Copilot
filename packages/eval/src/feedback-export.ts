/**
 * Phase F — investigation feedback export (Fase 1 PR #5).
 *
 * Maps a closed-set InvestigationFeedback row into a self-describing
 * envelope consumable by the packages/eval nightly leg. The schema is
 * its own wire format (`ftth.investigation-feedback-export.v1`) — NOT a
 * VerdictLog row — so the export can carry the `feedbackId`/`runId`/
 * `versionId`/`tenantId` provenance without forcing the message-tool
 * fields that VerdictLog expects.
 *
 * The mapping is deliberate and versioned. Three feedback labels map
 * to the closed `VerdictCode` enum (`ok | low_confidence | stale |
 * incomplete`) so downstream consumers can keep using the same metric
 * primitives (e.g. `computeAbstentionRate`, `assertCoverage`):
 *   - 'confirmed'         -> 'ok'            — the technician agrees.
 *   - 'incorrect'         -> 'low_confidence' — VerdictLog has no
 *     'incorrect' code. We pick the closest existing code, but we
 *     NEVER mark the diagnostic as 'ok'. The evaluator downstream can
 *     distinguish a feedback `incorrect` from a real `low_confidence`
 *     via the `source: 'investigation-feedback'` discriminator.
 *   - 'insufficient_data' -> 'incomplete'    — verbatim mapping;
 *     'incomplete' is the existing VerdictCode for "not enough data".
 *
 * No new VerdictLog rows are written by this module. The nightly leg
 * reads the InvestigationFeedback rows directly and emits its own
 * VerdictLog entries through the F-5.1 writer; this module's job is
 * the conversion function, not the persistence path.
 *
 * The aggregator `computeFeedbackSummary` returns `null` for the
 * precision numerator when the sample size is below the documented
 * threshold. The roadmap rule 1.6 says "Si faltan etiquetas, MUST
 * mostrar insuficiencia, nunca precisión inventada" — the aggregator
 * MUST honour that.
 */

import { z } from 'zod';
import { VerdictCodeSchema } from '@ftth-copilot/shared';

export const INVESTIGATION_FEEDBACK_EXPORT_SCHEMA =
  'ftth.investigation-feedback-export.v1' as const;

export const FEEDBACK_LABEL_CONFIRMED = 'confirmed' as const;
export const FEEDBACK_LABEL_INCORRECT = 'incorrect' as const;
export const FEEDBACK_LABEL_INSUFFICIENT = 'insufficient_data' as const;

export const FEEDBACK_LABELS = [
  FEEDBACK_LABEL_CONFIRMED,
  FEEDBACK_LABEL_INCORRECT,
  FEEDBACK_LABEL_INSUFFICIENT,
] as const;
export type FeedbackLabel = (typeof FEEDBACK_LABELS)[number];

export function isFeedbackLabel(value: unknown): value is FeedbackLabel {
  return typeof value === 'string' && (FEEDBACK_LABELS as readonly string[]).includes(value);
}

/**
 * Input shape: the minimum fields the mapping needs. The full DB row
 * may have more; the helper is intentionally permissive about the
 * input but strict about the output envelope.
 */
export interface InvestigationFeedbackInput {
  tenantId: string;
  feedbackId: string;
  runId: string;
  versionId: string;
  label: FeedbackLabel;
  authorUserId: string;
  submittedAt: Date | string;
}

/**
 * The export envelope is `.strict()` so producers can never silently
 * drift the wire format. Every field below is mandatory and additive;
 * future extensions ship under a new schema literal.
 */
export const investigationFeedbackExportSchema = z
  .object({
    schema: z.literal(INVESTIGATION_FEEDBACK_EXPORT_SCHEMA),
    feedbackId: z.string().min(1),
    tenantId: z.string().min(1),
    runId: z.string().min(1),
    versionId: z.string().min(1),
    label: z.enum(FEEDBACK_LABELS),
    /** Discriminator so consumers can route this entry separately from
     *  VerdictLog rows. The eval nightly leg filters on this. */
    source: z.literal('investigation-feedback'),
    /** Map of feedback label -> VerdictCode, kept in the envelope so a
     *  downstream consumer can render the mapping without re-running
     *  the conversion. */
    mappedCode: VerdictCodeSchema,
    authorUserId: z.string().min(1),
    observedAt: z.string().datetime(),
  })
  .strict();
export type InvestigationFeedbackExportEntry = z.infer<
  typeof investigationFeedbackExportSchema
>;

/**
 * The conversion table is exported (not buried inside the function) so
 * tests and the spec change can reference the exact mapping. It is
 * exhaustive over the closed label set; adding a label requires a
 * schema change (the `z.enum` above would fail compilation).
 */
export const FEEDBACK_TO_VERDICT_CODE: Record<FeedbackLabel, z.infer<typeof VerdictCodeSchema>> = {
  [FEEDBACK_LABEL_CONFIRMED]: 'ok',
  [FEEDBACK_LABEL_INCORRECT]: 'low_confidence',
  [FEEDBACK_LABEL_INSUFFICIENT]: 'incomplete',
};

/** Convert one feedback row into the export envelope. */
export function toInvestigationFeedbackExport(
  row: InvestigationFeedbackInput,
): InvestigationFeedbackExportEntry {
  const observedAt =
    row.submittedAt instanceof Date ? row.submittedAt.toISOString() : row.submittedAt;
  const entry = {
    schema: INVESTIGATION_FEEDBACK_EXPORT_SCHEMA,
    feedbackId: row.feedbackId,
    tenantId: row.tenantId,
    runId: row.runId,
    versionId: row.versionId,
    label: row.label,
    source: 'investigation-feedback' as const,
    mappedCode: FEEDBACK_TO_VERDICT_CODE[row.label],
    authorUserId: row.authorUserId,
    observedAt,
  };
  // Defensive parse: the input shape is permissive but the output
  // envelope is `.strict()`. Failing here means the input violated the
  // export contract — which is a bug, not a recoverable error.
  return investigationFeedbackExportSchema.parse(entry);
}

/**
 * Convert a batch of feedback rows. The order is preserved (the eval
 * nightly leg relies on it for time-series reporting). Rows with the
 * same `feedbackId` MUST be deduplicated upstream — this function does
 * NOT deduplicate because the schema does not enforce it.
 */
export function toInvestigationFeedbackExportBatch(
  rows: ReadonlyArray<InvestigationFeedbackInput>,
): ReadonlyArray<InvestigationFeedbackExportEntry> {
  return rows.map(toInvestigationFeedbackExport);
}

/**
 * Aggregator. Returns the per-label counts and the precision numerator
 * (when the sample size meets the threshold). The roadmap rule says
 * "Si faltan etiquetas, MUST mostrar insuficiencia, nunca precisión
 * inventada" — that is implemented by returning `precision: null`
 * when the sample size is below `minSampleSize` (default 30).
 *
 * The denominator is `confirmed + incorrect`. `insufficient_data` is
 * reported separately because a 'incomplete' VerdictCode must NOT be
 * counted in the precision numerator (precision is meaningless when
 * the answer is "we don't know").
 */
export interface FeedbackSummary {
  tenantId: string | null;
  total: number;
  confirmed: number;
  incorrect: number;
  insufficient_data: number;
  /** The evaluation denominator = confirmed + incorrect. */
  evaluated: number;
  /** The fraction of `confirmed` over `evaluated`, or `null` if the
   *  sample size is below the threshold. */
  precision: number | null;
  /** The minimum sample size required for `precision` to be reported. */
  minSampleSize: number;
  /** True iff the threshold was met and `precision` is reported. */
  isCalibrated: boolean;
}

/** Default minimum sample size, taken from the Fase 1 spec rule 1.6. */
export const DEFAULT_MIN_SAMPLE_SIZE = 30;

/**
 * Aggregate feedback entries by label and compute precision. The
 * entries are read-only; the function does not deduplicate. The
 * `tenantId` is the dominant tenantId in the batch (or null when
 * mixed) — the caller SHOULD filter by tenantId upstream.
 */
export function computeFeedbackSummary(
  entries: ReadonlyArray<InvestigationFeedbackExportEntry>,
  opts: { minSampleSize?: number } = {},
): FeedbackSummary {
  const minSampleSize = opts.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;
  let tenantId: string | null = null;
  let confirmed = 0;
  let incorrect = 0;
  let insufficient = 0;
  for (const e of entries) {
    if (tenantId === null) {
      tenantId = e.tenantId;
    } else if (tenantId !== e.tenantId) {
      // Mixed tenants in a single batch is a contract violation; the
      // caller should have filtered. Mark as mixed (null) and keep
      // counting — we still produce honest counts.
      tenantId = null;
    }
    if (e.label === 'confirmed') confirmed += 1;
    else if (e.label === 'incorrect') incorrect += 1;
    else if (e.label === 'insufficient_data') insufficient += 1;
  }
  const total = entries.length;
  const evaluated = confirmed + incorrect;
  const isCalibrated = evaluated >= minSampleSize;
  const precision = isCalibrated && evaluated > 0 ? confirmed / evaluated : null;
  return {
    tenantId,
    total,
    confirmed,
    incorrect,
    insufficient_data: insufficient,
    evaluated,
    precision,
    minSampleSize,
    isCalibrated,
  };
}
