/**
 * Public types for the TruthGate (Phase B, observation mode).
 *
 * Canonical definitions live in `@ftth-copilot/shared`; this module
 * re-exports them to preserve `@ftth-copilot/evidence`'s public API
 * without upward dependencies.
 *
 * `Verdict` is the unit of evidence-side awareness emitted by
 * `classifyEnvelope` / `classifyUnwrapped` and accumulated by
 * `runAgent` onto `AgentResult.verdicts`.
 *
 * Severity ranking is `incomplete (3) > stale (2) > low_confidence (1) > ok (0)`;
 * ties on code break on `severity` (`critical > warning > info > ok`).
 */

export type { Verdict, VerdictCode, VerdictSeverity } from '@ftth-copilot/shared';