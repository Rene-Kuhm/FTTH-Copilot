import { randomUUID } from 'node:crypto';
import {
  investigationResultSchema,
  MAX_INVESTIGATION_MISSING,
  MAX_INVESTIGATION_CONTRADICTIONS,
  type InvestigationResult,
  type InvestigationEvidenceRef,
  type InvestigationHypothesis,
  type InvestigationContradiction,
  type InvestigationMissing,
} from '@ftth-copilot/shared';
import {
  INVESTIGATION_PROMPT_VERSION,
  INVESTIGATION_RULESET_VERSION,
} from './investigation-prompt';

export type ValidationIssueCode =
  | 'cross_tenant_evidence'
  | 'out_of_window_evidence'
  | 'hallucinated_reference'
  | 'numerical_contradiction'
  | 'malformed_structure';

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  refId?: string;
  hypothesisId?: string;
}

export interface InvestigationValidationReport {
  isValid: boolean;
  issues: ValidationIssue[];
  sanitizedResult: InvestigationResult;
}

export interface ValidateInvestigationResultContext {
  expectedTenantId: string;
}

const RX_POWER_REGEX = /rx[-_ ]?power[:= ]+([+-]?\d+(?:\.\d+)?)/i;
const RX_DBM_REGEX = /([+-]?\d+(?:\.\d+)?)\s*dBm/i;

function parseRxPower(summary: string): number | null {
  const match = RX_POWER_REGEX.exec(summary);
  if (match) {
    const val = parseFloat(match[1]);
    if (!Number.isNaN(val)) return val;
  }
  const dbmMatch = RX_DBM_REGEX.exec(summary);
  if (dbmMatch) {
    const val = parseFloat(dbmMatch[1]);
    if (!Number.isNaN(val)) return val;
  }
  return null;
}

/**
 * Validates an InvestigationResult envelope on the server side:
 * - Checks tenant ownership against the authoritative tenantId.
 * - Enforces temporal window bounds on every evidence reference.
 * - Purges hallucinated citations from hypotheses.
 * - Detects numerical contradictions between cited metrics and hypothesis claims.
 * - Returns a sanitized, schema-compliant InvestigationResult.
 */
export function validateInvestigationResult(
  result: InvestigationResult,
  context: ValidateInvestigationResultContext,
): InvestigationValidationReport {
  const issues: ValidationIssue[] = [];

  let sanitizedTenantId = result.tenantId;
  let forceInsufficient = false;

  // 1. Tenant ownership verification
  if (result.tenantId !== context.expectedTenantId) {
    issues.push({
      code: 'cross_tenant_evidence',
      message: `Tenant mismatch: payload declares tenant '${result.tenantId}' but expected '${context.expectedTenantId}'`,
    });
    sanitizedTenantId = context.expectedTenantId;
    forceInsufficient = true;
  }

  // 2. Temporal window check on evidence refs
  const startMs = new Date(result.windowStart).getTime();
  const endMs = new Date(result.windowEnd).getTime();

  const sanitizedRefs: InvestigationEvidenceRef[] = [];
  const validRefMap = new Map<string, InvestigationEvidenceRef>();

  for (const ref of result.evidenceRefs) {
    const observedMs = new Date(ref.observedAt).getTime();
    if (observedMs < startMs || observedMs > endMs) {
      issues.push({
        code: 'out_of_window_evidence',
        message: `Evidence ref '${ref.evidenceRefId}' observedAt ${ref.observedAt} is outside window [${result.windowStart}, ${result.windowEnd}]`,
        refId: ref.evidenceRefId,
      });
      continue;
    }
    sanitizedRefs.push(ref);
    validRefMap.set(ref.evidenceRefId, ref);
  }

  // 3. Hypothesis citations and numerical coherence
  const sanitizedHypotheses: InvestigationHypothesis[] = [];
  const additionalContradictions: InvestigationContradiction[] = [];
  const additionalMissing: InvestigationMissing[] = [];

  for (const hyp of result.hypotheses) {
    const cleanForRefIds: string[] = [];
    const cleanAgainstRefIds: string[] = [];

    for (const id of hyp.forRefIds) {
      if (validRefMap.has(id)) {
        cleanForRefIds.push(id);
      } else {
        issues.push({
          code: 'hallucinated_reference',
          message: `Hypothesis '${hyp.hypothesisId}' cites non-existent or purged forRefId '${id}'`,
          refId: id,
          hypothesisId: hyp.hypothesisId,
        });
      }
    }

    for (const id of hyp.againstRefIds) {
      if (validRefMap.has(id)) {
        cleanAgainstRefIds.push(id);
      } else {
        issues.push({
          code: 'hallucinated_reference',
          message: `Hypothesis '${hyp.hypothesisId}' cites non-existent or purged againstRefId '${id}'`,
          refId: id,
          hypothesisId: hyp.hypothesisId,
        });
      }
    }

    // Check numerical consistency for optical metrics
    const hypClaimedRx = parseRxPower(hyp.summary);
    if (hypClaimedRx !== null) {
      for (const id of cleanForRefIds) {
        const ref = validRefMap.get(id);
        if (ref && ref.kind === 'metric') {
          const evidenceRx = parseRxPower(ref.summary);
          if (evidenceRx !== null) {
            // Discrepancy threshold: > 6 dB difference
            if (Math.abs(hypClaimedRx - evidenceRx) > 6.0) {
              issues.push({
                code: 'numerical_contradiction',
                message: `Numerical discrepancy: hypothesis claims ${hypClaimedRx} dBm but cited ref '${id}' records ${evidenceRx} dBm`,
                refId: id,
                hypothesisId: hyp.hypothesisId,
              });
              additionalContradictions.push({
                evidenceRefId: id,
                note: `Discrepancia detectada: la hipótesis afirma ${hypClaimedRx} dBm pero la telemetría registra ${evidenceRx} dBm.`,
              });
            }
          }
        }
      }
    }

    sanitizedHypotheses.push({
      ...hyp,
      forRefIds: cleanForRefIds,
      againstRefIds: cleanAgainstRefIds,
    });
  }

  // 4. Sanitize contradictions
  const sanitizedContradictions: InvestigationContradiction[] = [];
  for (const c of [...result.contradictions, ...additionalContradictions]) {
    if (sanitizedContradictions.length >= MAX_INVESTIGATION_CONTRADICTIONS) break;
    if (validRefMap.has(c.evidenceRefId)) {
      sanitizedContradictions.push(c);
    }
  }

  // 5. Build missing observations
  const sanitizedMissing: InvestigationMissing[] = [
    ...result.missing,
    ...additionalMissing,
  ];

  if (sanitizedRefs.length === 0) {
    sanitizedMissing.push({
      what: 'Evidencia autorizada y vigente para el tenant',
      whyItMatters: 'No existen referencias válidas dentro de la ventana de investigación',
    });
  }

  // 6. Adjust sufficiency
  let sufficiency = result.sufficiency;
  let sufficiencyReason = result.sufficiencyReason;

  if (forceInsufficient || sanitizedRefs.length === 0) {
    sufficiency = 'insufficient';
    sufficiencyReason = 'Investigación insuficiente debido a violaciones de aislamiento o ausencia de evidencia.';
  } else if (issues.length > 0 && sufficiency === 'sufficient') {
    sufficiency = 'provisional';
    sufficiencyReason = `Diagnóstico ajustado a provisional: se detectaron inconsistencias o referencias fuera de ventana (${issues.length} advertencias).`;
  }

  const sanitized: InvestigationResult = {
    ...result,
    tenantId: sanitizedTenantId,
    evidenceRefs: sanitizedRefs,
    hypotheses: sanitizedHypotheses,
    contradictions: sanitizedContradictions,
    missing: sanitizedMissing.slice(0, MAX_INVESTIGATION_MISSING),
    sufficiency,
    sufficiencyReason,
  };

  const parsed = investigationResultSchema.parse(sanitized);

  return {
    isValid: issues.length === 0,
    issues,
    sanitizedResult: parsed,
  };
}

/**
 * Builds a safe, fully valid InvestigationResult fallback envelope
 * when structure is corrupt or unparseable.
 */
export function buildSafeFallbackResult(args: {
  tenantId: string;
  connectionId: string | null;
  incidentId: string | null;
  runId: string;
  versionId: string;
  windowStart: string;
  windowEnd: string;
  reason: string;
  rulesetVersion?: string;
  modelVersion?: string;
  promptVersion?: string;
}): InvestigationResult {
  const startMs = new Date(args.windowStart).getTime();
  const endMs = new Date(args.windowEnd).getTime();
  const windowDaysRaw = (endMs - startMs) / (1000 * 60 * 60 * 24);
  const windowDays = windowDaysRaw > 0 ? parseFloat(windowDaysRaw.toFixed(4)) : 0.0001;

  const now = new Date().toISOString();

  const fallback: InvestigationResult = {
    schema: 'ftth.investigation-result.v1',
    resultId: `res-${randomUUID().slice(0, 12)}`,
    runId: args.runId,
    versionId: args.versionId,
    tenantId: args.tenantId,
    connectionId: args.connectionId,
    incidentId: args.incidentId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    windowDays,
    cutoffAt: now,
    rulesetVersion: args.rulesetVersion ?? INVESTIGATION_RULESET_VERSION,
    modelVersion: args.modelVersion ?? 'deterministic-fallback',
    promptVersion: args.promptVersion ?? INVESTIGATION_PROMPT_VERSION,
    evidenceRefs: [],
    hypotheses: [
      {
        hypothesisId: 'hyp-fallback',
        summary: 'Diagnóstico no disponible por falla estructural o de validación',
        supportLevel: 'unverified',
        forRefIds: [],
        againstRefIds: [],
      },
    ],
    contradictions: [],
    missing: [
      {
        what: `Recuperación de diagnóstico: ${args.reason}`,
        whyItMatters: 'Permite mantener la trazabilidad ante fallas del modelo o corrupción de datos',
      },
    ],
    suggestedChecks: [
      {
        checkId: 'chk-inspect-incident',
        kind: 'observe_only',
        description: 'Verificar telemetría actual y estado del incidente manualmente en NMS',
        expectedToResolve: 'Confirmar el estado de la conexión en tiempo real',
      },
    ],
    sufficiency: 'insufficient',
    sufficiencyReason: `Diagnóstico degradado: ${args.reason}`,
    producedAt: now,
    producedBy: 'agent-core@0.1.0',
  };

  return investigationResultSchema.parse(fallback);
}
