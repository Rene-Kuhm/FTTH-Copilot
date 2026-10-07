/**
 * Laya Integration — ADR-042
 *
 * Integrates Laya Decision Layer into FTTH-Copilot's adaptive router.
 *
 * Architecture:
 *   Event → Laya (shadow/active) → Adaptive Router (existing)
 *                         ↓
 *                   DecisionEvaluation (shadow mode persistence)
 *
 * The adaptive router continues to make routing decisions.
 * Laya provides an additional signal in assisted mode.
 */

import type {
  LayaDecisionEvent,
  LayaDecision,
  LayaSignal,
  LayaHttpConfig,
  LayaMode,
} from './laya-shadow.js';
import type { EventClass, Severity, ProbableScope } from './laya-expert-system';
import {
  layaDecisionEventSchema,
  layaDecisionSchema,
} from './laya-shadow.js';
import {
  createLayaClient,
  loadLayaConfigFromEnv,
  createInitialMetrics,
  type LayaClient,
  type LayaMetrics,
} from './laya-client.js';

// ── Laya Service Integration ──────────────────────────────────────────────

/**
 * Laya integration for the FTTH-Copilot agent.
 * Manages the lifecycle of Laya decisions and shadow mode evaluation.
 */
export class LayaIntegration {
  private client: LayaClient;
  private config: LayaHttpConfig;
  private metrics: LayaMetrics;

  constructor(config?: Partial<LayaHttpConfig>) {
    this.config = {
      ...loadLayaConfigFromEnv(),
      ...config,
    };
    this.metrics = createInitialMetrics();
    this.client = createLayaClient({
      config: this.config,
      metrics: this.metrics,
    });
  }

  /**
   * Check if Laya is enabled and operational.
   */
  isEnabled(): boolean {
    return this.config.enabled && this.config.mode !== 'disabled';
  }

  /**
   * Get current operating mode.
   */
  getMode(): LayaMode {
    return this.config.mode;
  }

  /**
   * Check if we're in shadow mode (no real routing impact).
   */
  isShadowMode(): boolean {
    return this.config.mode === 'shadow';
  }

  /**
   * Get metrics snapshot for observability.
   */
  getMetrics(): LayaMetrics {
    return this.client.getMetrics();
  }

  /**
   * Get circuit breaker state for debugging.
   */
  getCircuitBreakerState() {
    return this.client.getCircuitBreakerState();
  }

  /**
   * Process an event through Laya.
   *
   * In shadow mode: calls Laya, logs decision, returns null.
   * In active modes: calls Laya, returns decision for routing.
   */
  async processEvent(
    event: LayaDecisionEvent
  ): Promise<LayaDecision | null> {
    if (!this.isEnabled()) {
      return null;
    }

    return this.client.decide(event);
  }

  /**
   * Build a Laya signal for injection into adaptive router context.
   * Used in assisted mode.
   */
  buildLayaSignal(decision: LayaDecision): LayaSignal {
    return {
      suggestedRoute: decision.suggestedRoute,
      confidence: decision.confidence.eventClass,
      probableScope: decision.probableScope as ProbableScope,
      eventClass: decision.eventClass as EventClass,
      requiresInvestigation: decision.requiresInvestigation,
      severity: decision.severity as Severity,
    };
  }

  /**
   * Determine if Laya's suggested route should be followed.
   * Applies confidence gating based on ADR-042 thresholds.
   */
  shouldFollowLayaRoute(decision: LayaDecision): boolean {
    const confidence = decision.confidence.suggestedRoute ?? 0;

    // High confidence → follow Laya's suggestion
    if (confidence >= this.config.confidenceThresholdHigh) {
      return true;
    }

    // Low confidence → defer to adaptive router
    if (confidence < this.config.confidenceThresholdLow) {
      return false;
    }

    // Medium confidence → follow only for low-risk routes
    if (decision.suggestedRoute === 'DIRECT') {
      return true;
    }

    // Medium confidence + ASSISTED/INVESTIGATION → use adaptive router
    return false;
  }

  /**
   * Check if event should escalate based on Laya decision.
   * These are fail-safe rules from ADR-042 DEC-042-4.
   */
  shouldEscalate(decision: LayaDecision): boolean {
    // UNKNOWN with low confidence → escalate
    if (
      decision.eventClass === 'UNKNOWN' &&
      decision.confidence.eventClass < 0.75
    ) {
      return true;
    }

    // CRITICAL with low confidence → escalate
    if (
      decision.severity === 'CRITICAL' &&
      (decision.confidence.severity ?? 0) < 0.9
    ) {
      return true;
    }

    // Any decision with very low confidence → escalate
    if (
      decision.confidence.eventClass < 0.5 ||
      (decision.confidence.severity ?? 0) < 0.5
    ) {
      return true;
    }

    return false;
  }

  /**
   * Health check for monitoring.
   */
  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck();
  }

  /**
   * Convert a telemetry event to Laya decision event format.
   */
  static toLayaEvent(params: {
    eventId: string;
    tenantId: string;
    source: string;
    deviceKind?: string;
    deviceId?: string;
    alarmType?: string;
    rxPower?: number;
    dyingGasp?: boolean;
    powerAlarm?: boolean;
    affectedOnus?: number;
    rawSummary: string;
    topologyContext?: {
      oltId?: string;
      ponPort?: string;
      splitterId?: string;
      ctoId?: string;
    };
  }): LayaDecisionEvent {
    const event = {
      eventId: params.eventId,
      tenantId: params.tenantId,
      timestamp: new Date().toISOString(),
      source: params.source as LayaDecisionEvent['source'],
      deviceKind: params.deviceKind as LayaDecisionEvent['deviceKind'],
      deviceId: params.deviceId,
      alarmType: params.alarmType,
      rxPower: params.rxPower,
      dyingGasp: params.dyingGasp,
      powerAlarm: params.powerAlarm,
      affectedOnus: params.affectedOnus,
      topologyContext: params.topologyContext,
      rawSummary: params.rawSummary,
    };

    const parseResult = layaDecisionEventSchema.safeParse(event);
    if (!parseResult.success) {
      throw new Error(`Invalid Laya event: ${parseResult.error.message}`);
    }

    return parseResult.data;
  }
}

// ── Feature Flag Helpers ──────────────────────────────────────────────────

/**
 * Check if Laya should be consulted.
 *
 * Decision: event-type filtering is not currently wanted — the Laya System 1
 * is a general FTTH event classifier that handles all event classes without
 * a per-type allow-list. The `eventType` parameter was removed so that callers
 * are not misled into thinking there is a filter that does not exist.
 *
 * Returns true when Laya is enabled and not in disabled mode.
 */
export function shouldConsultLaya(config: LayaHttpConfig): boolean {
  if (!config.enabled) return false;
  if (config.mode === 'disabled') return false;
  return true;
}

/**
 * Get the effective route considering both adaptive router and Laya.
 * Used in assisted mode.
 */
export function mergeRoutingDecision(params: {
  adaptiveRoute: 'direct' | 'assisted' | 'investigation';
  layaSignal: LayaSignal | null;
  confidenceThresholds: {
    high: number;
    low: number;
  };
}): 'direct' | 'assisted' | 'investigation' {
  if (!params.layaSignal) {
    return params.adaptiveRoute;
  }

  const { confidence, suggestedRoute } = params.layaSignal;
  const { high, low } = params.confidenceThresholds;

  // High confidence Laya + low-risk route → use Laya
  if (confidence >= high && suggestedRoute === 'DIRECT') {
    return 'direct';
  }

  // Low confidence → use adaptive router
  if (confidence < low) {
    return params.adaptiveRoute;
  }

  // Medium confidence → prefer more thorough routing
  if (confidence >= low && suggestedRoute === 'INVESTIGATION') {
    return 'investigation';
  }

  // Default: use adaptive router's decision
  return params.adaptiveRoute;
}

// ── Default instance ───────────────────────────────────────────────────────

/**
 * Global Laya integration instance.
 * Initialized lazily on first access.
 */
let globalInstance: LayaIntegration | null = null;

export function getLayaIntegration(): LayaIntegration {
  if (!globalInstance) {
    globalInstance = new LayaIntegration();
  }
  return globalInstance;
}

export function resetLayaIntegration(): void {
  globalInstance = null;
}
