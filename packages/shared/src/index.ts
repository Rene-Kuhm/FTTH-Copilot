/**
 * Tipos compartidos entre el agente y el frontend.
 */
import type { Verdict } from '@ftth-copilot/evidence';
import type { Abstention } from './contracts';

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface AgentResult {
  text: string;
  toolCalls: ToolCallRecord[];
  /**
   * Optional verdicts from `@ftth-copilot/evidence`'s TruthGate
   * (Fase B). Each tool call produces one verdict; classification is
   * observe-mode (data still flows to the LLM). Omission is valid for
   * pre-Fase-B results.
   */
  verdicts?: Verdict[];
  /**
   * Optional `ftth.abstention.v1` envelope (Fase C). Present only when the
   * TruthGate ran in `strict` mode and at least one verdict classified the
   * evidence as `incomplete`. Omission is valid for observe-mode runs and
   * for every pre-Fase-C result.
   */
  abstention?: Abstention;
  /**
   * `true` when `text` is the abstention rendering instead of the LLM's own
   * answer. Always paired with `abstention`. Omitted (not `false`) when the
   * agent answered normally, so existing consumers stay untouched.
   */
  abstained?: boolean;
}

export interface ChatRequest {
  message: string;
  conversationId?: string;
}

export interface ChatResponse {
  reply: string;
  toolsUsed: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
  conversationId?: string;
  /**
   * Abstention envelope forwarded verbatim from `AgentResult.abstention`
   * (Fase C) so the client can render the warning bubble. Optional: absent
   * whenever the agent answered normally.
   */
  abstention?: Abstention;
}

export * from './contracts';
export type { EvidenceProvenance, Abstention } from './contracts';
export {
  EVIDENCE_PROVENANCE_SCHEMA,
  evidenceProvenanceSchema,
  ABSTENTION_SCHEMA,
  abstentionSchema,
  DEFAULT_TTL_MS,
  DEMO_TTL_MS,
} from './contracts';
