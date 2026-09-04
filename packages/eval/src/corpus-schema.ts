/**
 * `ftth.eval-corpus.v1` — Phase F-2 corpus schema.
 *
 * Stable JSON envelope for the committable corpus fixtures consumed by
 * the Phase F-4 runner. The wire contract mirrors the per-surface
 * untrusted-input taxonomy from
 * `openspec/changes/fase-f-eval-injection/specs/injection-defense/spec.md`
 * (7 surfaces × 7 injection kinds × 3 expected gates).
 *
 * Field bounds:
 *   - schema     : literal `'ftth.eval-corpus.v1'` (the version literal
 *                  is part of the schema so producers can never silently
 *                  emit a shape the consumer does not understand)
 *   - version    : literal `1`
 *   - cases      : ≥1 entry; each validates against `evalCaseSchema`
 *   - id         : non-empty stable string; the F-4 loader de-duplicates
 *                  by `id` across the pink/red files
 *   - surface    : one of the 7 mapped untrusted-input surfaces
 *   - userMessage: non-empty string; the user-visible message that the
 *                  runner feeds into `runAgent`
 *   - toolMocks  : optional array of `{ toolName, returns }`; the F-4
 *                  runner uses these to script `executeToolCall`
 *                  responses (the same `withToolResults` seam proven in
 *                  `packages/agent-core/tests/runtime.test.ts:320-333`)
 *   - expectedGate : `'allow' | 'warn' | 'abstain'`; the gate the
 *                    F-4 runner asserts against
 *   - injectionKind: optional; one of the 7 attack kinds. Only set on
 *                    red cases. Pink cases leave it undefined because
 *                    no injection intent exists.
 *
 * `.strict()` rejects unknown top-level keys so the wire format can
 * never drift across the corpus fixtures ↔ loader ↔ runner boundary.
 */

import { z } from 'zod';

// ── Version markers ──────────────────────────────────────────────────────────

export const EVAL_CORPUS_SCHEMA = 'ftth.eval-corpus.v1' as const;
export const EVAL_CORPUS_VERSION = 1 as const;

// ── Vocabularies ────────────────────────────────────────────────────────────

export const evalSurfaceSchema = z.enum([
  'user-message',
  'conversation-history',
  'tool-args',
  'connector-payload',
  'retrieval-block',
  'system-assembly',
  'prediction-provider',
]);
export type EvalSurface = z.infer<typeof evalSurfaceSchema>;

export const injectionKindSchema = z.enum([
  'direct-override',
  'role-reassignment',
  'customer-name-smuggle',
  'connector-payload-smuggle',
  'retrieval-row-smuggle',
  'prediction-smuggle',
  'system-injection',
]);
export type InjectionKind = z.infer<typeof injectionKindSchema>;

export const expectedGateSchema = z.enum(['allow', 'warn', 'abstain']);
export type ExpectedGate = z.infer<typeof expectedGateSchema>;

// ── Tool mock shape ─────────────────────────────────────────────────────────

export const toolMockSchema = z
  .object({
    toolName: z.string().min(1),
    returns: z.unknown(),
  })
  .strict();
export type ToolMock = z.infer<typeof toolMockSchema>;

// ── Single case ─────────────────────────────────────────────────────────────

export const evalCaseSchema = z
  .object({
    id: z.string().min(1),
    surface: evalSurfaceSchema,
    userMessage: z.string().min(1),
    toolMocks: z.array(toolMockSchema).optional(),
    expectedGate: expectedGateSchema,
    injectionKind: injectionKindSchema.optional(),
  })
  .strict();
export type EvalCase = z.infer<typeof evalCaseSchema>;

// ── Corpus envelope ─────────────────────────────────────────────────────────

export const evalCorpusSchema = z
  .object({
    schema: z.literal(EVAL_CORPUS_SCHEMA),
    version: z.literal(EVAL_CORPUS_VERSION),
    cases: z.array(evalCaseSchema).min(1),
  })
  .strict();
export type EvalCorpus = z.infer<typeof evalCorpusSchema>;
