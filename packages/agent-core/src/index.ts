export { runAgent, type RunAgentOptions } from './runtime';
export { buildTools, executeToolCall, buildDefaultConnector } from './tools/index';
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
  classifyEnvelope,
  classifyUnwrapped,
  type Verdict,
  type VerdictCode,
  type VerdictSeverity,
} from '@ftth-copilot/evidence';