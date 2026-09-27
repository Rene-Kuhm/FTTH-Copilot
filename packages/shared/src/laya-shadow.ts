/**
 * Laya Shadow Mode - Decision Logging
 * 
 * Logs Laya decisions for later comparison and validation.
 * In shadow mode, decisions are recorded but not used for routing.
 * 
 * Usage:
 *   import { logLayaDecision } from '@ftth-copilot/shared';
 *   await logLayaDecision({ tenantId, eventId, ... }, result, 'shadow');
 */

import type { ClassificationResult, EventClass, Severity, ProbableScope } from './laya-expert-system';

export type LayaMode = 'disabled' | 'shadow' | 'assisted' | 'automatic';
export type LayaResult = 'success' | 'fallback' | 'timeout' | 'error';

/**
 * Input for a Laya decision
 */
export interface DecisionInput {
  tenantId: string;
  eventId?: string;
  source: 'user-query' | 'event-stream' | 'batch' | 'synthetic';
  rawSummary: string;
  userMessage?: string;
  deviceId?: string;
  deviceKind?: string;
  alarmType?: string;
}

/**
 * Complete Laya decision to log
 */
export interface LayaDecisionLog {
  engine: 'expert-system' | 'laya-ml' | 'hybrid';
  model?: string;
  modelVersion?: string;
  
  // Classification results
  eventClass: EventClass;
  severity: Severity;
  probableScope: ProbableScope;
  requiresInvestigation: boolean;
  confidence: number;
  matchedKeywords?: string[];
  
  // Performance
  latencyMs: number;
  
  // Routing (if used)
  suggestedRoute?: 'DIRECT' | 'ASSISTED' | 'INVESTIGATION';
  actualRoute?: string;
  
  // Outcomes (filled later)
  actualDiagnosis?: string;
  operatorOutcome?: string;
  operatorAgreed?: boolean;
  
  // Metadata
  shadow: boolean;
  mode: LayaMode;
  result: LayaResult;
}

/**
 * Feature flag configuration for Laya
 */
export interface LayaConfig {
  enabled: boolean;
  mode: LayaMode;
  failOpen: boolean;
  minConfidence: number;
  suggestRoute: boolean;
  allowDirectRouting: boolean;
  model?: string;
  modelVersion?: string;
}

/**
 * Default configuration from environment variables
 */
export function getLayaConfig(): LayaConfig {
  return {
    enabled: process.env.LAYA_ENABLED !== 'false',
    mode: (process.env.LAYA_MODE as LayaMode) || 'shadow',
    failOpen: process.env.LAYA_FAIL_OPEN !== 'false',
    minConfidence: parseFloat(process.env.LAYA_MIN_CONFIDENCE || '0.75'),
    suggestRoute: process.env.LAYA_SUGGEST_ROUTE === 'true',
    allowDirectRouting: process.env.LAYA_ALLOW_DIRECT_ROUTING === 'true',
    model: process.env.LAYA_MODEL,
    modelVersion: process.env.LAYA_MODEL_VERSION,
  };
}

/**
 * Check if Laya decisions should be logged
 */
export function shouldLogDecision(config: LayaConfig): boolean {
  return config.enabled && config.mode !== 'disabled';
}

/**
 * Check if Laya can influence routing
 */
export function canInfluenceRouting(config: LayaConfig): boolean {
  return config.enabled && (config.mode === 'assisted' || config.mode === 'automatic');
}

/**
 * Check if Laya can take direct routing (only in automatic mode with high confidence)
 */
export function canTakeDirectRoute(config: LayaConfig, confidence: number): boolean {
  return (
    config.enabled &&
    config.mode === 'automatic' &&
    config.allowDirectRouting &&
    confidence >= config.minConfidence
  );
}

/**
 * Convert ClassificationResult to LayaDecisionLog format
 */
export function toDecisionLog(
  input: DecisionInput,
  result: ClassificationResult,
  config: LayaConfig,
  latencyMs: number,
  suggestedRoute?: 'DIRECT' | 'ASSISTED' | 'INVESTIGATION'
): LayaDecisionLog {
  return {
    engine: 'expert-system',
    model: config.model || 'ftth-expert-system-v1',
    modelVersion: config.modelVersion || '1.0.0',
    
    eventClass: result.eventClass,
    severity: result.severity,
    probableScope: result.probableScope,
    requiresInvestigation: result.requiresInvestigation,
    confidence: result.confidence,
    matchedKeywords: result.matchedKeywords,
    
    latencyMs,
    
    suggestedRoute,
    
    shadow: config.mode === 'shadow',
    mode: config.mode,
    result: 'success',
  };
}

/**
 * Log a Laya decision to console (for development)
 * In production, this would write to the DecisionEvaluation table
 */
export async function logLayaDecision(
  input: DecisionInput,
  decision: LayaDecisionLog
): Promise<void> {
  const timestamp = new Date().toISOString();
  
  // Console output for development/debugging
  if (process.env.NODE_ENV !== 'production' || process.env.LAYA_LOG_LEVEL === 'debug') {
    console.log(JSON.stringify({
      timestamp,
      type: 'laya_decision',
      tenantId: input.tenantId,
      eventId: input.eventId,
      engine: decision.engine,
      eventClass: decision.eventClass,
      severity: decision.severity,
      probableScope: decision.probableScope,
      confidence: decision.confidence,
      suggestedRoute: decision.suggestedRoute,
      shadow: decision.shadow,
      latencyMs: decision.latencyMs,
      matchedKeywords: decision.matchedKeywords,
    }, null, 2));
  }
  
  // In production with Prisma:
  // await prisma.decisionEvaluation.create({
  //   data: {
  //     tenantId: input.tenantId,
  //     eventId: input.eventId || `gen-${Date.now()}`,
  //     engine: decision.engine,
  //     model: decision.model,
  //     modelVersion: decision.modelVersion,
  //     eventClass: decision.eventClass,
  //     severity: decision.severity,
  //     probableScope: decision.probableScope,
  //     suggestedRoute: decision.suggestedRoute,
  //     confidence: { eventClass: decision.confidence },
  //     latencyMs: decision.latencyMs,
  //     shadow: decision.shadow,
  //   }
  // });
}

/**
 * Get suggested route based on Laya decision
 */
export function getSuggestedRoute(
  result: ClassificationResult,
  config: LayaConfig
): 'DIRECT' | 'ASSISTED' | 'INVESTIGATION' | undefined {
  if (!config.suggestRoute) return undefined;
  
  // High confidence + no investigation needed = direct
  if (result.confidence >= config.minConfidence && !result.requiresInvestigation) {
    return 'DIRECT';
  }
  
  // Investigation required = investigation
  if (result.requiresInvestigation) {
    return 'INVESTIGATION';
  }
  
  // Default to assisted
  return 'ASSISTED';
}

/**
 * Calculate agreement between Laya and another route decision
 */
export function calculateAgreement(
  layaRoute: 'DIRECT' | 'ASSISTED' | 'INVESTIGATION' | undefined,
  actualRoute: 'direct' | 'assisted' | 'investigation'
): boolean {
  if (!layaRoute) return false;
  
  const normalized = layaRoute.toLowerCase() as string;
  return normalized === actualRoute.toLowerCase();
}
