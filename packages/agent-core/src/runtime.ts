import Anthropic from '@anthropic-ai/sdk';
import type { AgentResult, ToolCallRecord, TenantPolicy } from '@ftth-copilot/shared';
import {
  buildAbstention,
  classifyEnvelope,
  classifyUnwrapped,
  formatRelevantIncidentsBlock,
  shouldAbstain,
  type Abstention,
  type RelevantIncidentResult,
  type TruthGateMode,
  type Verdict,
  type VerdictCode,
} from '@ftth-copilot/evidence';
import { SYSTEM_PROMPT } from './prompts/system';
import {
  buildTools,
  executeToolCall,
  buildDefaultConnector,
  type ProvenanceContext,
  type TopologyProvider,
} from './tools/index';
import { createLlmClient, type LlmMessage, type LlmTool } from './llm';

/**
 * Args passed to an injected `retrievalProvider`. The runtime extracts a
 * simple `deviceHint` from `opts.userMessage` via regex and forwards the
 * caller-supplied tenantId + query verbatim. The runtime never asks for a
 * DB connection itself — keeping `@ftth-copilot/agent-core` DB-free, the
 * chat route owns the Prisma read and the tenant scope.
 */
export interface RetrievalProviderArgs {
  tenantId: string;
  query: string;
  deviceHint?: string;
  limit?: number;
  sinceDays?: number;
  mode?: 'live' | 'demo';
}

/**
 * Optional opt-in callback that returns prior confirmed incidents as
 * background context. Called exactly once per `runAgent` invocation, only
 * when `opts.dataSource.mode === 'live'`. Must NEVER throw — failure here
 * must not break the chat (the runtime wraps the call in try/catch). When
 * undefined, retrieval is a no-op (Phase A/B/C behaviour is preserved).
 */
export type RetrievalProvider = (
  args: RetrievalProviderArgs,
) => Promise<RelevantIncidentResult[]> | RelevantIncidentResult[];

/**
 * Fase E — resolved per-tenant policy knobs the runtime threads through
 * `shouldAbstain` + the retrieval closure. Shape is fixed; absence of a
 * knob (resolved value = `undefined`) means "fall through to the env /
 * module default". Built once per `runAgent` invocation by
 * `resolveTenantPolicy` and consumed via `opts.tenantPolicy`-derived
 * helpers below — never by direct env reads inside the loop.
 */
export interface ResolvedTenantPolicy {
  readonly truthGateMode: TruthGateMode | undefined;
  readonly retrievalLimit: number | undefined;
  readonly retrievalSinceDays: number | undefined;
  readonly abstainOnCodes: ReadonlyArray<VerdictCode> | undefined;
  readonly promotionMinAgeMs: number | undefined;
}

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
  /**
   * Optional retrieval hook for the Fase D pre-LLM context block. See
   * `RetrievalProvider`. When defined AND `dataSource.mode === 'live'`, the
   * runtime invokes it once before the LLM loop and appends the rendered
   * block to the system prompt. In demo mode (or when omitted / throwing)
   * the system prompt is byte-identical to the pre-Fase-D baseline.
   */
  retrievalProvider?: RetrievalProvider;
  /**
   * Fase E — optional per-tenant override row. Absent → Fase C/D
   * byte-identical. Threaded through `shouldAbstain` (abstainOnCodes) and
   * the retrieval closure (retrievalLimit / retrievalSinceDays). Never
   * enters the `evidence.provenance.v1` envelope and never alters any
   * envelope field. Per-tenant wins over env over module default.
   */
  tenantPolicy?: TenantPolicy;
  /**
   * Fase E — optional closure that returns the tenant-scoped, active-edge
   * `TopologyEdge[]` for the two topology tools (`get_topology_path`,
   * `get_downstream_clients`). Absent → those tools surface a clear
   * Spanish error and the runtime keeps working. The chat route owns the
   * actual Prisma read; `agent-core` stays Prisma-free.
   */
  topologyProvider?: TopologyProvider;
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
 * Fase E — pure per-tenant policy resolver. Precedence per knob is
 * `tenantPolicy.X ?? env.X ?? moduleDefault.X`. The function never reads
 * env directly; the caller injects the `env` snapshot so tests stay
 * deterministic. When a per-tenant knob applies, the runtime emits exactly
 * one `console.info` log line with the format
 * `[ftth-copilot/tenant-policy] tenant=<id> knob=<name> resolved=<value>`.
 *
 * Absent `tenantPolicy` → every resolved knob is `undefined` and zero log
 * lines fire. The downstream call sites (`shouldAbstain`, retrieval
 * closure) treat `undefined` as "fall through to env / module default".
 */
export function resolveTenantPolicy(
  opts: { tenantPolicy?: TenantPolicy },
  env: { TRUTH_GATE_MODE?: string },
): ResolvedTenantPolicy {
  const tp = opts.tenantPolicy;
  const fromPolicy = (knob: keyof TenantPolicy): unknown => tp?.[knob];
  const resolved: ResolvedTenantPolicy = {
    truthGateMode: (fromPolicy('truthGateMode') as TruthGateMode | undefined) ?? undefined,
    retrievalLimit: (fromPolicy('retrievalLimit') as number | undefined) ?? undefined,
    retrievalSinceDays: (fromPolicy('retrievalSinceDays') as number | undefined) ?? undefined,
    abstainOnCodes: (fromPolicy('abstainOnCodes') as ReadonlyArray<VerdictCode> | undefined) ??
      undefined,
    promotionMinAgeMs: (fromPolicy('promotionMinAgeMs') as number | undefined) ?? undefined,
  };

  if (!tp) return resolved;

  // Emit one precedence log per knob that the tenant actually overrides.
  // The `resolved` value is the value the runtime will use downstream —
  // for `abstainOnCodes` and arrays we JSON-stringify for stable log shape.
  const emit = (knob: string, value: unknown): void => {
    console.info(
      `[ftth-copilot/tenant-policy] tenant=${tp.tenantId} knob=${knob} resolved=${JSON.stringify(value)}`,
    );
  };
  if (tp.truthGateMode !== undefined) emit('truthGateMode', tp.truthGateMode);
  if (tp.retrievalLimit !== undefined) emit('retrievalLimit', tp.retrievalLimit);
  if (tp.retrievalSinceDays !== undefined) emit('retrievalSinceDays', tp.retrievalSinceDays);
  if (tp.abstainOnCodes !== undefined) emit('abstainOnCodes', tp.abstainOnCodes);
  if (tp.promotionMinAgeMs !== undefined) emit('promotionMinAgeMs', tp.promotionMinAgeMs);
  // `env` is reserved for downstream `runAgent` to consult when
  // `tenantPolicy` is absent — the spec states "absent → fall through to
  // env / module default", so the env parameter is part of the contract
  // even though this resolver does not consult it directly.
  void env;

  return resolved;
}

/** Encabezado fijo de toda abstención. Bloqueado por snapshot en los tests. */
const ABSTENTION_HEADING = 'No puedo responder con la evidencia disponible.';

/**
 * Lightweight `(ONU|OLT)-?\d+` matcher over the user message. Returns the
 * first captured device identifier (e.g. `ONU-123`, `OLT7`) or `undefined`
 * when none is present. Deliberately cheap: no LLM call, no per-tool-call
 * state — the runtime runs before the loop and only sees the operator
 * question. Used as a soft hint to `retrievalProvider`; the actual ranking
 * is still owned by `@ftth-copilot/evidence`.
 */
export function extractDeviceHintFromMessage(userMessage: string): string | undefined {
  const match = /(ONU|OLT)-?\d+/i.exec(userMessage);
  return match ? match[0].toUpperCase() : undefined;
}

/**
 * Renderiza el texto que ve el operador cuando el agente se abstiene:
 * encabezado + bullets de `missing` + `nextStep`. Puro y determinista — mismo
 * envelope produce siempre los mismos bytes.
 *
 * El bloque de bullets se omite cuando `missing` está vacío, para no dejar un
 * título colgado sin ítems.
 */
export function formatAbstentionText(abstention: Abstention): string {
  const blocks: string[] = [ABSTENTION_HEADING];
  if (abstention.missing.length > 0) {
    const bullets = abstention.missing.map((toolName) => `- ${toolName}`).join('\n');
    blocks.push(`Falta evidencia de:\n${bullets}`);
  }
  blocks.push(abstention.nextStep);
  return blocks.join('\n\n');
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
 *
 * Fase C (strict mode, default): the accumulated verdicts are evaluated by
 * `shouldAbstain` at BOTH return paths. When any verdict is `incomplete`, the
 * LLM's text is discarded and replaced by the rendered abstention, and
 * `abstention` / `abstained` are attached. Classification itself is untouched:
 * the data path to the LLM stays byte-identical in both modes.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  // Fase E — resolve the per-tenant policy once per invocation; the
  // resolved knobs are threaded through `shouldAbstain` and the retrieval
  // closure consumer. Absent tenantPolicy → all knobs are `undefined` and
  // downstream callers fall through to env / module default. The
  // resolved truthGateMode wins over `opts.mode` (per-tenant > caller
  // explicit arg > env > module default).
  const env = { TRUTH_GATE_MODE: process.env['TRUTH_GATE_MODE'] };
  const resolvedTenantPolicy = resolveTenantPolicy({ tenantPolicy: opts.tenantPolicy }, env);
  const mode = resolvedTenantPolicy.truthGateMode ?? resolveTruthGateMode(opts.mode);
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

  /**
   * Fase C (strict mode): aplica la política de abstención al resultado final.
   * Se invoca en AMBOS return paths (corte sin tool calls y corte por límite de
   * iteraciones) para que ninguna salida del loop escape al gate.
   *
   * Cuando la política devuelve `'abstain'`, el texto del LLM se descarta y se
   * reemplaza por la abstención renderizada. En `observe`, o sin verdicts
   * `incomplete`, el resultado es exactamente el de Fase B: `abstention` y
   * `abstained` quedan ausentes.
   *
   * Fase E — when the resolved tenant policy carries `abstainOnCodes`, we
   * forward it as the 3rd arg so `shouldAbstain` consults the override
   * set. Absent tenant policy → undefined → Fase C byte-identical. When
   * the override triggers on a non-incomplete code (e.g. `['stale']`), we
   * locate the trigger verdict and pass its code into `buildAbstention` so
   * the envelope `reason` reflects the actual trigger.
   */
  const finalize = (text: string): AgentResult => {
    const policyArg =
      resolvedTenantPolicy.abstainOnCodes !== undefined
        ? { abstainOnCodes: resolvedTenantPolicy.abstainOnCodes }
        : undefined;
    if (shouldAbstain(verdicts, mode, policyArg) !== 'abstain') {
      return { text, toolCalls, verdicts };
    }
    // Determine the trigger code: when the tenant policy is the override,
    // use the first code that fires; otherwise (Fase C path) it's always
    // `incomplete`. `shouldAbstain` already returned 'abstain', so at
    // least one matching verdict exists.
    let triggerCode: VerdictCode = 'incomplete';
    if (policyArg) {
      const trigger = verdicts.find((v) => policyArg.abstainOnCodes.includes(v.code));
      if (trigger) triggerCode = trigger.code;
    }
    const abstention = buildAbstention(verdicts, undefined, triggerCode);
    return {
      text: formatAbstentionText(abstention),
      toolCalls,
      verdicts,
      abstention,
      abstained: true,
    };
  };

  const sourcePrompt = opts.dataSource?.mode === 'demo'
    ? '\n\n## Fuente de datos de esta ejecución\nEstás usando DATOS SIMULADOS de demo. Iniciá la respuesta con "[DEMO]" y nunca los presentes como datos reales del ISP.'
    : opts.dataSource
      ? `\n\n## Fuente de datos de esta ejecución\nUsás el conector real ${opts.dataSource.provider} llamado "${opts.dataSource.label}".`
      : '';

  /**
   * Fase D (WU3): pre-LLM retrieval block. Augments the system prompt with
   * the snapshot-locked Spanish heading + per-incident lines when:
   *  1. `opts.retrievalProvider` is defined;
   *  2. `opts.dataSource?.mode === 'live'` (demo is always skipped);
   *  3. the provider returns a non-empty array.
   *
   * Failure modes (provider throws, returns `[]`, demo, undefined) all keep
   * the system prompt byte-identical to the pre-Fase-D baseline — the
   * retrieval block is pure augmentation, never required for the loop.
   * Retrieved rows are BACKGROUND CONTEXT, never evidence: they never enter
   * the Truth Gate data path (`result.verdicts`, `result.toolCalls`).
   */
  const retrievalBlock = await loadRetrievalBlock(opts, resolvedTenantPolicy);

  for (let i = 0; i < maxIterations; i++) {
    const response = await llm.createMessage({
      system: SYSTEM_PROMPT + sourcePrompt + retrievalBlock,
      messages,
      tools,
      maxTokens: 2048,
    });

    if (response.toolCalls.length === 0) {
      return finalize(response.text || '(sin respuesta)');
    }

    // Ejecutar todas las tool calls y收集 sus resultados.
    const toolResultLines: string[] = [];
    for (const call of response.toolCalls) {
      const result = await executeToolCall(connector, call.name, call.arguments, opts.predictionProvider, provenance, opts.topologyProvider);
      verdicts.push(classifyToolResult(result, call.name));
      toolCalls.push({ name: call.name, arguments: call.arguments, result });
      toolResultLines.push(`[tool_result for ${call.name}] ${result}`);
    }

    // Both Anthropic and OpenAI clients get the tool results as a single
    // user message. The abstraction works in plain strings, so we concatenate.
    messages.push({ role: 'assistant', content: response.text });
    messages.push({ role: 'user', content: toolResultLines.join('\n') });
  }

  return finalize('(el agente excedió el máximo de iteraciones de tool-calling)');
}

/**
 * Loads the pre-LLM context block. Returns `''` whenever retrieval is
 * skipped (provider undefined / demo mode / provider throws / empty
 * result) so the caller can concatenate unconditionally. Every failure
 * mode logs nothing and degrades silently: retrieval is augmentation,
 * never a precondition for the loop. Snapshot-locked output via
 * `formatRelevantIncidentsBlock`.
 *
 * Fase E — when `resolved.tenantPolicy.retrievalLimit` or
 * `resolved.tenantPolicy.retrievalSinceDays` are set, the corresponding
 * `limit` / `sinceDays` args are forwarded to the retrieval provider so
 * the per-tenant cap / window apply without the caller wiring a custom
 * closure. Absent tenantPolicy → both forwarded values are `undefined`
 * and the provider falls through to its own module defaults (Fase D
 * byte-identical).
 */
async function loadRetrievalBlock(
  opts: RunAgentOptions,
  resolved: ResolvedTenantPolicy,
): Promise<string> {
  if (!opts.retrievalProvider) return '';
  if (opts.dataSource?.mode !== 'live') return '';
  let results: RelevantIncidentResult[];
  try {
    results = await opts.retrievalProvider({
      tenantId: opts.tenantId ?? '',
      query: opts.userMessage,
      deviceHint: extractDeviceHintFromMessage(opts.userMessage),
      ...(resolved.retrievalLimit !== undefined ? { limit: resolved.retrievalLimit } : {}),
      ...(resolved.retrievalSinceDays !== undefined ? { sinceDays: resolved.retrievalSinceDays } : {}),
      mode: 'live',
    });
  } catch {
    // Fail-safe: retrieval is augmentation, never required.
    return '';
  }
  if (!Array.isArray(results) || results.length === 0) return '';
  return formatRelevantIncidentsBlock(results);
}