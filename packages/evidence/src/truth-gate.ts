/**
 * TruthGate — Phase B observation-mode envelope classifier.
 *
 * Pure functions over `evidence.provenance.v1` envelopes. Verdicts are
 * collected per dimension (parse, confidence, staleness, completeness)
 * and the highest-severity verdict wins. Aggregated output is a single
 * `Verdict` (`@ftth-copilot/evidence/src/types`) that `runAgent`
 * accumulates onto `AgentResult.verdicts`.
 *
 * Observe mode: this module never throws and never blocks data flow.
 * Callers must always pass the raw tool result string to the LLM as-is.
 */
import { evidenceProvenanceSchema, type EvidenceProvenance } from '@ftth-copilot/shared';
import type { Verdict, VerdictCode, VerdictSeverity } from './types';

export type { Verdict, VerdictCode, VerdictSeverity } from './types';

const SEVERITY_RANK: Record<VerdictSeverity, number> = {
  ok: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

const CODE_RANK: Record<VerdictCode, number> = {
  ok: 0,
  low_confidence: 1,
  stale: 2,
  incomplete: 3,
};

/**
 * Classifies a tool result that does not carry a parseable envelope
 * (`null`, `undefined`, error JSON, plain text). The gate records it
 * as `incomplete / no-envelope / critical`; the data still reaches
 * the LLM unchanged (observe mode never gates data flow).
 *
 * @param toolName - The name of the tool whose result failed to
 *   produce an envelope. Stored on the verdict so Fase C can correlate
 *   with `toolCalls[i].name`.
 * @returns A `Verdict` with `code='incomplete'`, `reason='no-envelope'`,
 *   `severity='critical'`, and the supplied `toolName`.
 */
export function classifyUnwrapped(toolName: string): Verdict {
  return {
    toolName,
    code: 'incomplete',
    reason: 'no-envelope',
    severity: 'critical',
  };
}

/**
 * Confidence dimension. Missing → `low_confidence / missing-confidence /
 * warning`. Value strictly `< 0.3` → `low_confidence / low-confidence-value /
 * warning`. `>= 0.3` (inclusive) passes.
 */
function classifyConfidence(env: EvidenceProvenance, toolName: string): Verdict | null {
  if (env.confidence === undefined) {
    return { toolName, code: 'low_confidence', reason: 'missing-confidence', severity: 'warning' };
  }
  if (env.confidence < 0.3) {
    return { toolName, code: 'low_confidence', reason: 'low-confidence-value', severity: 'warning' };
  }
  return null;
}

/**
 * Staleness dimension. Strict `now > observedAt + ttlMs` produces
 * `stale / expired-ttl / warning`; edge equality is fresh.
 */
function classifyStaleness(
  env: EvidenceProvenance,
  toolName: string,
  now: Date,
): Verdict | null {
  const observedAtMs = new Date(env.observedAt).getTime();
  const expiresAtMs = observedAtMs + env.ttlMs;
  if (now.getTime() > expiresAtMs) {
    return { toolName, code: 'stale', reason: 'expired-ttl', severity: 'warning' };
  }
  return null;
}

/**
 * Completeness dimension. `complete` → no candidate; `partial` →
 * `incomplete / partial-completeness / warning`; `minimal` →
 * `incomplete / minimal-completeness / critical`.
 */
function classifyCompleteness(env: EvidenceProvenance, toolName: string): Verdict | null {
  switch (env.completeness) {
    case 'complete':
      return null;
    case 'partial':
      return {
        toolName,
        code: 'incomplete',
        reason: 'partial-completeness',
        severity: 'warning',
      };
    case 'minimal':
      return {
        toolName,
        code: 'incomplete',
        reason: 'minimal-completeness',
        severity: 'critical',
      };
  }
}

/**
 * Picks the highest-severity verdict from a candidate set, returning
 * `ok / fresh-complete / ok` when none apply. Tie-break on severity:
 * `critical > warning > info > ok`. `code` rank wins over `severity`
 * for the primary sort (`incomplete > stale > low_confidence > ok`).
 */
function rankVerdicts(candidates: Verdict[], toolName: string): Verdict {
  if (candidates.length === 0) {
    return { toolName, code: 'ok', reason: 'fresh-complete', severity: 'ok' };
  }
  const sorted = [...candidates].sort((a, b) => {
    const codeDelta = CODE_RANK[b.code] - CODE_RANK[a.code];
    if (codeDelta !== 0) return codeDelta;
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });
  return sorted[0];
}

/**
 * Classifies an already-parsed tool result envelope.
 *
 * Behaviour by input shape:
 * - Non-object payload or JSON-parse failure: returns
 *   `incomplete / parse-error / critical` directly (no envelope found).
 * - Valid envelope: collects candidate verdicts from the three
 *   independent dimensions (confidence, staleness, completeness) and
 *   returns the highest-severity candidate. If none apply, returns
 *   `ok / fresh-complete / ok`.
 *
 * Severity ordering: `incomplete (3) > stale (2) > low_confidence (1)
 * > ok (0)`. Within a code, the `severity` field breaks the tie
 * (`critical > warning > info > ok`).
 *
 * Single classification path — demo envelopes (`source: '*.demo'`)
 * and live envelopes (`source: '*.poll'`) with identical fields
 * produce identical verdicts. There is no mode-conditional threshold.
 *
 * @param parsed - The result of `JSON.parse(rawToolResult)`. If this is
 *   not an envelope, the verdict is `incomplete / parse-error`.
 * @param toolName - The name of the originating tool; stored on every
 *   returned verdict.
 * @param now - Optional reference clock for the staleness check.
 *   Defaults to `new Date()` (the time the gate is invoked). Inject
 *   for testability.
 * @returns A `Verdict` describing the highest-severity classification.
 *   Observe mode: the caller must still pass the raw tool result
 *   string to the LLM unchanged.
 */
export function classifyEnvelope(parsed: unknown, toolName: string, now?: Date): Verdict {
  const parseResult = evidenceProvenanceSchema.safeParse(parsed);
  if (!parseResult.success) {
    return rankVerdicts(
      [{ toolName, code: 'incomplete', reason: 'parse-error', severity: 'critical' }],
      toolName,
    );
  }

  const candidates: Verdict[] = [];
  const confidenceVerdict = classifyConfidence(parseResult.data, toolName);
  if (confidenceVerdict) candidates.push(confidenceVerdict);

  const referenceNow = now ?? new Date();
  const stalenessVerdict = classifyStaleness(parseResult.data, toolName, referenceNow);
  if (stalenessVerdict) candidates.push(stalenessVerdict);

  const completenessVerdict = classifyCompleteness(parseResult.data, toolName);
  if (completenessVerdict) candidates.push(completenessVerdict);

  return rankVerdicts(candidates, toolName);
}