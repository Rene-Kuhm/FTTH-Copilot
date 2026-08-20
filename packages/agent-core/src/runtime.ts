import Anthropic from '@anthropic-ai/sdk';
import type { AgentResult, ToolCallRecord } from '@ftth-copilot/shared';
import { SYSTEM_PROMPT } from './prompts/system.js';
import {
  buildTools,
  executeToolCall,
  buildDefaultConnector,
} from './tools/index.js';

export interface RunAgentOptions {
  userMessage: string;
  /** Override del modelo (default: claude-sonnet-4-6). */
  model?: string;
  /** Connector custom. Si no, usa SmartOLT en modo mock por defecto. */
  connector?: ReturnType<typeof buildDefaultConnector>;
  /** Máximo de iteraciones de tool-calling antes de cortar (safety). */
  maxIterations?: number;
}

const DEFAULT_MODEL = process.env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6';

/**
 * Loop principal del agente: recibe el mensaje del usuario, le pide a Claude
 * que responda (posiblemente llamando tools), ejecuta las tools contra el
 * connector, y devuelve la respuesta final.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no está configurada');
  }

  const client = new Anthropic({ apiKey });
  const model = opts.model ?? DEFAULT_MODEL;
  const connector = opts.connector ?? buildDefaultConnector();
  const tools = buildTools(connector);
  const maxIterations = opts.maxIterations ?? 6;

  const toolCalls: ToolCallRecord[] = [];

  // Mensaje inicial
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: opts.userMessage },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
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
      const result = await executeToolCall(connector, block.name, args);
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
