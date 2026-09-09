export {
  runAgent,
  resolveTruthGateMode,
  resolveTenantPolicy,
  DEFAULT_TRUTH_GATE_MODE,
  extractDeviceHintFromMessage,
  type RetrievalProvider,
  type RetrievalProviderArgs,
  type RunAgentOptions,
  type ResolvedTenantPolicy,
} from './runtime';
export { buildTools, executeToolCall, buildDefaultConnector, type TopologyProvider } from './tools/index';
export {
  PROVENANCE_TOOL_META,
  defaultProvenance,
  deriveSource,
  type ProvenanceContext,
  type ProvenanceCompleteness,
  type ProvenanceToolMeta,
} from './tools/provenance';
export { SYSTEM_PROMPT } from './prompts/system';
export { detectAlerts, type Alert } from './alerts';
export {
  qualityVerdictFromToolSamples,
  type QualityVerdictFromToolArgs,
  type QualityVerdictFromToolResult,
} from './quality-bridge';
export {
  classifyEnvelope,
  classifyUnwrapped,
  type Verdict,
  type VerdictCode,
  type VerdictSeverity,
  type TruthGateMode,
} from '@ftth-copilot/evidence';
export type { TenantPolicy } from '@ftth-copilot/shared';

// ── Fase 3.3 — cognitive investigation engine & deterministic facts ─────────
export {
  investigateIncident,
  type InvestigationEngineArgs,
} from './investigation-engine';
export {
  computeInvestigationFacts,
  type InvestigationFacts,
  type OpticalFacts,
  type EventFacts,
  type TopologyFacts,
  type HistoryFacts,
} from './investigation-facts';
export {
  INVESTIGATION_PROMPT_VERSION,
  INVESTIGATION_RULESET_VERSION,
} from './investigation-prompt';

// ── Fase 3.4 — server-side investigation reference & temporal validator ───────
export {
  validateInvestigationResult,
  buildSafeFallbackResult,
  type ValidationIssue,
  type ValidationIssueCode,
  type InvestigationValidationReport,
  type ValidateInvestigationResultContext,
} from './investigation-validator';