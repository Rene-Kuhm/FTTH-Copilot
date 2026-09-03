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

// ── Fase E — temporal topology BFS helpers (pure TS, Prisma-free) ────────────
export type { TopologyHop } from './topology';
export { bfsAncestors, bfsDownstream, topologyPath } from './topology';

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
  type AbstentionTenantPolicy,
  type TruthGateMode,
} from './abstention-policy';

// ── Fase D — confirmed-incident memory contracts + retrieval runtime ────────
//
// The type surface lets downstream packages (`@ftth-copilot/agent-core`,
// `apps/web`) type their retrieval call signatures without depending on
// `@ftth-copilot/shared` directly. The runtime helpers below are the
// sparse-first retrieval path: BM25 scoring, tenant-scoped ranking with RRF
// plumbing, the snapshot-locked Spanish context block, and the pending
// candidate constructor + promotion gate.
export type {
  ConfirmedIncident,
  PendingIncidentCandidate,
  RelevantIncidentResult,
  TenantPolicy,
  TopologyEdge,
  TopologyNodeKind,
} from '@ftth-copilot/shared';
export {
  CONFIRMED_INCIDENT_SCHEMA,
  PENDING_INCIDENT_CANDIDATE_SCHEMA,
  TENANT_POLICY_SCHEMA,
  tenantPolicySchema,
  TOPOLOGY_EDGE_SCHEMA,
  topologyEdgeSchema,
  topologyNodeKindSchema,
} from '@ftth-copilot/shared';
export {
  BM25_B,
  BM25_K1,
  BM25_STOPWORDS,
  BM25_STOPWORDS_FULL,
  TOKEN_REGEX,
  scoreBM25,
  scoreCorpus,
  tokenize,
} from './bm25-lite';
export {
  DEFAULT_LIMIT,
  DEFAULT_SINCE_DAYS,
  DEVICE_HINT_BOOST,
  MIN_SPARSESCORE,
  MissingTenantError,
  RELEVANT_INCIDENTS_HEADING,
  RRF_K,
  formatRelevantIncidentsBlock,
  retrieveRelevantIncidents,
  type DeviceHint,
  type RetrieveRelevantIncidentsArgs,
  type RetrievalTenantPolicy,
} from './relevant-incidents';
export {
  PROMOTION_MIN_AGE_MS,
  buildPendingIncidentCandidate,
  eligibleForPromotion,
  type BuildPendingIncidentCandidateArgs,
  type PromotionTenantPolicy,
} from './pending-incident';
