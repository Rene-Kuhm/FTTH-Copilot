/**
 * Block 2 (diagnostic-router) — keyless intention corpus runner.
 *
 * Reuses the `RunnerDeps` shape from `runner.ts` so the test surface and
 * production surface stay uniform. The `runAgent` function is injected
 * via `deps` and the test path passes a stub that returns the expected
 * intention (the harness does NOT exercise the LLM runtime).
 *
 * Accuracy threshold: ≥ 0.95 of cases must classify to the expected
 * intention. False-routing (a label that is neither the expected one nor
 * a deterministic-adjacent one) must equal zero.
 *
 * Adjacency rules (what counts as "not false"):
 *   - `incident_diagnosis` ↔ `routine_topology`: both deterministic;
 *     only false-routing is `advisory` (which forces the LLM path).
 *   - `routine_topology`   ↔ `incident_diagnosis`: same as above.
 *   - `advisory`            ↔ any: never adjacent; always false-routed
 *     to the rule-based path because advisory → LLM is the only valid
 *     mapping per Block 3's design.
 */

import type { IntentionCase, IntentionLabel } from './intention-schema';
import {
  classifyIntention,
  type IntentionContext,
} from './intention-classifier';

export interface IntentionRunnerDeps {
  /**
   * `runAgent` from `@ftth-copilot/agent-core`, injected so the runner
   * stays keyless. The test path passes a stub that returns the
   * expected intention; the nightly leg could pass the real agent.
   * Not consumed by `intention-runner.ts` directly — Block 3's router
   * will dispatch to `runAgent` based on the classified intention.
   */
  runAgent?: (opts: Record<string, unknown>) => Promise<unknown>;
}

export interface IntentionRunResult {
  case: IntentionCase;
  actual: IntentionLabel;
  expected: IntentionLabel;
  correct: boolean;
  /**
   * `false` when the actual label is non-adjacent to the expected one.
   * Block 3 will route based on the actual label, so a false routing
   * would route an `incident_diagnosis` to the LLM when the deterministic
   * path was correct (or vice versa).
   */
  falseRouted: boolean;
  scores: {
    incident_diagnosis: number;
    routine_topology: number;
    advisory: number;
  };
}

export interface IntentionRunSummary {
  casesRun: number;
  results: IntentionRunResult[];
  accuracy: number;
  falseRoutedCount: number;
}

/** Adjacency: `incident_diagnosis` and `routine_topology` are interchangeable; `advisory` is isolated. */
export function isAdjacent(a: IntentionLabel, b: IntentionLabel): boolean {
  if (a === b) return true;
  if ((a === 'incident_diagnosis' && b === 'routine_topology') ||
      (a === 'routine_topology' && b === 'incident_diagnosis')) {
    return true;
  }
  return false;
}

/**
 * Runs a single corpus case. Builds the `IntentionContext` from the case,
 * calls the deterministic classifier, and records accuracy + adjacency.
 *
 * `case_.expectedIntention` is the contract; `correct` is strict equality
 * with `actual`. `falseRouted` is the routing-layer concern: a case
 * expected as `incident_diagnosis` that classifies as `advisory` is
 * BOTH incorrect AND false-routed (advisory forces the LLM path when
 * the deterministic path was correct).
 */
export function runIntentionCase(
  case_: IntentionCase,
  _deps?: IntentionRunnerDeps,
): IntentionRunResult {
  const ctx: IntentionContext = {
    surface: case_.surface,
    userMessage: case_.userMessage,
    toolMocks: case_.toolMocks,
  };
  const { label, scores } = classifyIntention(ctx);
  return {
    case: case_,
    actual: label,
    expected: case_.expectedIntention,
    correct: label === case_.expectedIntention,
    falseRouted: !isAdjacent(label, case_.expectedIntention),
    scores,
  };
}

/**
 * Sequentially runs every case. Sequential is intentional — vitest is
 * single-threaded and the corpus is small (~30 cases). Determinism
 * matters more than throughput at this scale.
 */
export function runIntentionCorpus(
  corpus: { cases: IntentionCase[] },
  deps?: IntentionRunnerDeps,
): IntentionRunSummary {
  const results: IntentionRunResult[] = [];
  for (const case_ of corpus.cases) {
    results.push(runIntentionCase(case_, deps));
  }
  const correct = results.filter((r) => r.correct).length;
  const falseRoutedCount = results.filter((r) => r.falseRouted).length;
  return {
    casesRun: results.length,
    results,
    accuracy: results.length === 0 ? 0 : correct / results.length,
    falseRoutedCount,
  };
}

/**
 * Default accuracy threshold — Block 2's spec mandates ≥ 0.95.
 * Exposed as a constant so tests can reference it and the gate check
 * can read it without a magic number.
 */
export const INTENTION_ACCURACY_THRESHOLD = 0.95;

/**
 * Default false-routing threshold — Block 2's spec mandates = 0.
 */
export const INTENTION_FALSE_ROUTING_THRESHOLD = 0;
