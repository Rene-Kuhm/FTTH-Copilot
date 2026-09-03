/**
 * @ftth-copilot/evidence — Fase B (Truth Gate, observation mode) + Fase C
 * (strict-mode abstention policy) + Fase D (confirmed-incident memory contracts).
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

// ── Fase D — confirmed-incident memory contracts (type-only WU1 re-export) ──
//
// WU1 only needs the type-level surface so downstream packages
// (`@ftth-copilot/agent-core`, `apps/web`) can type their retrieval call
// signatures without depending on `@ftth-copilot/shared` directly. The
// runtime retrieval helpers (`retrieveRelevantIncidents`, `scoreBM25`, …)
// land in WU2 alongside the BM25 scorer and the sparse-first RRF plumbing.
export type {
  ConfirmedIncident,
  PendingIncidentCandidate,
  RelevantIncidentResult,
} from '@ftth-copilot/shared';
export {
  CONFIRMED_INCIDENT_SCHEMA,
  PENDING_INCIDENT_CANDIDATE_SCHEMA,
} from '@ftth-copilot/shared';