/**
 * TruthGate — Phase B observation-mode envelope classifier (Fase B).
 *
 * This file is built incrementally via strict TDD. Each task adds one
 * behaviour with a failing test first, then the minimum code to pass.
 * Until task 2.5 lands the full type surface, local types stay minimal.
 */
import { evidenceProvenanceSchema, type EvidenceProvenance } from '@ftth-copilot/shared';

export interface Verdict {
  toolName: string;
  code: 'ok' | 'low_confidence' | 'stale' | 'incomplete';
  reason: string;
  severity: 'ok' | 'info' | 'warning' | 'critical';
}

const SEVERITY_RANK: Record<Verdict['severity'], number> = {
  ok: 0,
  info: 1,
  warning: 2,
  critical: 3,
};

const CODE_RANK: Record<Verdict['code'], number> = {
  ok: 0,
  low_confidence: 1,
  stale: 2,
  incomplete: 3,
};

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

/**
 * Classifies the confidence dimension of a successfully-parsed
 * envelope. Missing field → `low_confidence / missing-confidence /
 * warning`; value `< 0.3` → `low_confidence / low-confidence-value /
 * warning`; `>= 0.3` → no candidate (passes).
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
 * Classifies the staleness dimension. Strict `now > observedAt + ttlMs`
 * produces `stale / expired-ttl / warning`; equality is fresh.
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
 * Classifies the completeness dimension. `complete` → no candidate
 * (passes); `partial` → `incomplete / partial-completeness /
 * warning`; `minimal` → `incomplete / minimal-completeness / critical`.
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
 * `ok / fresh-complete / ok` when none apply.
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
 * Classifies an already-parsed tool result envelope against the
 * evidence.provenance.v1 schema. Parses with zod's safeParse; if the
 * payload is not an envelope it is recorded as `incomplete /
 * parse-error / critical`. Confidence / staleness / completeness
 * dimensions each contribute a candidate verdict (or none); the highest
 * severity wins. `now` is injected for testability.
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