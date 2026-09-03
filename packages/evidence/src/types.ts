/**
 * Public types for the TruthGate (Phase B, observation mode).
 *
 * `Verdict` is the unit of evidence-side awareness emitted by
 * `classifyEnvelope` / `classifyUnwrapped` and accumulated by
 * `runAgent` onto `AgentResult.verdicts`.
 *
 * Severity ranking is `incomplete (3) > stale (2) > low_confidence (1) > ok (0)`;
 * ties on code break on `severity` (`critical > warning > info > ok`).
 */

export type VerdictCode = 'ok' | 'low_confidence' | 'stale' | 'incomplete';

export type VerdictSeverity = 'ok' | 'info' | 'warning' | 'critical';

export interface Verdict {
  toolName: string;
  code: VerdictCode;
  reason: string;
  severity: VerdictSeverity;
}