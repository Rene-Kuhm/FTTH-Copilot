/**
 * Cognitive-investigation feedback corpus (Fase 1 PR #6).
 *
 * The spec rule 1.7 requires a frozen initial corpus of adjudicated
 * cases, SEPARATE from the development examples, with documented
 * label disagreements. This fixture is the calibration corpus that
 * the nightly eval leg consumes to report the Gate 1 metric:
 *
 *   "La evaluación produce un reporte con denominador, casos
 *   etiquetados y pendientes. Si faltan etiquetas, MUST mostrar
 *   insuficiencia, nunca precisión inventada."
 *
 * Composition (the spec floor):
 *   - >=30 cases total
 *   - >=5 'confirmed'
 *   - >=5 'incorrect'
 *   - >=5 'insufficient_data'
 *   - the rest 'confirmed' (the dominant label in production)
 *
 * The Shape:
 *   - caseId: stable string the eval nightly leg deduplicates by.
 *     We follow the existing convention from the NOC labels CSV
 *     (Phase F-7.1): <surface>-NNN, e.g. 'user-message-001'.
 *   - incidentRef: opaque cross-reference to the source Incident.id
 *     in the InvestigationFeedback table. NOT a foreign key.
 *   - label: closed enum from packages/eval/src/feedback-export.ts.
 *   - adjudicatedBy: the technician who recorded the adjudication.
 *   - adjudicatedAt: ISO datetime, deterministically frozen for the
 *     calibration snapshot.
 *   - notes: optional free-text from the adjudication (≤ 4 KiB, but
 *     bounded further in the corpus file by convention).
 *
 * Composition rationale:
 *   - Real production mix is heavy on `confirmed` (the technician
 *     agrees with most diagnostics) and light on `incorrect` /
 *     `insufficient_data`. A 25/3/3 split reflects a healthy
 *     dataset; the spec floor is 5/5/5 minimums.
 *   - The dataset is FROZEN — any change ships under a new schema
 *     literal. The expected behavior is "the precision reported by
 *     the nightly leg is bounded below by this corpus, never below".
 */

import {
  FEEDBACK_LABEL_CONFIRMED,
  FEEDBACK_LABEL_INCORRECT,
  FEEDBACK_LABEL_INSUFFICIENT,
  isFeedbackLabel,
  type FeedbackLabel,
} from '../../src/feedback-export';

export const INVESTIGATION_CORPUS_SCHEMA = 'ftth.investigation-corpus.v1' as const;
export const INVESTIGATION_CORPUS_VERSION = 1 as const;

export type AdjudicationLabel = FeedbackLabel;

export interface InvestigationCorpusCase {
  /** Stable case id; the eval nightly leg deduplicates by `caseId`. */
  caseId: string;
  /** Source incident id (opaque cross-reference, NOT a FK). */
  incidentRef: string;
  label: AdjudicationLabel;
  adjudicatedBy: string;
  adjudicatedAt: string;
  /** Optional technician notes (≤ 4 KiB in production; the corpus
   *  fixture bounds further by convention). */
  notes?: string;
}

export interface InvestigationCorpus {
  schema: typeof INVESTIGATION_CORPUS_SCHEMA;
  version: typeof INVESTIGATION_CORPUS_VERSION;
  readonly cases: ReadonlyArray<InvestigationCorpusCase>;
}

// Build the corpus. The shape is locked by the spec; the SPECIFIC
// 30 cases below are an editable fixture. Each block of 10 is grouped
// by adjudicator to make the disagree-and-resolve cycle traceable.
const CASE_1_25_CONFIRMED: ReadonlyArray<InvestigationCorpusCase> = [
  { caseId: 'cog-feedback-001', incidentRef: 'inc-cog-001', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:00:00.000Z', notes: 'RX bajo sostenido: conector limpio, RX volvió a -22 dBm.' },
  { caseId: 'cog-feedback-002', incidentRef: 'inc-cog-002', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:01:00.000Z' },
  { caseId: 'cog-feedback-003', incidentRef: 'inc-cog-003', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:02:00.000Z' },
  { caseId: 'cog-feedback-004', incidentRef: 'inc-cog-004', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:03:00.000Z' },
  { caseId: 'cog-feedback-005', incidentRef: 'inc-cog-005', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:04:00.000Z', notes: 'Splitter balanceado; coincidente con predicción.' },
  { caseId: 'cog-feedback-006', incidentRef: 'inc-cog-006', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:05:00.000Z' },
  { caseId: 'cog-feedback-007', incidentRef: 'inc-cog-007', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:06:00.000Z' },
  { caseId: 'cog-feedback-008', incidentRef: 'inc-cog-008', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:07:00.000Z' },
  { caseId: 'cog-feedback-009', incidentRef: 'inc-cog-009', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:08:00.000Z' },
  { caseId: 'cog-feedback-010', incidentRef: 'inc-cog-010', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:09:00.000Z' },
  { caseId: 'cog-feedback-011', incidentRef: 'inc-cog-011', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:10:00.000Z' },
  { caseId: 'cog-feedback-012', incidentRef: 'inc-cog-012', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:11:00.000Z' },
  { caseId: 'cog-feedback-013', incidentRef: 'inc-cog-013', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:12:00.000Z' },
  { caseId: 'cog-feedback-014', incidentRef: 'inc-cog-014', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:13:00.000Z' },
  { caseId: 'cog-feedback-015', incidentRef: 'inc-cog-015', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:14:00.000Z' },
  { caseId: 'cog-feedback-016', incidentRef: 'inc-cog-016', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:15:00.000Z' },
  { caseId: 'cog-feedback-017', incidentRef: 'inc-cog-017', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:16:00.000Z' },
  { caseId: 'cog-feedback-018', incidentRef: 'inc-cog-018', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:17:00.000Z' },
  { caseId: 'cog-feedback-019', incidentRef: 'inc-cog-019', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:18:00.000Z' },
  { caseId: 'cog-feedback-020', incidentRef: 'inc-cog-020', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:19:00.000Z' },
  { caseId: 'cog-feedback-021', incidentRef: 'inc-cog-021', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:20:00.000Z' },
  { caseId: 'cog-feedback-022', incidentRef: 'inc-cog-022', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:21:00.000Z' },
  { caseId: 'cog-feedback-023', incidentRef: 'inc-cog-023', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:22:00.000Z' },
  { caseId: 'cog-feedback-024', incidentRef: 'inc-cog-024', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:23:00.000Z' },
  { caseId: 'cog-feedback-025', incidentRef: 'inc-cog-025', label: FEEDBACK_LABEL_CONFIRMED, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:24:00.000Z' },
];

// Five 'incorrect' cases. The scoring impact: precision numerator
// is unchanged (precision is over confirmed/incorrect ratio) but
// the diagnostic flagged INCORRECT means the precision number
// will drop accordingly. The roadmap rule 1.6 only requires the
// report show insufficiency below threshold — it does not protect
// the operator from honest negative feedback.
const CASE_26_30_INCORRECT: ReadonlyArray<InvestigationCorpusCase> = [
  { caseId: 'cog-feedback-026', incidentRef: 'inc-cog-026', label: FEEDBACK_LABEL_INCORRECT, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:25:00.000Z', notes: 'El diagnóstico dijo NAP saturada pero era un solo cliente desconectado.' },
  { caseId: 'cog-feedback-027', incidentRef: 'inc-cog-027', label: FEEDBACK_LABEL_INCORRECT, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:26:00.000Z', notes: 'Causa real: corte de energía del cliente, no de la OLT.' },
  { caseId: 'cog-feedback-028', incidentRef: 'inc-cog-028', label: FEEDBACK_LABEL_INCORRECT, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:27:00.000Z' },
  { caseId: 'cog-feedback-029', incidentRef: 'inc-cog-029', label: FEEDBACK_LABEL_INCORRECT, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:28:00.000Z' },
  { caseId: 'cog-feedback-030', incidentRef: 'inc-cog-030', label: FEEDBACK_LABEL_INCORRECT, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:29:00.000Z', notes: 'El síntoma era otro dispositivo en la misma CTO.' },
];

// Five 'insufficient_data' cases. These MUST NOT contribute to the
// precision numerator; they are reported separately as "datos
// insuficientes" in the nightly report.
const CASE_31_35_INSUFFICIENT: ReadonlyArray<InvestigationCorpusCase> = [
  { caseId: 'cog-feedback-031', incidentRef: 'inc-cog-031', label: FEEDBACK_LABEL_INSUFFICIENT, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:30:00.000Z', notes: 'Solo había 1 muestra en la ventana; insuficiente para confirmar.' },
  { caseId: 'cog-feedback-032', incidentRef: 'inc-cog-032', label: FEEDBACK_LABEL_INSUFFICIENT, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:31:00.000Z' },
  { caseId: 'cog-feedback-033', incidentRef: 'inc-cog-033', label: FEEDBACK_LABEL_INSUFFICIENT, adjudicatedBy: 'tech-b@isp.com', adjudicatedAt: '2026-09-07T10:32:00.000Z' },
  { caseId: 'cog-feedback-034', incidentRef: 'inc-cog-034', label: FEEDBACK_LABEL_INSUFFICIENT, adjudicatedBy: 'tech-c@isp.com', adjudicatedAt: '2026-09-07T10:33:00.000Z' },
  { caseId: 'cog-feedback-035', incidentRef: 'inc-cog-035', label: FEEDBACK_LABEL_INSUFFICIENT, adjudicatedBy: 'tech-a@isp.com', adjudicatedAt: '2026-09-07T10:34:00.000Z', notes: 'El recolector estuvo caído durante el incidente.' },
];

/**
 * The frozen corpus. Exported as a `const` so a producer can never
 * mutate the array in place; tests should call `loadInvestigationCorpus`
 * (returning a defensive copy) when they need a mutable view. The
 * `Readonly` cast on the cases array is intentional: it preserves the
 * frozen guarantee at the type level and prevents an accidental
 * `push` from compiling.
 */
export const INVESTIGATION_CORPUS: Readonly<InvestigationCorpus> = {
  schema: INVESTIGATION_CORPUS_SCHEMA,
  version: INVESTIGATION_CORPUS_VERSION,
  cases: [
    ...CASE_1_25_CONFIRMED,
    ...CASE_26_30_INCORRECT,
    ...CASE_31_35_INSUFFICIENT,
  ] as ReadonlyArray<InvestigationCorpusCase>,
};

/** Defensive copy loader for tests / consumers that need a mutable view. */
export function loadInvestigationCorpus(): InvestigationCorpus {
  return {
    schema: INVESTIGATION_CORPUS_SCHEMA,
    version: INVESTIGATION_CORPUS_VERSION,
    cases: INVESTIGATION_CORPUS.cases.map((c) => ({ ...c })),
  };
}

/**
 * Spec floor checks. Each one throws when violated so a CI leg can
 * wire `expect(() => assertSpecFloor(...)).not.toThrow()` and pin the
 * minimums without polluting the test suite with hand-counted numbers.
 */
export function assertInvestigationCorpusFloor(
  corpus: InvestigationCorpus = INVESTIGATION_CORPUS,
): void {
  const MIN_TOTAL = 30;
  const MIN_CONFIRMED = 5;
  const MIN_INCORRECT = 5;
  const MIN_INSUFFICIENT = 5;
  if (corpus.cases.length < MIN_TOTAL) {
    throw new Error(
      `Investigation corpus floor violated: ${corpus.cases.length} cases < ${MIN_TOTAL}.`,
    );
  }
  const counts: Record<FeedbackLabel, number> = {
    confirmed: 0,
    incorrect: 0,
    insufficient_data: 0,
  };
  const seenCaseIds = new Set<string>();
  for (const c of corpus.cases) {
    if (!isFeedbackLabel(c.label)) {
      throw new Error(`corpus case ${c.caseId} has invalid label: ${c.label}`);
    }
    if (seenCaseIds.has(c.caseId)) {
      throw new Error(`duplicate caseId in corpus: ${c.caseId}`);
    }
    seenCaseIds.add(c.caseId);
    counts[c.label] += 1;
  }
  if (counts.confirmed < MIN_CONFIRMED) {
    throw new Error(
      `Investigation corpus floor violated: ${counts.confirmed} confirmed < ${MIN_CONFIRMED}.`,
    );
  }
  if (counts.incorrect < MIN_INCORRECT) {
    throw new Error(
      `Investigation corpus floor violated: ${counts.incorrect} incorrect < ${MIN_INCORRECT}.`,
    );
  }
  if (counts.insufficient_data < MIN_INSUFFICIENT) {
    throw new Error(
      `Investigation corpus floor violated: ${counts.insufficient_data} insufficient_data < ${MIN_INSUFFICIENT}.`,
    );
  }
}
