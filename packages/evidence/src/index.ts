/**
 * @ftth-copilot/evidence — Phase B (Truth Gate, observation mode).
 *
 * Pure envelope classification for `evidence.provenance.v1` tool results.
 * Verdicts are recorded but never gate the data flow to the LLM (observe mode).
 */
export type { Verdict, VerdictCode, VerdictSeverity } from './types';
export { classifyEnvelope, classifyUnwrapped } from './truth-gate';