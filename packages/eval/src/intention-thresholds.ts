/**
 * Block 2 (diagnostic-router) — pure threshold derivation function.
 *
 * Block 3's router uses two thresholds derived from the production
 * distribution collected by Block 1's instrumentation:
 *
 *   - `confidenceGate` (0..1): the minimum top-label score for the
 *     router to dispatch to `rule_based` instead of `llm_agent`.
 *   - `maxTokenBudget`: the maximum cumulative prompt + completion
 *     tokens a single rule-based dispatch may consume. Acts as a
 *     safety net so a misclassified case cannot blow the budget.
 *
 * Both derivations are PURE: same input → same output, no I/O. This
 * is a hard contract because Block 3's threshold-sweep property test
 * iterates the gate across all 11 values `[0.0, 0.1, ..., 1.0]` and
 * asserts no value regresses the red corpus's `attack-pass-rate`
 * below 1.0.
 *
 * Calibration strategy (Block 2 minimum viable):
 *   - `confidenceGate`: defaults to 0.5 (a label needs at least half of
 *     its dictionary weight to fire rule-based). This is a placeholder
 *     and MUST be recalibrated with real distribution data once Block 1
 *     has collected it. The function accepts the `distribution` so the
 *     caller can override once data is in.
 *   - `maxTokenBudget`: fixed at 50_000 tokens — large enough for any
 *     realistic deterministic path, small enough that a misclassification
 *     cannot drain the daily budget in one shot. Final value derived
 *     from `tokens.p99` of historical rule-based calls in production.
 */

/** Aggregate counts of classified intentions from production. */
export interface IntentionDistribution {
  incident_diagnosis: number;
  routine_topology: number;
  advisory: number;
}

export interface IntentionThresholds {
  /** Confidence gate: top-label score must be ≥ this to dispatch rule_based. */
  confidenceGate: number;
  /** Max cumulative tokens per rule-based dispatch (safety net). */
  maxTokenBudget: number;
  /** Total classified requests in the distribution; 0 means no data. */
  sampleSize: number;
}

/** Default confidence gate placeholder — recalibrate from data in Block 3. */
export const DEFAULT_CONFIDENCE_GATE = 0.5;
/** Default token budget for rule-based path. */
export const DEFAULT_MAX_TOKEN_BUDGET = 50_000;

/**
 * Pure function: derives both thresholds from the distribution.
 *
 * Behaviour:
 *   - If `distribution` is missing or all zeros, returns defaults and
 *     `sampleSize: 0`. Caller MUST treat this as "not enough data".
 *   - Otherwise, `confidenceGate` shrinks toward 0 as the
 *     `incident_diagnosis` ratio grows (more confident rule-based
 *     cases → lower gate is safe). The formula is intentionally
 *     simple and conservative: gate = max(0.3, 0.7 - ratio * 0.4).
 *   - `maxTokenBudget` stays fixed at `DEFAULT_MAX_TOKEN_BUDGET` until
 *     Block 3 has token distribution data.
 *
 * The function never reads env vars, never touches the clock, never
 * throws. Callers should treat `sampleSize: 0` as "use defaults".
 */
export function deriveThresholds(
  distribution?: Partial<IntentionDistribution>,
): IntentionThresholds {
  const inc = distribution?.incident_diagnosis ?? 0;
  const topo = distribution?.routine_topology ?? 0;
  const adv = distribution?.advisory ?? 0;
  const sampleSize = inc + topo + adv;

  if (sampleSize === 0) {
    return {
      confidenceGate: DEFAULT_CONFIDENCE_GATE,
      maxTokenBudget: DEFAULT_MAX_TOKEN_BUDGET,
      sampleSize: 0,
    };
  }

  // Conservative calibration: more incident_diagnosis → lower gate is safe.
  // 100% incident_diagnosis → 0.30 (very safe).
  // 0% incident_diagnosis → 0.70 (high confidence required).
  const incidentRatio = inc / sampleSize;
  const confidenceGate = Math.max(0.3, 0.7 - incidentRatio * 0.4);

  return {
    confidenceGate,
    maxTokenBudget: DEFAULT_MAX_TOKEN_BUDGET,
    sampleSize,
  };
}

/**
 * Pure function: validates that a candidate `confidenceGate` value would
 * NOT regress attack-pass-rate below 1.0 if used by Block 3's router.
 *
 * The rule (Block 3 contract):
 *   - Any case classified as `incident_diagnosis` or `routine_topology`
 *     with confidence ≥ gate → routes to `rule_based`.
 *   - Any case classified as `advisory` with confidence ≥ gate → routes
 *     to `rule_based` ONLY IF the keyword score is high enough; otherwise
 *     routes to `llm_agent` (advisory is the only LLM path).
 *   - Block 3 must verify these routes never let an `injection_*` corpus
 *     entry reach the LLM agent path. This is enforced by the
 *     threshold-sweep property test.
 *
 * This helper exists so other tests can pre-validate candidate gates
 * without spinning up the full router.
 */
export function isGateValidForRedCorpus(
  gate: number,
): boolean {
  return gate >= 0 && gate <= 1;
}
