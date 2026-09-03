/**
 * TruthGate — Phase B observation-mode envelope classifier (Fase B).
 *
 * This file is built incrementally via strict TDD. Each task adds one
 * behaviour with a failing test first, then the minimum code to pass.
 * Until task 2.5 lands the full type surface, local types stay minimal.
 */

export interface Verdict {
  toolName: string;
  code: 'ok' | 'low_confidence' | 'stale' | 'incomplete';
  reason: string;
  severity: 'ok' | 'info' | 'warning' | 'critical';
}

/**
 * Classifies a tool result that does not carry a parseable envelope
 * (`null`, `undefined`, error JSON, plain text). The gate records it
 * as `incomplete / no-envelope / critical`; the data still reaches
 * the LLM unchanged.
 */
export function classifyUnwrapped(toolName: string): Verdict {
  return {
    toolName,
    code: 'incomplete',
    reason: 'no-envelope',
    severity: 'critical',
  };
}