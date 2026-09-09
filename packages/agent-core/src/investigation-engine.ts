import { randomUUID } from 'node:crypto';
import {
  investigationResultSchema,
  MAX_INVESTIGATION_WINDOW_DAYS,
  MAX_INVESTIGATION_HYPOTHESES,
  MAX_INVESTIGATION_CONTRADICTIONS,
  MAX_INVESTIGATION_MISSING,
  MAX_INVESTIGATION_CHECKS,
  investigationCheckKinds,
  hypothesisSupportLevels,
  investigationSufficiencyStates,
  type InvestigationResult,
  type InvestigationEvidenceRef,
  type InvestigationHypothesis,
  type InvestigationContradiction,
  type InvestigationMissing,
  type InvestigationCheck,
  type InvestigationCheckKind,
  type HypothesisSupportLevel,
  type InvestigationSufficiencyState,
} from '@ftth-copilot/shared';
import { computeInvestigationFacts, type InvestigationFacts } from './investigation-facts';
import {
  buildInvestigationSystemPrompt,
  buildInvestigationUserMessage,
  extractJsonFromLlmText,
  INVESTIGATION_PROMPT_VERSION,
  INVESTIGATION_RULESET_VERSION,
} from './investigation-prompt';
import type { LlmClient } from './llm';

export interface InvestigationEngineArgs {
  tenantId: string;
  connectionId: string | null;
  incidentId: string | null;
  runId: string;
  versionId: string;
  windowStart: string;
  windowEnd: string;
  cutoffAt?: string;
  evidenceRefs: InvestigationEvidenceRef[];
  llmClient?: LlmClient;
  rulesetVersion?: string;
  modelVersion?: string;
  promptVersion?: string;
}

const ENGINE_PRODUCED_BY = 'agent-core@0.1.0';

/**
 * Builds deterministic hypotheses when LLM is absent or failed.
 */
function buildDeterministicHypotheses(
  facts: InvestigationFacts,
  evidenceRefs: InvestigationEvidenceRef[],
): InvestigationHypothesis[] {
  const hypotheses: InvestigationHypothesis[] = [];

  if (facts.events.indicatesPowerLoss) {
    const forRefIds = evidenceRefs
      .filter((r) => r.kind === 'event' && /dying[- ]?gasp|power loss/i.test(r.summary))
      .map((r) => r.evidenceRefId);
    hypotheses.push({
      hypothesisId: 'hyp-power-loss',
      summary: 'Corte de energía en el cliente (ONU envió Dying-Gasp antes de desconectarse)',
      supportLevel: 'supported',
      forRefIds,
      againstRefIds: [],
    });
  }

  if (facts.optical.hasCriticalAttenuation) {
    const forRefIds = evidenceRefs
      .filter((r) => r.kind === 'metric' && /rx[-_ ]?power/i.test(r.source + r.summary))
      .map((r) => r.evidenceRefId);
    hypotheses.push({
      hypothesisId: 'hyp-optical-degradation',
      summary: `Atenuación crítica en enlace óptico (Rx: ${facts.optical.minRxPower} dBm)`,
      supportLevel: 'supported',
      forRefIds,
      againstRefIds: [],
    });
  } else if (facts.events.indicatesFiberCut) {
    const forRefIds = evidenceRefs
      .filter((r) => r.kind === 'event' && /los|loss-of-signal/i.test(r.summary))
      .map((r) => r.evidenceRefId);
    hypotheses.push({
      hypothesisId: 'hyp-fiber-cut',
      summary: 'Pérdida de señal óptica (alarma LOS sin dying-gasp, compatible con daño de fibra)',
      supportLevel: 'supported',
      forRefIds,
      againstRefIds: [],
    });
  }

  if (hypotheses.length === 0) {
    hypotheses.push({
      hypothesisId: 'hyp-unverified-state',
      summary: 'Estado de conexión indeterminado o bajo observación',
      supportLevel: 'unverified',
      forRefIds: [],
      againstRefIds: [],
    });
  }

  return hypotheses.slice(0, MAX_INVESTIGATION_HYPOTHESES);
}

/**
 * Normalizes and bounds suggested checks to strictly allowed read-only kinds.
 */
function sanitizeChecks(rawChecks: unknown[]): InvestigationCheck[] {
  const allowedKinds = new Set<string>(investigationCheckKinds);
  const result: InvestigationCheck[] = [];

  for (let i = 0; i < rawChecks.length && result.length < MAX_INVESTIGATION_CHECKS; i++) {
    const c = rawChecks[i] as Record<string, unknown>;
    if (!c || typeof c !== 'object') continue;

    const checkId = typeof c.checkId === 'string' && c.checkId ? c.checkId : `chk-${i + 1}`;
    let kind: InvestigationCheckKind = 'observe_only';
    let description = typeof c.description === 'string' ? c.description : 'Comprobación técnica';

    if (typeof c.kind === 'string' && allowedKinds.has(c.kind)) {
      kind = c.kind as InvestigationCheckKind;
    } else {
      // Coerce forbidden kinds (e.g. reboot, provision) to safe observe_only
      kind = 'observe_only';
      description = `[Read-Only] Observación de estado previo a cualquier acción: ${description}`;
    }

    const expectedToResolve =
      typeof c.expectedToResolve === 'string' ? c.expectedToResolve : undefined;

    result.push({
      checkId,
      kind,
      description,
      expectedToResolve,
    });
  }

  return result;
}

/**
 * Investigates an incident by combining deterministic fact computation
 * with optional LLM cognitive synthesis, enforcing strict citation hygiene.
 */
export async function investigateIncident(
  args: InvestigationEngineArgs,
): Promise<InvestigationResult> {
  const startMs = new Date(args.windowStart).getTime();
  const endMs = new Date(args.windowEnd).getTime();

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error('Invalid ISO date string for windowStart or windowEnd');
  }

  if (endMs < startMs) {
    throw new Error('windowEnd must be >= windowStart');
  }

  const windowDaysRaw = (endMs - startMs) / (1000 * 60 * 60 * 24);
  if (windowDaysRaw > MAX_INVESTIGATION_WINDOW_DAYS) {
    throw new Error(`window cannot exceed ${MAX_INVESTIGATION_WINDOW_DAYS} days`);
  }

  // Schema requires positive number
  const windowDays = windowDaysRaw > 0 ? parseFloat(windowDaysRaw.toFixed(4)) : 0.0001;

  const producedAt = new Date().toISOString();
  const cutoffAt = args.cutoffAt ?? producedAt;

  // 1. Deterministic facts
  const facts = computeInvestigationFacts(args.evidenceRefs);
  const validRefIds = new Set(args.evidenceRefs.map((r) => r.evidenceRefId));

  let hypotheses: InvestigationHypothesis[] = [];
  let contradictions: InvestigationContradiction[] = [];
  let missing: InvestigationMissing[] = [...facts.deterministicMissing];
  let suggestedChecks: InvestigationCheck[] = [];
  let sufficiency: InvestigationSufficiencyState = 'provisional';
  let sufficiencyReason = '';
  let modelVersion = args.modelVersion ?? 'deterministic';

  // 2. LLM synthesis (if client provided)
  if (args.llmClient) {
    modelVersion = args.modelVersion ?? args.llmClient.provider;
    try {
      const systemPrompt = buildInvestigationSystemPrompt(facts, args.evidenceRefs);
      const userMessage = buildInvestigationUserMessage({
        incidentId: args.incidentId,
        connectionId: args.connectionId,
        tenantId: args.tenantId,
      });

      const response = await args.llmClient.createMessage({
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        tools: [],
      });

      const parsed = extractJsonFromLlmText(response.text);
      if (!parsed) {
        throw new Error('LLM response could not be parsed as JSON');
      }

      // 3. Sanitize hypotheses and citation integrity
      if (Array.isArray(parsed.hypotheses)) {
        for (let i = 0; i < parsed.hypotheses.length && hypotheses.length < MAX_INVESTIGATION_HYPOTHESES; i++) {
          const h = parsed.hypotheses[i] as Record<string, unknown>;
          if (!h || typeof h !== 'object') continue;

          const hypothesisId =
            typeof h.hypothesisId === 'string' && h.hypothesisId ? h.hypothesisId : `hyp-${i + 1}`;
          const summary =
            typeof h.summary === 'string' && h.summary ? h.summary : 'Hipótesis de diagnóstico';

          let supportLevel: HypothesisSupportLevel = 'unverified';
          if (
            typeof h.supportLevel === 'string' &&
            (hypothesisSupportLevels as readonly string[]).includes(h.supportLevel)
          ) {
            supportLevel = h.supportLevel as HypothesisSupportLevel;
          }

          // Strict citation filtering: drop any hallucinated ID
          const rawFor = Array.isArray(h.forRefIds) ? h.forRefIds : [];
          const rawAgainst = Array.isArray(h.againstRefIds) ? h.againstRefIds : [];

          const forRefIds = rawFor
            .filter((id): id is string => typeof id === 'string' && validRefIds.has(id));
          const againstRefIds = rawAgainst
            .filter((id): id is string => typeof id === 'string' && validRefIds.has(id));

          hypotheses.push({
            hypothesisId,
            summary,
            supportLevel,
            forRefIds,
            againstRefIds,
          });
        }
      }

      // 4. Sanitize contradictions
      if (Array.isArray(parsed.contradictions)) {
        for (const c of parsed.contradictions) {
          if (contradictions.length >= MAX_INVESTIGATION_CONTRADICTIONS) break;
          if (c && typeof c === 'object') {
            const raw = c as Record<string, unknown>;
            if (typeof raw.evidenceRefId === 'string' && validRefIds.has(raw.evidenceRefId)) {
              contradictions.push({
                evidenceRefId: raw.evidenceRefId,
                note: typeof raw.note === 'string' ? raw.note : '',
              });
            }
          }
        }
      }

      // 5. Missing observations from LLM
      if (Array.isArray(parsed.missing)) {
        for (const m of parsed.missing) {
          if (missing.length >= MAX_INVESTIGATION_MISSING) break;
          if (m && typeof m === 'object') {
            const raw = m as Record<string, unknown>;
            if (typeof raw.what === 'string' && raw.what) {
              missing.push({
                what: raw.what,
                whyItMatters: typeof raw.whyItMatters === 'string' ? raw.whyItMatters : undefined,
              });
            }
          }
        }
      }

      // 6. Suggested checks from LLM
      if (Array.isArray(parsed.suggestedChecks)) {
        suggestedChecks = sanitizeChecks(parsed.suggestedChecks);
      }

      // 7. Sufficiency from LLM
      if (
        typeof parsed.sufficiency === 'string' &&
        (investigationSufficiencyStates as readonly string[]).includes(parsed.sufficiency)
      ) {
        sufficiency = parsed.sufficiency as InvestigationSufficiencyState;
      }
      sufficiencyReason =
        typeof parsed.sufficiencyReason === 'string' && parsed.sufficiencyReason
          ? parsed.sufficiencyReason
          : 'Evaluación de suficiencia generada por el motor cognitivo.';
    } catch (err) {
      // Safe fallback on error or bad LLM response
      hypotheses = buildDeterministicHypotheses(facts, args.evidenceRefs);
      sufficiency = 'provisional';
      sufficiencyReason = `Fallback determinista: el análisis cognitivo LLM no estuvo disponible (${err instanceof Error ? err.message : 'error desconocido'}).`;
      missing.push({
        what: 'Interpretación cognitiva del modelo LLM',
        whyItMatters: 'Permite formular hipótesis alternativas y sugerencias avanzadas de comprobación',
      });
    }
  } else {
    // No LLM client provided: pure deterministic analysis
    hypotheses = buildDeterministicHypotheses(facts, args.evidenceRefs);
    if (args.evidenceRefs.length === 0) {
      sufficiency = 'insufficient';
      sufficiencyReason = 'No se registraron referencias de evidencia en la ventana temporal.';
    } else {
      sufficiency = 'provisional';
      sufficiencyReason = 'Diagnóstico provisional generado mediante reglas deterministas puras.';
    }
  }

  // Ensure at least one hypothesis exists
  if (hypotheses.length === 0) {
    hypotheses = buildDeterministicHypotheses(facts, args.evidenceRefs);
  }

  // Ensure suggested checks exist if missing observations are present
  if (suggestedChecks.length === 0) {
    suggestedChecks.push({
      checkId: 'chk-telemetry-status',
      kind: 'observe_only',
      description: 'Verificar estado actual del puerto y potencia óptica en NMS',
      expectedToResolve: 'Confirmar si la degradación persiste en tiempo real',
    });
  }

  const result: InvestigationResult = {
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
    cutoffAt,
    rulesetVersion: args.rulesetVersion ?? INVESTIGATION_RULESET_VERSION,
    modelVersion,
    promptVersion: args.promptVersion ?? INVESTIGATION_PROMPT_VERSION,
    evidenceRefs: args.evidenceRefs,
    hypotheses,
    contradictions,
    missing: missing.slice(0, MAX_INVESTIGATION_MISSING),
    suggestedChecks,
    sufficiency,
    sufficiencyReason,
    producedAt,
    producedBy: ENGINE_PRODUCED_BY,
  };

  // Enforce runtime schema contract
  return investigationResultSchema.parse(result);
}
