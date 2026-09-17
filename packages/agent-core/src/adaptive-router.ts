/**
 * Adaptive Router — Slice 1 of `adaptive-router` change.
 *
 * Pure routing logic that classifies an operator query into one of three
 * dispatch modes and selects the minimum set of tools the selected mode
 * needs. No LLM, no I/O, no runtime coupling — `runtime.ts` consumes
 * `planRoute()` and branches accordingly.
 *
 * Three modes (Block 2's binary `route()` is replaced):
 *   - `direct`: 1–2 tool calls, zero LLM calls, formatted answer.
 *   - `assisted`: 1 LLM call + ≤1 follow-up if tool emitted, restricted tools.
 *   - `investigation`: full cognitive loop, all tools, maxIterations=6.
 *
 * The classifier is deterministic precedence on top of `classifyIntention`.
 * Real distribution data will replace it in v2; for v1 the precedence
 * table in `design.md AD-1` is the contract.
 */

import type { IntentionLabel } from './diagnostic-router';

// Inline IntentionContext (mirror of @ftth-copilot/eval) so this file
// remains self-contained without a runtime dep on the eval package.
interface IntentionContext {
  surface: string;
  userMessage: string;
  toolMocks?: ReadonlyArray<{ toolName: string; returns?: unknown }>;
}

const URGENCY_TOKENS = [
  'loi', 'sin servicio', 'caido', 'caidos', 'sin conexion', 'sin internet',
  'sin senal', 'no responde', 'no navega', 'no funciona', 'averia', 'outage',
  'critico', 'critica', 'falla', 'fallo',
] as const;

const ADVISORY_TOKENS = [
  'como', 'qué es', 'que es', 'qué significa', 'que significa',
  'mejor práctica', 'mejor practica', 'buenas prácticas', 'buenas practicas',
  'para qué sirve', 'para que sirve', 'recomiéndame', 'recomiendame',
  'recomendá', 'entender', 'explicame', 'explicá', 'explica', 'diferencia',
] as const;

const TOPOLOGY_SURFACES = new Set([
  'tool-args', 'connector-payload', 'prediction-provider',
  'retrieval-block', 'system-assembly', 'conversation-history',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()\[\]"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Local v1 action-word set — small deterministic list that mirrors the
// Block 2 classifier's keyword dictionary for the words that matter here.
const ROUTINE_TOKENS = [
  'estado', 'status', 'potencia', 'rx', 'senal', 'listar', 'lista',
  'mostrame', 'detalle', 'mostrar', 'cuanto', 'cuantos', 'arbol',
  'topologia', 'ayer', 'hoy', 'reciente', 'que paso', 'historial',
  'historico', 'ultimo', 'ultima',
] as const;

function classifyIntention(ctx: IntentionContext): { label: IntentionLabel } {
  const toolMockSummary = (ctx.toolMocks ?? [])
    .map((m) => `${m.toolName} ${JSON.stringify(m.returns ?? null)}`)
    .join(' ');
  const combined = `${ctx.userMessage} ${ctx.surface} ${toolMockSummary}`;
  const normalized = normalizeText(combined);
  if (URGENCY_TOKENS.some((t) => normalized.includes(t))) {
    return { label: 'incident_diagnosis' };
  }
  if (ADVISORY_TOKENS.some((t) => normalized.includes(t))) {
    return { label: 'advisory' };
  }
  // Action words for read-only queries → routine_topology.
  if (ROUTINE_TOKENS.some((t) => normalized.includes(t))) {
    return { label: 'routine_topology' };
  }
  const fallback = TOPOLOGY_SURFACES.has(ctx.surface) ? 'routine_topology' : 'advisory';
  return { label: fallback };
}

export type { IntentionContext };

// ── Public types ───────────────────────────────────────────────────────────

export type DiagnosticMode = 'direct' | 'assisted' | 'investigation';

export interface DiagnosticRoute {
  mode: DiagnosticMode;
  tools: ReadonlyArray<string>;
  maxIterations: number;
  reason: string;
  /** Convenience: the intention label that fed into the mode decision. */
  label: IntentionLabel;
}

// ── Query signals (regex-based extraction) ─────────────────────────────────

/**
 * Lightweight, deterministic signal extractor over a free-text query.
 * Returns the bits `selectMode` + `selectTools` need to make a decision
 * without calling an LLM.
 */
export interface QuerySignals {
  /** Lowercased + normalised text. */
  normalized: string;
  /** Distinct device IDs found: e.g. `['ONU-342', 'OLT-Core-01']`. */
  deviceIds: ReadonlyArray<string>;
  /** Distinct question marks in the original query. */
  hasQuestionMark: boolean;
  /** Distinct count of device IDs. */
  deviceCount: number;
  /** Multi-device hint: text mentions 2+ devices OR multi-device words. */
  multiDevice: boolean;
  /** Hypothesis / cause analysis hint. */
  causeAnalysis: boolean;
  /** Historical / temporal hint (ayer / hoy / histórico / etc). */
  historical: boolean;
  /** Action word matched in the query. */
  actionWord: 'list' | 'detail' | 'status' | 'power' | 'history' | null;
}

const DEVICE_ID_PATTERN = /(?:onu|olt|pon|cto|splitter|spl)[- ]?[a-z0-9-]+/gi;
const QUESTION_MARK_PATTERN = /[¿?]/;
const MULTI_DEVICE_WORDS = /(?:masivos?|varias?|múltiples?|multiples?|28|cientos?|decenas?)/i;
const CAUSE_WORDS = /(?:causa|raíz|origen|diagn[oó]stic|investiga)/i;
const HISTORICAL_WORDS = /(?:ayer|hoy|hist[oó]rico|reciente|esta semana|este mes|últim[oa]s?|pasad[oa])/i;
const ACTION_LIST_WORDS = /(?:listar|lista|listame|mostrame|muéstrame|cu[aá]nt[oa]s?|cu[aá]nto)/i;
const ACTION_DETAIL_WORDS = /(?:detalle|informaci[oó]n|descripci[oó]n)/i;
const ACTION_STATUS_WORDS = /(?:estado|status|en l[ií]nea|online|offline)/i;
const ACTION_POWER_WORDS = /(?:potencia|rx|signal|se[ñn]al|dBm|dbm)/i;
const ACTION_HISTORY_WORDS = /(?:qu[eé] pas[oó]|c[oó]mo estuvo|historial|registro|evento)/i;

/**
 * Pure function: extract the small bits of structure `selectMode` needs.
 * No LLM, no I/O. Word-boundary aware where the regex makes sense.
 */
export function extractSignals(rawText: string): QuerySignals {
  const normalized = rawText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const deviceIds = Array.from(
    new Set(
      (rawText.match(DEVICE_ID_PATTERN) ?? []).map((s) => s.toUpperCase()),
    ),
  );
  const deviceCount = deviceIds.length;

  const hasQuestionMark = QUESTION_MARK_PATTERN.test(rawText);
  const multiDevice = deviceCount >= 2 || MULTI_DEVICE_WORDS.test(rawText);
  const causeAnalysis = CAUSE_WORDS.test(rawText);
  const historical = HISTORICAL_WORDS.test(rawText);

  let actionWord: QuerySignals['actionWord'] = null;
  if (ACTION_LIST_WORDS.test(normalized)) actionWord = 'list';
  else if (ACTION_DETAIL_WORDS.test(normalized)) actionWord = 'detail';
  else if (ACTION_STATUS_WORDS.test(normalized)) actionWord = 'status';
  else if (ACTION_POWER_WORDS.test(normalized)) actionWord = 'power';
  else if (ACTION_HISTORY_WORDS.test(normalized) || historical) actionWord = 'history';

  return {
    normalized,
    deviceIds,
    hasQuestionMark,
    deviceCount,
    multiDevice,
    causeAnalysis,
    historical,
    actionWord,
  };
}

// ── Mode selection ─────────────────────────────────────────────────────────

/**
 * Pure function: map (intention, signals) → mode. Precedence table is
 * the contract; Block 2's distribution data will refine it.
 */
export function selectMode(label: IntentionLabel, signals: QuerySignals): DiagnosticMode {
  // Hard rule: advisory ALWAYS goes to investigation (LLM is required).
  if (label === 'advisory') return 'investigation';

  // Multi-device or cause-analysis = investigation (cognitive loop needed).
  if (signals.multiDevice || signals.causeAnalysis) return 'investigation';

  if (label === 'routine_topology') {
    // Routine + history = assisted (need retrieval context).
    if (signals.historical) return 'assisted';
    // Routine + question mark = assisted (LLM frames the answer).
    if (signals.hasQuestionMark) return 'assisted';
    // Routine + single device, no question, no history = direct.
    if (signals.deviceCount >= 1) return 'direct';
    // Default for routine: assisted (LLM picks the right tool).
    return 'assisted';
  }

  if (label === 'incident_diagnosis') {
    // Single device, no question = direct (the user wants a specific fact).
    if (signals.deviceCount === 1 && !signals.hasQuestionMark) return 'direct';
    // Single device with question = assisted (LLM frames the answer).
    if (signals.deviceCount === 1 && signals.hasQuestionMark) return 'assisted';
    // No device id but question = assisted.
    if (signals.hasQuestionMark) return 'assisted';
    // Default for incident: investigation (cognitive loop).
    return 'investigation';
  }

  return 'investigation';
}

// ── Tool filter ────────────────────────────────────────────────────────────

const TOOL_BY_ACTION: Record<NonNullable<QuerySignals['actionWord']>, string[]> = {
  list: ['list_olts', 'list_onus', 'get_network_overview'],
  detail: ['get_onu_detail', 'get_olt_detail'],
  status: ['list_onus', 'get_onu_detail'],
  power: ['get_onus_with_low_signal', 'get_onu_detail'],
  history: ['get_predicted_issues', 'get_onu_detail'],
};

const TOOL_BY_DEVICE_KIND: Record<string, string[]> = {
  ONU: ['get_onu_detail', 'list_onus'],
  OLT: ['get_olt_detail', 'list_olts', 'get_network_overview'],
  PON_PORT: ['get_topology_path', 'get_downstream_clients'],
  SPLITTER: ['get_topology_path', 'get_downstream_clients'],
  CTO: ['get_downstream_clients', 'get_topology_path'],
};

const ALL_TOOLS = [
  'get_predicted_issues',
  'list_olts',
  'get_olt_detail',
  'get_network_overview',
  'list_onus',
  'get_onu_detail',
  'get_onus_with_low_signal',
  'search_by_customer_name',
  'get_topology_path',
  'get_downstream_clients',
] as const;

const CONTEXT_TOOLS = ['get_topology_path', 'get_predicted_issues', 'get_downstream_clients'];

/**
 * Pure function: pick the minimum set of tool names the selected mode
 * needs. Returns `string[]` (not `readonly`) because the runtime mutates
 * the list internally (e.g. spreading before passing to the LLM).
 *
 * Returns:
 *   - `direct`: exactly 1 tool, the most-specific match for the signals.
 *   - `assisted`: query tool + 1 context tool (topology or predicted issues).
 *   - `investigation`: every tool.
 */
export function selectTools(
  mode: DiagnosticMode,
  signals: QuerySignals,
  allTools: ReadonlyArray<string> = ALL_TOOLS,
): string[] {
  if (mode === 'investigation') {
    return [...allTools];
  }

  const all = new Set(allTools);
  const candidates: string[] = [];

  // 1) Device-kind-specific tool (highest precedence — a named device
  // beats an action word). "estado de ONU-342" → get_onu_detail, not
  // list_onus.
  if (signals.deviceIds.length > 0) {
    const id = signals.deviceIds[0]!;
    const kind = id.startsWith('ONU') ? 'ONU'
      : id.startsWith('OLT') ? 'OLT'
      : id.startsWith('PON') ? 'PON_PORT'
      : id.startsWith('SPL') ? 'SPLITTER'
      : id.startsWith('CTO') ? 'CTO'
      : 'ONU';
    const kindTools = TOOL_BY_DEVICE_KIND[kind] ?? [];
    for (const t of kindTools) {
      if (all.has(t) && !candidates.includes(t)) candidates.push(t);
    }
  }

  // 2) Action-word tools fill in for queries without a device ID
  // ("mostrame puertos", "potencia RX") or as context.
  if (signals.actionWord) {
    const toolForAction = TOOL_BY_ACTION[signals.actionWord] ?? [];
    for (const t of toolForAction) {
      if (all.has(t) && !candidates.includes(t)) candidates.push(t);
    }
  }

  // 3) Fallback when nothing matched.
  if (candidates.length === 0) {
    candidates.push('get_network_overview');
  }

  if (mode === 'direct') {
    return [candidates[0]!];
  }

  // mode === 'assisted': pick 1 context tool on top of the candidates.
  const contextTool = CONTEXT_TOOLS.find((t) => all.has(t) && !candidates.includes(t))
    ?? 'get_predicted_issues';
  return [...candidates.slice(0, 3), contextTool];
}

// ── Plan route ─────────────────────────────────────────────────────────────

export interface PlanRouteOptions {
  userMessage: string;
  surface?: string;
  toolMocks?: ReadonlyArray<{ toolName: string; returns?: unknown }>;
  allTools?: ReadonlyArray<string>;
}

/**
 * End-to-end planner. Calls `classifyIntention` (Block 2's deterministic
 * classifier), extracts signals, then maps to `{ mode, tools, maxIterations,
 * reason }`. Pure (no LLM, no I/O).
 */
export function planRoute(opts: PlanRouteOptions): DiagnosticRoute {
  const surface = opts.surface ?? 'user-message';
  const ctx: IntentionContext = {
    surface,
    userMessage: opts.userMessage,
    toolMocks: opts.toolMocks,
  };
  const { label } = classifyIntention(ctx);
  const signals = extractSignals(opts.userMessage);
  const mode = selectMode(label, signals);
  const tools = selectTools(mode, signals, opts.allTools);

  const maxIterations =
    mode === 'direct' ? 0
    : mode === 'assisted' ? 1
    : 6;

  const reason =
    mode === 'direct' ? `direct (label=${label} action=${signals.actionWord ?? 'none'})`
    : mode === 'assisted' ? `assisted (label=${label} q=${signals.hasQuestionMark})`
    : `investigation (label=${label} multi=${signals.multiDevice} cause=${signals.causeAnalysis})`;

  return { mode, tools, maxIterations, reason, label };
}

// ── Re-exports for runtime convenience ─────────────────────────────────────

export { classifyIntention, type IntentionLabel };
