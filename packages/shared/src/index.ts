/**
 * Tipos compartidos entre el agente y el frontend.
 */
import type { Verdict } from '@ftth-copilot/evidence';

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
