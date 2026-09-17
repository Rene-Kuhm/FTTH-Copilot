/**
 * `ftth.intention-corpus.v1` — Block 2 (diagnostic-router) intention
 * classification corpus schema.
 *
 * Stable JSON envelope for the 30+ cases consumed by `intention-runner.ts`.
 * The wire contract is intentionally narrow:
 *
 *   - schema           : literal `'ftth.intention-corpus.v1'`
 *   - version          : literal `1`
 *   - cases            : ≥1 entry; each validates against `intentionCaseSchema`
 *   - id               : non-empty stable string; the loader de-duplicates by id
 *   - surface          : one of the 7 mapped untrusted-input surfaces (same
 *                        vocabulary as `corpus-schema.ts` so the same corpus
 *                        loader pattern works)
 *   - userMessage      : non-empty string; the user-visible message
 *   - toolMocks        : optional array of `{ toolName, returns }`
 *   - expectedIntention: `'incident_diagnosis' | 'routine_topology' | 'advisory'`
 *
 * `.strict()` rejects unknown top-level keys so the wire format can never
 * drift across the corpus ↔ runner ↔ assertion boundary.
 */

import { z } from 'zod';
import {
  evalSurfaceSchema,
  toolMockSchema,
  type EvalSurface,
  type ToolMock,
} from './corpus-schema';

// ── Version markers ──────────────────────────────────────────────────────────

export const INTENTION_CORPUS_SCHEMA = 'ftth.intention-corpus.v1' as const;
export const INTENTION_CORPUS_VERSION = 1 as const;

// ── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * The three intention categories the diagnostic router distinguishes.
 * Mapped to two routing decisions:
 *   - `incident_diagnosis` → `rule_based` (high confidence, deterministic)
 *   - `routine_topology`   → `rule_based` (deterministic)
 *   - `advisory`           → `llm_agent` (LLM reasoning required)
 *
 * The router's confidence-gated path chooses between `rule_based`
 * (deterministic feature-based classifier) and `llm_agent` (full LLM agent).
 * Block 3 derives the gate threshold from the production distribution
 * collected by the metrics pipeline Block 1 just enabled.
 */
export const intentionLabelSchema = z.enum([
  'incident_diagnosis',
  'routine_topology',
  'advisory',
]);
export type IntentionLabel = z.infer<typeof intentionLabelSchema>;

// ── Single case ──────────────────────────────────────────────────────────────

export const intentionCaseSchema = z
  .object({
    id: z.string().min(1),
    surface: evalSurfaceSchema,
    userMessage: z.string().min(1),
    toolMocks: z.array(toolMockSchema).optional(),
    expectedIntention: intentionLabelSchema,
  })
  .strict();
export type IntentionCase = z.infer<typeof intentionCaseSchema>;

// ── Corpus envelope ──────────────────────────────────────────────────────────

export const intentionCorpusSchema = z
  .object({
    schema: z.literal(INTENTION_CORPUS_SCHEMA),
    version: z.literal(INTENTION_CORPUS_VERSION),
    description: z.string().optional(),
    cases: z.array(intentionCaseSchema).min(1),
  })
  .strict();
export type IntentionCorpus = z.infer<typeof intentionCorpusSchema>;

// ── Re-exports for runner convenience ────────────────────────────────────────

export type { EvalSurface, ToolMock };
