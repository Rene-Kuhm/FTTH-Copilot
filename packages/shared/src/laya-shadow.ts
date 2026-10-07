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

import { z } from 'zod';
import type { ClassificationResult, EventClass, Severity, ProbableScope } from './laya-expert-system';

export type LayaMode = 'disabled' | 'shadow' | 'assisted' | 'automatic';
export type LayaResult = 'success' | 'fallback' | 'timeout' | 'error';

// ── Laya API types (used by laya-client and laya-integration) ───────────────

/**
 * Incoming event to classify via Laya
 */
export interface LayaDecisionEvent {
  tenantId: string;
  eventId?: string;
  rawSummary: string;
  userMessage?: string;
  deviceId?: string;
  deviceKind?: string;
  alarmType?: string;
  // Extended fields used by laya-integration
  source?: string;
  timestamp?: string;
  rxPower?: number;
  dyingGasp?: boolean;
  powerAlarm?: boolean;
  affectedOnus?: number;
  topologyContext?: {
    oltId?: string;
    ponPort?: string;
    splitterId?: string;
    ctoId?: string;
  };
}

/**
 * Classification result from Laya
 */
export interface LayaDecision {
  eventClass: string;
  confidence: {
    eventClass: number;
    suggestedRoute?: number;
    severity?: number;
  };
  severity: string;
  probableScope: string;
  requiresInvestigation: boolean;
  suggestedRoute?: 'DIRECT' | 'ASSISTED' | 'INVESTIGATION';
}

/**
 * Signal from Laya for routing decisions
 */
export interface LayaSignal {
  eventClass: EventClass;
  confidence: number;
  severity: Severity;
  probableScope: ProbableScope;
  requiresInvestigation: boolean;
  suggestedRoute?: 'DIRECT' | 'ASSISTED' | 'INVESTIGATION';
}

/**
 * Zod schemas for Laya API validation
 */
export const layaDecisionEventSchema = z.object({
  tenantId: z.string().min(1),
  eventId: z.string().optional(),
  rawSummary: z.string().min(1),
  userMessage: z.string().optional(),
  deviceId: z.string().optional(),
  deviceKind: z.string().optional(),
  alarmType: z.string().optional(),
  source: z.string().optional(),
  timestamp: z.string().optional(),
  rxPower: z.number().optional(),
  dyingGasp: z.boolean().optional(),
  powerAlarm: z.boolean().optional(),
  affectedOnus: z.number().optional(),
  topologyContext: z.object({
    oltId: z.string().optional(),
    ponPort: z.string().optional(),
    splitterId: z.string().optional(),
    ctoId: z.string().optional(),
  }).optional(),
});

export const layaDecisionSchema = z.object({
  eventClass: z.string(),
  confidence: z.number().min(0).max(1),
  severity: z.string(),
  probableScope: z.string(),
  requiresInvestigation: z.boolean(),
  matchedKeywords: z.array(z.string()).optional(),
});

export const LAYA_DECISION_SCHEMA = 'laya.decision.v1' as const;

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
 * Feature flag configuration for Laya (shadow/logging mode)
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
 * HTTP client configuration for Laya API calls
 */
export interface LayaHttpConfig {
  enabled: boolean;
  mode: LayaMode;
  url?: string;
  timeoutMs: number;
  failOpen: boolean;
  confidenceThresholdHigh: number;
  confidenceThresholdLow: number;
  model?: string;
  modelVersion?: string;
}

/**
 * AD-2: single resolver for Laya env defaults. Both `getLayaConfig` and
 * `loadLayaConfigFromEnv` delegate here so there is exactly one resolution rule
 * for each of the three core knobs.
 *
 * Defaults (AD-2):
 *   enabled  = LAYA_ENABLED === 'true'    (opt-in — safe default for a routing-influencing component)
 *   mode     = LAYA_MODE ?? 'shadow'
 *   failOpen = LAYA_FAIL_OPEN !== 'false' (fail-open is the safe default)
 */
export function resolveLayaEnv(): { enabled: boolean; mode: LayaMode; failOpen: boolean } {
  return {
    enabled: process.env.LAYA_ENABLED === 'true',
    mode: (process.env.LAYA_MODE as LayaMode) ?? 'shadow',
    failOpen: process.env.LAYA_FAIL_OPEN !== 'false',
  };
}

/**
 * Default configuration from environment variables
 */
export function getLayaConfig(): LayaConfig {
  const { enabled, mode, failOpen } = resolveLayaEnv();
  return {
    enabled,
    mode,
    failOpen,
    minConfidence: parseFloat(process.env.LAYA_MIN_CONFIDENCE || '0.75'),
    suggestRoute: process.env.LAYA_SUGGEST_ROUTE === 'true',
    allowDirectRouting: process.env.LAYA_ALLOW_DIRECT_ROUTING === 'true',
    model: process.env.LAYA_MODEL,
    modelVersion: process.env.LAYA_MODEL_VERSION,
  };
}

/**
 * Zod schemas for Laya API validation
 */
export const layaConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['disabled', 'shadow', 'assisted', 'automatic']),
  failOpen: z.boolean(),
  minConfidence: z.number().min(0).max(1),
  suggestRoute: z.boolean(),
  allowDirectRouting: z.boolean(),
  model: z.string().optional(),
  modelVersion: z.string().optional(),
});

export const layaHttpConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['disabled', 'shadow', 'assisted', 'automatic']),
  url: z.string().optional(),
  timeoutMs: z.number().int().positive(),
  failOpen: z.boolean(),
  confidenceThresholdHigh: z.number().min(0).max(1),
  confidenceThresholdLow: z.number().min(0).max(1),
  model: z.string().optional(),
  modelVersion: z.string().optional(),
});

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
 * Log handler type — registered by the host application (e.g. agent-core).
 * Allows the host to persist decisions to a database without coupling shared to Prisma.
 */
export type LayaLogHandler = (input: DecisionInput, decision: LayaDecisionLog) => Promise<void> | void;

let _logHandler: LayaLogHandler | undefined;

/**
 * Register a custom log handler for Laya decisions.
 * Call this once during application startup if you want to persist
 * decisions to a database (e.g. Prisma DecisionEvaluation table).
 *
 * @example
 *   import { prisma } from '@ftth-copilot/db';
 *   setLayaLogHandler(async (input, decision) => {
 *     await prisma.decisionEvaluation.create({
 *       data: {
 *         tenantId: input.tenantId,
 *         eventId: input.eventId || `gen-${Date.now()}`,
 *         engine: decision.engine,
 *         model: decision.model,
 *         modelVersion: decision.modelVersion,
 *         eventClass: decision.eventClass,
 *         severity: decision.severity,
 *         probableScope: decision.probableScope,
 *         suggestedRoute: decision.suggestedRoute,
 *         confidence: { eventClass: decision.confidence },
 *         latencyMs: decision.latencyMs,
 *         shadow: decision.shadow,
 *       }
 *     });
 *   });
 */
export function setLayaLogHandler(handler: LayaLogHandler): void {
  _logHandler = handler;
}

/**
 * Log a Laya decision to console (for development) and to the registered handler.
 * If no handler is registered, only console output is produced.
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
  
  // Call registered handler (e.g. Prisma write in agent-core)
  if (_logHandler) {
    try {
      await _logHandler(input, decision);
    } catch (err) {
      console.error('[laya] log handler error:', err instanceof Error ? err.message : err);
    }
  }
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
