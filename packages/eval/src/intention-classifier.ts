/**
 * Block 2 (diagnostic-router) — deterministic, keyless intention classifier.
 *
 * Given a conversation context (the user message plus optional tool
 * mocks), this returns one of three intention labels:
 *   - `incident_diagnosis`: customer-facing outage / hardware fault
 *   - `routine_topology`  : network query, no urgent diagnosis
 *   - `advisory`          : educational / best-practice
 *
 * Block 2 v1 implementation strategy:
 *   1. Urgency pre-check: if any URGENCY_OVERRIDE token matches, label
 *      = `incident_diagnosis` (forces the LLM path through the router).
 *   2. Advisory pre-check: if any ADVISORY_OVERRIDE token matches, label
 *      = `advisory` (forces the LLM path).
 *   3. Otherwise, surface-based heuristic:
 *        - `user-message` → `advisory` (most ambiguous surface)
 *        - `tool-args`, `connector-payload`, `prediction-provider`,
 *          `retrieval-block`, `system-assembly`,
 *          `conversation-history` → `routine_topology` (deterministic
 *          surfaces where structure is implicit)
 *   4. Tie-break / fallback to keyword scoring when surface is ambiguous.
 *
 * Why a heuristic instead of a learned classifier:
 *   - Block 1's instrumentation is the priority. The v1 classifier is
 *     a deterministic placeholder so Block 3's router can ship.
 *   - Block 3's threshold-sweep property test (`router.test.ts`) is the
 *     REAL safety guarantee — no injection case may reach the LLM.
 *   - The full keyword scoring lives in `matchKeywords` / `scoreFromMatches`
 *     for Block 3 to enrich; calibration needs real production data.
 *   - The eval-nightly workflow runs on real MiniMax-M3 and can replace
 *     this heuristic with a learned model once data is in.
 *
 * The heuristic is intentionally conservative: it prefers
 * `incident_diagnosis` when an urgency token matches (no missed outage)
 * and prefers `advisory` for ambiguous surfaces (LLM answers safely).
 * False-positive `incident_diagnosis` for routine cases is acceptable
 * because the LLM still produces a correct answer; the cost is the
 * extra tokens, which Block 1's metrics now make measurable.
 */

import type { IntentionLabel } from './intention-schema';

/** Context surface + user message + tool mocks. */
export interface IntentionContext {
  surface: string;
  userMessage: string;
  toolMocks?: ReadonlyArray<{ toolName: string; returns?: unknown }>;
}

/** Per-label keyword score in [0, 1]. */
export interface IntentionScores {
  incident_diagnosis: number;
  routine_topology: number;
  advisory: number;
}

/** Per-label matched tokens (lowercased, normalized). */
export interface IntentionMatches {
  incident_diagnosis: string[];
  routine_topology: string[];
  advisory: string[];
}

/**
 * Tokens that, when present, force incident_diagnosis. These are
 * stronger signals than the keyword dictionary scores — Block 2 v1
 * uses them as a precedence rule to avoid missing urgent cases.
 *
 * Block 3 should review and extend this list once production data
 * shows real distribution patterns.
 */
export const URGENCY_OVERRIDE: ReadonlyArray<string> = [
  'loi',
  'sin servicio',
  'caido',
  'caidos',
  'sin conexion',
  'sin internet',
  'sin senal',
  'no responde',
  'no navega',
  'no funciona',
  'averia',
  'outage',
  'critico',
  'critica',
  'falla',
  'fallo',
];

/**
 * Tokens that force `advisory`. These are clear signals of a question /
 * best-practice ask — even when the message also references network
 * elements, the user is asking to LEARN rather than diagnose.
 */
export const ADVISORY_OVERRIDE: ReadonlyArray<string> = [
  'cómo',
  'como',
  'qué es',
  'que es',
  'qué significa',
  'que significa',
  'mejor práctica',
  'mejor practica',
  'buenas prácticas',
  'buenas practicas',
  'para qué sirve',
  'para que sirve',
  'recomiéndame',
  'recomiendame',
  'recomendá',
  'entender',
  'explicame',
  'explicá',
  'explica',
  'diferencia entre',
  'cuál es la diferencia',
  'cual es la diferencia',
];

const TOPOLOGY_SURFACES = new Set([
  'tool-args',
  'connector-payload',
  'prediction-provider',
  'retrieval-block',
  'system-assembly',
  'conversation-history',
]);

// ── Normalization ──────────────────────────────────────────────────────────

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()\[\]"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Keyword scoring (Block 3 enrichment surface) ──────────────────────────

const KEYWORDS: Record<IntentionLabel, ReadonlyArray<string>> = {
  incident_diagnosis: [
    'loi',
    'sin servicio',
    'caído',
    'caídos',
    'corte',
    'masivo',
    'urgente',
    'crítico',
    'critico',
    'falla',
    'fallo',
    'averia',
    'avería',
    'sin internet',
    'sin senal',
    'sin señal',
    'revisa',
    'investiga',
  ],
  routine_topology: [
    'árbol',
    'arbol',
    'topología',
    'topologia',
    'puertos',
    'lista',
    'listar',
    'listame',
    'muéstrame',
    'mostrame',
    'conectada',
    'conectado',
    'cuántos',
    'cuantas',
    'cuántas',
    'detalle',
    'detalles',
    'mapa',
  ],
  advisory: [
    'cómo',
    'como',
    'qué es',
    'que es',
    'qué significa',
    'que significa',
    'recomendación',
    'recomendacion',
    'recomendá',
    'recomienda',
    'mejor práctica',
    'mejor practica',
    'buenas prácticas',
    'buenas practicas',
    'threshold',
    'umbral',
    'configurar',
    'configuración',
    'configuracion',
    'significa',
    'explicame',
    'explicá',
    'para qué sirve',
    'para que sirve',
    'algoritmo',
    'funciona',
    'enseñame',
    'diferencia',
  ],
};

/**
 * Word-boundary keyword match (Block 3 enrichment surface). Returns
 * matched token arrays per label. Phrases (containing space) skip
 * boundaries because they span tokens; single words require
 * \\b boundaries so "los" doesn't match "OLTs".
 */
export function matchKeywords(text: string): IntentionMatches {
  const normalized = normalizeText(text);
  const matched: IntentionMatches = {
    incident_diagnosis: [],
    routine_topology: [],
    advisory: [],
  };
  for (const label of ['incident_diagnosis', 'routine_topology', 'advisory'] as const) {
    for (const kw of KEYWORDS[label]) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isPhrase = kw.includes(' ');
      const pattern = isPhrase ? escaped : `\\b${escaped}\\b`;
      const regex = new RegExp(pattern, 'i');
      if (regex.test(normalized)) {
        matched[label].push(kw);
      }
    }
  }
  return matched;
}

/** Pure: scores = distinctMatches / totalKeywordsForLabel, capped at 1. */
export function scoreFromMatches(matches: IntentionMatches): IntentionScores {
  const scores: IntentionScores = {
    incident_diagnosis: 0,
    routine_topology: 0,
    advisory: 0,
  };
  for (const label of ['incident_diagnosis', 'routine_topology', 'advisory'] as const) {
    const total = KEYWORDS[label].length;
    const distinct = matches[label].length;
    scores[label] = total === 0 ? 0 : Math.min(distinct / total, 1);
  }
  return scores;
}

/** Pure: highest score wins; ties → TIE_BREAK_ORDER; all-zero → advisory. */
export function selectLabel(scores: IntentionScores): IntentionLabel {
  const maxScore = Math.max(
    scores.incident_diagnosis,
    scores.routine_topology,
    scores.advisory,
  );
  if (maxScore === 0) {
    return 'advisory';
  }
  // Tie-break: incident_diagnosis first (safety wins ties).
  if (scores.incident_diagnosis === maxScore) return 'incident_diagnosis';
  if (scores.routine_topology === maxScore) return 'routine_topology';
  return 'advisory';
}

// ── Heuristic driver ──────────────────────────────────────────────────────

function hasOverride(text: string, tokens: ReadonlyArray<string>): boolean {
  const normalized = normalizeText(text);
  return tokens.some((tok) => normalized.includes(tok));
}

/**
 * End-to-end classifier. Returns the label + scores + matches for
 * inspection. See file header for the precedence rules.
 */
export function classifyIntention(ctx: IntentionContext): {
  label: IntentionLabel;
  scores: IntentionScores;
  matches: IntentionMatches;
  surfaceDefaulted: boolean;
} {
  const toolMockSummary = (ctx.toolMocks ?? [])
    .map((m) => `${m.toolName} ${JSON.stringify(m.returns ?? null)}`)
    .join(' ');
  const combined = `${ctx.userMessage} ${ctx.surface} ${toolMockSummary}`;

  const matches = matchKeywords(combined);
  const scores = scoreFromMatches(matches);

  // Precedence 1: urgency overrides everything.
  if (hasOverride(combined, URGENCY_OVERRIDE)) {
    return { label: 'incident_diagnosis', scores, matches, surfaceDefaulted: false };
  }

  // Precedence 2: advisory override beats surface heuristic.
  if (hasOverride(combined, ADVISORY_OVERRIDE)) {
    return { label: 'advisory', scores, matches, surfaceDefaulted: false };
  }

  // Precedence 3: surface-based heuristic for ambiguous messages.
  if (scores.incident_diagnosis === 0 && scores.routine_topology === 0 && scores.advisory === 0) {
    const fallback = TOPOLOGY_SURFACES.has(ctx.surface) ? 'routine_topology' : 'advisory';
    return { label: fallback, scores, matches, surfaceDefaulted: true };
  }

  const label = selectLabel(scores);
  return { label, scores, matches, surfaceDefaulted: false };
}
