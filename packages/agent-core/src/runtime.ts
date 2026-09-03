import Anthropic from '@anthropic-ai/sdk';
import type { AgentResult, ToolCallRecord } from '@ftth-copilot/shared';
import {
  classifyEnvelope,
  classifyUnwrapped,
  type TruthGateMode,
  type Verdict,
} from '@ftth-copilot/evidence';
import { SYSTEM_PROMPT } from './prompts/system';
import {
  buildTools,
  executeToolCall,
  buildDefaultConnector,
  type ProvenanceContext,
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
  /** Tenant al que pertenece esta ejecución (aditivo, provenance). */
  tenantId?: string;
  /** Identificador de conexión/conector (aditivo, provenance; no entra al envelope). */
  connectionId?: string;
  /**
   * Modo del TruthGate para esta ejecución (Fase C). `'strict'` (default)
   * reemplaza el texto del LLM por una abstención cuando la evidencia es
   * `incomplete`; `'observe'` conserva el comportamiento de Fase B.
   */
  mode?: TruthGateMode;
}

/**
 * Modo por defecto del TruthGate. Punto único de rollback: cambiarlo a
 * `'observe'` desactiva la abstención estricta en todo el runtime sin tocar
 * los call sites.
 */
export const DEFAULT_TRUTH_GATE_MODE: TruthGateMode = 'strict';

/**
 * Resuelve el modo efectivo de una ejecución. Puro: mismo input → mismo
 * output, sin lecturas de entorno ni de estado global.
 */
export function resolveTruthGateMode(mode?: TruthGateMode): TruthGateMode {
  return mode ?? DEFAULT_TRUTH_GATE_MODE;
}

/**
 * Loop principal del agente: recibe el mensaje del usuario, le pide al LLM
 * (MiniMax/DeepSeek/Qwen vía `createLlmClient`) que responda (posiblemente
 * llamando tools), ejecuta las tools contra el connector, y devuelve la
 * respuesta final.
 *
 * Fase B (observe mode): after each `executeToolCall`, the raw result string
 * is classified by `@ftth-copilot/evidence`'s TruthGate. Verdicts accumulate
 * into `AgentResult.verdicts`; the data still flows to the LLM unchanged.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const mode = resolveTruthGateMode(opts.mode);
  const llm = createLlmClient();
  const connector = opts.connector ?? buildDefaultConnector();
  const anthropicTools = buildTools(connector);
  const tools: LlmTool[] = anthropicTools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: (t as unknown as { input_schema?: Record<string, unknown> }).input_schema ?? {},
  }));
  const maxIterations = opts.maxIterations ?? 6;

  const provenance: ProvenanceContext = {
    tenantId: opts.tenantId,
    connectionId: opts.connectionId,
    mode: opts.dataSource?.mode,
    provider: opts.dataSource?.provider,
  };

  const toolCalls: ToolCallRecord[] = [];
  const verdicts: Verdict[] = [];
  const referenceNow = new Date();

  /**
   * Classify a single tool result string. The data still flows to the LLM
   * unchanged — verdicts are recorded but never gate the data path.
   */
  const classifyToolResult = (raw: string, toolName: string): Verdict => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        toolName,
        code: 'incomplete',
        reason: 'parse-error',
        severity: 'critical',
      };
    }
    if (parsed === null || typeof parsed !== 'object') {
      return classifyUnwrapped(toolName);
    }
    return classifyEnvelope(parsed, toolName, referenceNow);
  };

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
      return { text: response.text || '(sin respuesta)', toolCalls, verdicts };
    }

    // Ejecutar todas las tool calls y收集 sus resultados.
    const toolResultLines: string[] = [];
    for (const call of response.toolCalls) {
      const result = await executeToolCall(connector, call.name, call.arguments, opts.predictionProvider, provenance);
      verdicts.push(classifyToolResult(result, call.name));
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
    verdicts,
  };
}