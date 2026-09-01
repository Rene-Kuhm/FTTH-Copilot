import Anthropic from '@anthropic-ai/sdk';
import type { AgentResult, ToolCallRecord } from '@ftth-copilot/shared';
import { SYSTEM_PROMPT } from './prompts/system';
import {
  buildTools,
  executeToolCall,
  buildDefaultConnector,
} from './tools/index';
import { createLlmClient, type LlmMessage, type LlmTool } from './llm';

export interface RunAgentOptions {
  userMessage: string;
  /** Historial ya autorizado y acotado por el caller. */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Descripción confiable de la fuente de datos usada en esta ejecución. */
  dataSource?: { mode: 'live' | 'demo'; provider: string; label: string };
  /** Override del modelo (default: el del proveedor activo). */
  model?: string;
  /** Connector custom. Si no, usa SmartOLT en modo mock por defecto. */
  connector?: ReturnType<typeof buildDefaultConnector>;
  /** Máximo de iteraciones de tool-calling antes de cortar (safety). */
  maxIterations?: number;
  /** Fuente de problemas pronosticados (detección temprana) para la tool get_predicted_issues. */
  predictionProvider?: () => Promise<unknown>;
}

/**
 * Loop principal del agente: recibe el mensaje del usuario, le pide al LLM
 * (MiniMax/DeepSeek/Qwen vía `createLlmClient`) que responda (posiblemente
 * llamando tools), ejecuta las tools contra el connector, y devuelve la
 * respuesta final.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const llm = createLlmClient();
  const connector = opts.connector ?? buildDefaultConnector();
  const anthropicTools = buildTools(connector);
  const tools: LlmTool[] = anthropicTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: (t as unknown as { input_schema?: Record<string, unknown> }).input_schema ?? {},
  }));
  const maxIterations = opts.maxIterations ?? 6;

  const toolCalls: ToolCallRecord[] = [];
  const messages: LlmMessage[] = [
    ...(opts.conversationHistory ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: opts.userMessage },
  ];

  const sourcePrompt = opts.dataSource?.mode === 'demo'
    ? '\n\n## Fuente de datos de esta ejecución\nEstás usando DATOS SIMULADOS de demo. Iniciá la respuesta con "[DEMO]" y nunca los presentes como datos reales del ISP.'
    : opts.dataSource
      ? `\n\n## Fuente de datos de esta ejecución\nUsás el conector real ${opts.dataSource.provider} llamado "${opts.dataSource.label}".`
      : '';

  for (let i = 0; i < maxIterations; i++) {
    const response = await llm.createMessage({
      system: SYSTEM_PROMPT + sourcePrompt,
      messages,
      tools,
      maxTokens: 2048,
    });

    if (response.toolCalls.length === 0) {
      return { text: response.text || '(sin respuesta)', toolCalls };
    }

    // Ejecutar todas las tool calls y收集 sus resultados.
    const toolResultLines: string[] = [];
    for (const call of response.toolCalls) {
      const result = await executeToolCall(connector, call.name, call.arguments, opts.predictionProvider);
      toolCalls.push({ name: call.name, arguments: call.arguments, result });
      toolResultLines.push(`[tool_result for ${call.name}] ${result}`);
    }

    // Both Anthropic and OpenAI clients get the tool results as a single
    // user message. The abstraction works in plain strings, so we concatenate.
    messages.push({ role: 'assistant', content: response.text });
    messages.push({ role: 'user', content: toolResultLines.join('\n') });
  }

  return {
    text: '(el agente excedió el máximo de iteraciones de tool-calling)',
    toolCalls,
  };
}
