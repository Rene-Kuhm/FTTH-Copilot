/**
 * @ftth-copilot/evidence — Fase B (Truth Gate, observation mode) + Fase C
 * (strict-mode abstention policy).
 *
 * Pure envelope classification for `evidence.provenance.v1` tool results
 * and pure abstention-policy functions for the asymmetric strict-mode
 * override. Verdicts are recorded but never gate the data flow to the LLM
 * (observe mode). Strict mode is enforced one layer up in
 * `@ftth-copilot/agent-core`.
 */
export type { Verdict, VerdictCode, VerdictSeverity } from './types';
export { classifyEnvelope, classifyUnwrapped } from './truth-gate';

// ── Fase C — strict-mode abstention policy ──────────────────────────────────
import type { Abstention } from '@ftth-copilot/shared';
export type { Abstention } from '@ftth-copilot/shared';
export { ABSTENTION_SCHEMA, abstentionSchema } from '@ftth-copilot/shared';
export {
  shouldAbstain,
  buildAbstention,
  nextStepFor,
  formatIdentifierNextStep,
  formatMetricsNextStep,
  type AbstentionDecision,
  type TruthGateMode,
} from './abstention-policy';