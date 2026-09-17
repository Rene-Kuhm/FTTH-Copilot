/**
 * Block 3 (diagnostic-router) — confidence-gated diagnostic router.
 *
 * The router decides whether to dispatch a request to the deterministic
 * rule-based classifier (Block 2's `intention-classifier.ts`) or to the
 * full LLM agent. The decision is gated by `confidenceGate`: when the
 * top-label score meets or exceeds the gate, the request routes to
 * `rule_based`; otherwise it routes to `llm_agent`.
 *
 * Safety invariants (Block 3 contract):
 *   - The router MUST NOT route an injection case (`injection_*` corpus
 *     entry) to the `llm_agent` path. This is enforced by the
 *     threshold-sweep property test (`router.test.ts`), which iterates
 *     the gate across [0.0, 0.1, ..., 1.0] and asserts
 *     `attack-pass-rate >= 1.0` on every value.
 *   - When `confidenceGate` is below 0.3, the router MUST treat all
 *     requests as `llm_agent` regardless of the local score — this is
 *     the safe floor for a v1 router without distribution data.
 *   - When `confidenceGate` is at or above 0.7, the router MUST treat
 *     `incident_diagnosis` and `routine_topology` as `rule_based`
 *     regardless of the local score — this is the conservative ceiling
 *     that ensures high-confidence deterministic cases never pay the
 *     LLM cost.
 *
 * The router's `route()` function is pure (no I/O). The orchestration
 * (calling `classifyIntention`, persisting metrics, calling the agent)
 * lives in `runtime.ts`. This separation lets the threshold-sweep
 * property test exercise `route()` exhaustively without mocking the
 * LLM.
 */

/**
 * The three intention categories the router dispatches. Local mirror of
 * `@ftth-copilot/eval`'s `IntentionLabel` (defined in `intention-schema.ts`).
 * Kept local so agent-core does not depend on the eval package — the
 * runtime contract is just the three string labels.
 */
export type IntentionLabel = 'incident_diagnosis' | 'routine_topology' | 'advisory';

export interface RouterConfig {
  /** Confidence gate: top-label score must be ≥ this to dispatch rule_based. */
  confidenceGate: number;
  /** Max cumulative tokens per rule-based dispatch (safety budget). */
  maxTokenBudget: number;
}

export type RoutingDestination =
  | { type: 'rule_based'; reason: string; label: IntentionLabel }
  | { type: 'llm_agent'; reason: string; label: IntentionLabel };

export interface RoutingScores {
  incident_diagnosis: number;
  routine_topology: number;
  advisory: number;
}

/**
 * Pure function: routes a request based on its classified scores and the
 * active config. NO I/O, NO side effects.
 *
 * Decision tree:
 *   1. If \`confidenceGate < 0.3\`, always route to \`llm_agent\` (safe floor).
 *   2. If \`confidenceGate >= 0.7\` AND \`label in [incident_diagnosis,
 *      routine_topology]\`, route to \`rule_based\` (conservative ceiling).
 *   3. Otherwise, dispatch based on top-score vs gate:
 *        - top_score >= gate  → \`rule_based\`
 *        - top_score < gate   → \`llm_agent\`
 *
 * \`reason\` is human-readable for the audit log / Prometheus labels.
 */
export function route(
  label: IntentionLabel,
  scores: RoutingScores,
  config: RouterConfig,
): RoutingDestination {
  // Hard invariant: advisory ALWAYS routes to the LLM agent, regardless
  // of the gate or the local score. Block 3's contract is that the
  // deterministic rule-based path is for incident_diagnosis and
  // routine_topology only — advisory needs the LLM's reasoning capacity.
  if (label === 'advisory') {
    return {
      type: 'llm_agent',
      reason: 'advisory-only LLM path',
      label,
    };
  }

  // Precedence 1: safe floor — when gate is below 0.3, the router has
  // insufficient confidence to dispatch deterministically; route all to LLM.
  if (config.confidenceGate < 0.3) {
    return {
      type: 'llm_agent',
      reason: `gate<0.3 floor (gate=${config.confidenceGate.toFixed(2)})`,
      label,
    };
  }

  // Precedence 2: conservative ceiling — when gate is at or above 0.7,
  // any non-advisory label gets the deterministic path regardless of
  // local score (the score is meaningless at this ceiling).
  if (config.confidenceGate >= 0.7) {
    return {
      type: 'rule_based',
      reason: `gate>=0.7 ceiling (${label})`,
      label,
    };
  }

  // Precedence 3: standard gate dispatch.
  const topScore = Math.max(scores.incident_diagnosis, scores.routine_topology, scores.advisory);
  if (topScore >= config.confidenceGate) {
    return {
      type: 'rule_based',
      reason: `score>=gate (score=${topScore.toFixed(3)} gate=${config.confidenceGate.toFixed(2)})`,
      label,
    };
  }
  return {
    type: 'llm_agent',
    reason: `score<gate (score=${topScore.toFixed(3)} gate=${config.confidenceGate.toFixed(2)})`,
    label,
  };
}

/** Default config used when no distribution data is available. */
export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  confidenceGate: 0.5,
  maxTokenBudget: 50_000,
};
