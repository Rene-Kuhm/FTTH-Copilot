/**
 * Chat route error classifier (Fase X).
 *
 * Background:
 *
 * The chat route used to return a single 502 for every runAgent
 * failure, with a generic message that hid the actual cause. In
 * production we hit three failure modes repeatedly:
 *
 *   1. No LLM provider configured (the operator forgot to set
 *      LLM_PROVIDER or the env keys). `createLlmClient()` throws
 *      a specific error.
 *   2. LLM configured but the upstream call failed (rate limit,
 *      network, key revoked). The Anthropic / OpenAI SDK throws
 *      with an SDK-specific message.
 *   3. The agent loop exceeded its iteration budget or the
 *      TruthGate tripped in strict mode. The runtime throws with a
 *      domain-specific message.
 *
 * Each mode needs a different operator action, so we surface them
 * distinctly. The classifier is pure; the route applies the result.
 */

export type ChatErrorKind =
  | 'no-llm-configured'
  | 'llm-upstream-failure'
  | 'agent-aborted'
  | 'unexpected';

export interface ChatErrorClassification {
  readonly kind: ChatErrorKind;
  readonly status: number;
  /** Operator-facing message in Spanish. */
  readonly userMessage: string;
  /** Short, machine-readable hint for the UI to render a tooltip. */
  readonly hint: string;
}

const NO_LLM_HINTS = [
  'no hay proveedor llm configurado',
  'no hay proveedor de ia configurado',
  'no llm provider configured',
  'configure llm',
  'definí llm_provider',
];

const LLM_UPSTREAM_HINTS = [
  'rate limit',
  'rate_limit',
  'api key',
  'apikey',
  'authentication',
  'unauthorized',
  'network',
  'econnreset',
  'etimedout',
  'fetch failed',
  'timeout',
];

const AGENT_ABORTED_HINTS = [
  'aborted',
  'aborted by',
  'abstain',
  'truthgate tripped',
  'iteration budget',
  'max iterations',
];

/**
 * Classify a caught error from `runAgent`. Pure. Stable for the same
 * input. Conservative: when in doubt, returns `unexpected` so the
 * caller surfaces the full message rather than swallowing it.
 */
export function classifyChatError(error: unknown): ChatErrorClassification {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (NO_LLM_HINTS.some((h) => lower.includes(h))) {
    return {
      kind: 'no-llm-configured',
      status: 503,
      userMessage:
        'No hay proveedor de IA configurado. Definí LLM_PROVIDER (minimax, deepseek o qwen) y la API key correspondiente en el archivo .env del servidor. El chat queda deshabilitado hasta que haya al menos una.',
      hint: 'Configure LLM_PROVIDER and the matching API key in .env',
    };
  }
  if (AGENT_ABORTED_HINTS.some((h) => lower.includes(h))) {
    return {
      kind: 'agent-aborted',
      status: 422,
      userMessage: `El agente se interrumpió de forma controlada: ${message}`,
      hint: 'The agent loop aborted — likely a TruthGate strict-mode trip or an iteration budget exhaustion. See the server logs for the trace.',
    };
  }
  if (LLM_UPSTREAM_HINTS.some((h) => lower.includes(h))) {
    return {
      kind: 'llm-upstream-failure',
      status: 502,
      userMessage:
        'El proveedor de IA rechazó la consulta (límite de uso, autenticación o red). Reintentá en unos minutos o revisá la API key.',
      hint: `LLM upstream failed: ${message}`,
    };
  }
  return {
    kind: 'unexpected',
    status: 502,
    userMessage: `El proveedor de IA no pudo completar la consulta. Detalle: ${message}`,
    hint: 'Unclassified error from runAgent; see the server logs.',
  };
}
