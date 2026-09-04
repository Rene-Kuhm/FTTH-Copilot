/**
 * Phase F-4.3 — nightly metrics.
 *
 * Pure functions over `EvalRunSummary` (and `EvalCorpus` for coverage).
 * Used by the nightly leg (`eval-nightly.yml`) to report coverage,
 * abstention rate, and gate false-positives per tenant. PR CI uses the
 * `assertions` module for the same numerators under a strict threshold;
 * the metrics surface here is observational (never fails the job).
 *
 * Precision is TBD until the NOC tech lead labels
 * `docs/validation/agent-qa-log.md` as ground truth (Fase F decision #6);
 * the function returns `null` while labels are missing.
 */

import { evalSurfaceSchema, type EvalCorpus } from './corpus-schema';
import type { EvalRunSummary } from './runner';

const ALL_SURFACES = evalSurfaceSchema.options;

/**
 * Schema for the NOC tech lead's per-Q precision labels. F-7 will create
 * the actual `labels.csv`; until then the function returns `null` per
 * decision #6 (precision TBD until NOC labels exist).
 */
export interface PrecisionLabel {
  caseId: string;
  factualClaimSupported: boolean;
}

export type PrecisionLabels = ReadonlyArray<PrecisionLabel>;

/**
 * Returns the fraction of mapped surfaces represented in the corpus
 * (0..1; 1.0 = every surface has ≥1 case).
 *
 * Operates on the corpus directly (not the run summary) so a NOC report
 * can compute coverage before the runner runs. The PR gate uses the
 * `assertCoverage` helper from `assertions.ts` which operates on the
 * summary; both share the same `evalSurfaceSchema.options` enumeration.
 */
export function computeCoverage(corpus: EvalCorpus): number {
  const denominator: number = ALL_SURFACES.length > 0 ? ALL_SURFACES.length : 1;
  // The schema enforces `cases.length >= 1`, so we don't need to guard
  // against an empty corpus here — but the defensive denominator handles
  // a future revision that relaxes the bound.
  const present = new Set(corpus.cases.map((c) => c.surface));
  const hit = ALL_SURFACES.filter((s) => present.has(s)).length;
  return hit / denominator;
}

/**
 * Returns the precision ratio (factual-claim-supported / total-factual-claims).
 *
 * Returns `null` when `labels === null` OR when `labels` is empty — the
 * Fase F v1 default per decision #6 (precision TBD until NOC labels
 * exist). The nightly leg surfaces `null` as the literal string
 * `"TBD"` in the JSON report so operators can grep on the marker.
 *
 * Future v2: when `labels` is non-empty, the function counts cases
 * where `agentResult` makes a factual claim (i.e. `text` non-empty +
 * non-abstained) and divides by the count of those whose label marks
 * `factualClaimSupported: true`. v1 may keep returning `null` even when
 * labels exist; the contract is "non-null means precision was computed".
 */
export function computePrecision(
  summary: EvalRunSummary,
  labels: PrecisionLabels | null,
): number | null {
  if (labels === null || labels.length === 0) return null;
  const labelById = new Map<string, PrecisionLabel>();
  for (const l of labels) labelById.set(l.caseId, l);

  // Only count cases that make a factual claim: non-empty text + non-
  // abstained. This matches the spec's "factual claim" definition.
  const claimers = summary.results.filter(
    (r) =>
      typeof r.agentResult.text === 'string' &&
      r.agentResult.text.length > 0 &&
      r.gateDecision !== 'abstain',
  );
  if (claimers.length === 0) return 1.0;
  const supported = claimers.filter((r) => {
    const label = labelById.get(r.case.id);
    return label?.factualClaimSupported === true;
  }).length;
  return supported / claimers.length;
}

/**
 * Returns the fraction of cases where `gateDecision === 'abstain'`
 * (0..1). The nightly leg reports this per-tenant so the team can
 * track permissive-tenant drift without re-running the PR gate.
 */
export function computeAbstentionRate(summary: EvalRunSummary): number {
  if (summary.casesRun === 0) return 0.0;
  const abstained = summary.results.filter((r) => r.gateDecision === 'abstain').length;
  return abstained / summary.casesRun;
}

/**
 * Counts cases where `gateDecision === 'abstain'` but `caseId` is NOT in
 * `expectedSupportsAbstain` (i.e. the gate abstained when the label
 * expected it to answer).
 *
 * `expectedSupportsAbstain` is the set of case ids whose ground-truth
 * label agrees with the abstain gate. An empty set means "no ground
 * truth available" — the function returns 0 so the nightly job never
 * reports spurious FPs from unlabeled corpora (Fase F decision #6).
 *
 * Future v2 will accept a richer label map keyed by case id; v1 keeps
 * the API minimal (Set<string> + integer return).
 */
export function computeGateFalsePositives(
  summary: EvalRunSummary,
  expectedSupportsAbstain: ReadonlySet<string>,
): number {
  if (expectedSupportsAbstain.size === 0) return 0;
  let fp = 0;
  for (const r of summary.results) {
    if (r.gateDecision !== 'abstain') continue;
    if (!expectedSupportsAbstain.has(r.case.id)) fp++;
  }
  return fp;
}
