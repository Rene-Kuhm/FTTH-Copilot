/**
 * Quality → TruthGate bridge (Fase 2 PR #2).
 *
 * Connects the evidence-quality primitives (assessFreshness,
 * toQualityVerdict) to the agent's existing verdict accumulation
 * path. The bridge is OPT-IN: it does not touch `runAgent` and
 * is OFF by default, in line with the roadmap MUST-10 rule
 * (migraciones aditivas + flags desactivados por defecto + rollback).
 *
 * Callers that want quality verdicts on the investigation record
 * invoke `qualityVerdictFromToolSamples` after they have collected
 * (or projected) a sample series for a tool. The resulting Verdict
 * re-uses the existing Verdict shape — no schema change — so it
 * appends to `AgentResult.verdicts` the same way `classifyEnvelope`
 * verdicts do.
 *
 * Design notes:
 *
 * - The bridge MUST NOT fabricate a device-down claim. It surfaces
 *   the evidence stream's quality; the caller decides what to say
 *   about the device.
 * - The Verdict's `reason` carries the QualityReason verbatim, so
 *   the investigation UI can show "stale-no-sample", "unknown-gap",
 *   "counter-reset", etc. without parsing the message.
 */

import {
  assessFreshness,
  toQualityVerdict,
  type QualityResult,
  type QualitySample,
  type SourcePolicy,
  type Verdict,
} from '@ftth-copilot/evidence';

export interface QualityVerdictFromToolArgs {
  /** The tool whose series is being assessed (e.g. 'list_onus'). */
  readonly toolName: string;
  /** The projected samples for that tool within the window of interest. */
  readonly samples: readonly QualitySample[];
  /** The source policy that calibrates the assessment (2.1). */
  readonly policy: SourcePolicy;
  /** Synthetic clock; defaults to Date.now() (test-only path passes it explicitly). */
  readonly nowMs?: number;
}

export interface QualityVerdictFromToolResult {
  /** The TruthGate-compatible Verdict, ready to push into `verdicts[]`. */
  readonly verdict: Verdict;
  /** The underlying QualityResult, for callers that need the structured reason. */
  readonly result: QualityResult;
}

/**
 * Project a tool's sample series onto a TruthGate Verdict.
 *
 * This function is the **only** public surface of the bridge. It is
 * pure (except for the optional `nowMs` default) and idempotent: the
 * same inputs produce the same Verdict.
 */
export function qualityVerdictFromToolSamples(
  args: QualityVerdictFromToolArgs,
): QualityVerdictFromToolResult {
  const nowMs = args.nowMs ?? Date.now();
  const result = assessFreshness(args.samples, args.policy, nowMs);
  const verdict = toQualityVerdict({ toolName: args.toolName, result });
  return { verdict, result };
}
