/**
 * Tipos compartidos entre el agente y el frontend.
 */

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface AgentResult {
  text: string;
  toolCalls: ToolCallRecord[];
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
