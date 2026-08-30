import Anthropic from '@anthropic-ai/sdk';
import type { AgentResult, ToolCallRecord } from '@ftth-copilot/shared';
import { SYSTEM_PROMPT } from './prompts/system';
import {
  buildTools,
  executeToolCall,
  buildDefaultConnector,
} from './tools/index';

export interface RunAgentOptions {
  userMessage: string;
  /** Historial ya autorizado y acotado por el caller. */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Descripción confiable de la fuente de datos usada en esta ejecución. */
  dataSource?: { mode: 'live' | 'demo'; provider: string; label: string };
  /** Override del modelo (default: claude-sonnet-4-6). */
  model?: string;
  /** Connector custom. Si no, usa SmartOLT en modo mock por defecto. */
  connector?: ReturnType<typeof buildDefaultConnector>;
  /** Máximo de iteraciones de tool-calling antes de cortar (safety). */
  maxIterations?: number;
  /** Fuente de problemas pronosticados (detección temprana) para la tool get_predicted_issues. */
  predictionProvider?: () => Promise<unknown>;
}

const DEFAULT_MODEL = process.env['MINIMAX_MODEL'] ?? 'MiniMax-M3';

/**
 * Loop principal del agente: recibe el mensaje del usuario, le pide a Claude
 * que responda (posiblemente llamando tools), ejecuta las tools contra el
 * connector, y devuelve la respuesta final.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const apiKey = process.env['MINIMAX_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'MINIMAX_API_KEY no está configurada. Copiá .env.example a .env y completá la key.',
    );
  }

  // MiniMax token-plan provider is Anthropic-API-compatible.
  // Docs: https://platform.minimax.io/docs/token-plan/intro
  const client = new Anthropic({
    apiKey,
    baseURL:
      process.env['MINIMAX_BASE_URL'] ?? 'https://api.minimax.io/anthropic',
  });
  const model = opts.model ?? DEFAULT_MODEL;
  const connector = opts.connector ?? buildDefaultConnector();
  const tools = buildTools(connector);
  const maxIterations = opts.maxIterations ?? 6;

  const toolCalls: ToolCallRecord[] = [];

  const messages: Anthropic.MessageParam[] = [
    ...(opts.conversationHistory ?? []).map(
      (message): Anthropic.MessageParam => ({ role: message.role, content: message.content }),
    ),
    { role: 'user', content: opts.userMessage },
  ];
  const sourcePrompt = opts.dataSource?.mode === 'demo'
    ? '\n\n## Fuente de datos de esta ejecución\nEstás usando DATOS SIMULADOS de demo. Iniciá la respuesta con "[DEMO]" y nunca los presentes como datos reales del ISP.'
    : opts.dataSource
      ? `\n\n## Fuente de datos de esta ejecución\nUsás el conector real ${opts.dataSource.provider} llamado "${opts.dataSource.label}".`
      : '';

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT + sourcePrompt,
      tools,
      messages,
    });

    // Buscar tool_use blocks en la respuesta
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUseBlocks.length === 0) {
      // No hay más tool calls, devolver texto final
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return { text: text || '(sin respuesta)', toolCalls };
    }

    // Ejecutar todas las tool_use blocks y收集 sus resultados
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const args = (block.input ?? {}) as Record<string, unknown>;
      const result = await executeToolCall(connector, block.name, args, opts.predictionProvider);
      toolCalls.push({ name: block.name, arguments: args, result });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    // Agregar la respuesta del assistant + los resultados, y volver a llamar a Claude
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }

  // Si llegamos al límite de iteraciones, devolver lo que tengamos
  return {
    text: '(el agente excedió el máximo de iteraciones de tool-calling)',
    toolCalls,
  };
}
