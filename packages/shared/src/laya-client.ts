/**
 * Laya Decision Client — ADR-042
 *
 * TypeScript client for the Laya Fast Decision Layer (System 1).
 * Provides:
 * - HTTP client for Laya microservice
 * - Timeout and circuit breaker
 * - Fail-open fallback
 * - Shadow mode logging
 * - Laya metrics for VictoriaMetrics
 *
 * Usage:
 *   const client = createLayaClient(config);
 *   const decision = await client.decide(event);
 */

import type {
  LayaDecisionEvent,
  LayaDecision,
  LayaHttpConfig,
  LayaMode,
} from './laya-shadow.js';
import {
  layaHttpConfigSchema,
  layaDecisionSchema,
  layaDecisionEventSchema,
} from './laya-shadow.js';

// ── Default configuration ────────────────────────────────────────────────────

export const DEFAULT_LAYA_CONFIG: LayaHttpConfig = {
  enabled: false,
  mode: 'disabled',
  timeoutMs: 250,
  failOpen: true,
  confidenceThresholdHigh: 0.95,
  confidenceThresholdLow: 0.75,
  model: 'laya-multilingual',
};

/**
 * Parse and validate Laya configuration from environment variables.
 * Falls back to defaults for missing values.
 */
export function loadLayaConfigFromEnv(): LayaHttpConfig {
  const raw = {
    enabled: process.env.LAYA_ENABLED === 'true',
    mode: process.env.LAYA_MODE ?? 'disabled',
    url: process.env.LAYA_URL,
    timeoutMs: parseInt(process.env.LAYA_TIMEOUT_MS ?? '250', 10),
    failOpen: process.env.LAYA_FAIL_OPEN !== 'false',
    confidenceThresholdHigh:
      parseFloat(process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH ?? '0.95'),
    confidenceThresholdLow:
      parseFloat(process.env.LAYA_CONFIDENCE_THRESHOLD_LOW ?? '0.75'),
    model: process.env.LAYA_MODEL ?? 'laya-multilingual',
    modelVersion: process.env.LAYA_MODEL_VERSION,
  };

  // Validate with zod, filling defaults for missing optional fields
  const result = layaHttpConfigSchema.safeParse(raw);
  if (!result.success) {
    console.warn('[Laya] Invalid config, using defaults:', result.error.message);
    return DEFAULT_LAYA_CONFIG;
  }
  return result.data;
}

// ── Questions for Laya ─────────────────────────────────────────────────────

/**
 * Laya questions for FTTH event classification.
 * Formatted as Laya expects: { questionName: { type, instructions, criteria } }
 */
export const LAYA_QUESTIONS = {
  event_class: {
    type: 'choice',
    instructions: `Classify this FTTH network event.
Context: FTTH network hierarchy is OLT → PON → Splitter → CTO → ONU.
Event classes:
- NORMAL: No operational fault
- OPTICAL_DEGRADATION: Signal gradually deteriorating but service may work
- OPTICAL_FAULT: Loss of optical connectivity (LOS, fiber cut, connector failure)
- POWER_FAULT: Power-related failure or dying gasp pattern
- DEVICE_FAULT: Equipment-specific fault (OLT temp, board failure, hardware)
- UPLINK_FAULT: OLT or aggregation uplink issue
- CONGESTION: Traffic congestion, high bandwidth utilization
- MASS_OUTAGE: Multiple subscribers affected by common upstream cause
- SECURITY_EVENT: Suspected security incident
- UNKNOWN: Evidence insufficient to classify`,
    criteria: {
      NORMAL: 'No operational fault indicated',
      OPTICAL_DEGRADATION: 'Signal gradually deteriorating',
      OPTICAL_FAULT: 'Loss of optical connectivity',
      POWER_FAULT: 'Power-related failure',
      DEVICE_FAULT: 'Equipment-specific fault',
      UPLINK_FAULT: 'Uplink issue',
      CONGESTION: 'Traffic congestion',
      MASS_OUTAGE: 'Multiple subscribers affected',
      SECURITY_EVENT: 'Security incident suspected',
      UNKNOWN: 'Evidence insufficient',
    },
  },
  severity: {
    type: 'choice',
    instructions: 'Estimate operational severity.',
    criteria: {
      INFO: 'Informational only',
      LOW: 'Minor impact',
      MEDIUM: 'Service degradation requiring attention',
      HIGH: 'Significant customer impact',
      CRITICAL: 'Large-scale or infrastructure-critical impact',
    },
  },
  requires_investigation: {
    type: 'noul',
    instructions:
      'Does this event require deeper diagnostic investigation?',
  },
} as const;

// ── Circuit Breaker ────────────────────────────────────────────────────────

/**
 * Simple circuit breaker state.
 * Opens after consecutiveFailures threshold.
 * Half-open after resetTimeoutMs.
 */
export interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  lastFailureTime: number | null;
}

export interface CircuitBreakerConfig {
  consecutiveFailuresThreshold: number;
  resetTimeoutMs: number;
}

/**
 * Create a circuit breaker with configurable thresholds.
 */
export function createCircuitBreaker(
  config: CircuitBreakerConfig = {
    consecutiveFailuresThreshold: 5,
    resetTimeoutMs: 30_000,
  }
): {
  recordSuccess: () => void;
  recordFailure: () => boolean; // returns true if circuit opened
  canExecute: () => boolean;
  getState: () => CircuitBreakerState;
} {
  let state: CircuitBreakerState = {
    status: 'closed',
    consecutiveFailures: 0,
    lastFailureTime: null,
  };

  return {
    recordSuccess() {
      state.consecutiveFailures = 0;
      state.status = 'closed';
    },

    recordFailure(): boolean {
      state.consecutiveFailures++;
      state.lastFailureTime = Date.now();

      if (state.consecutiveFailures >= config.consecutiveFailuresThreshold) {
        state.status = 'open';
        return true; // Circuit opened
      }
      return false;
    },

    canExecute(): boolean {
      if (state.status === 'closed') return true;

      if (state.status === 'open') {
        if (
          state.lastFailureTime &&
          Date.now() - state.lastFailureTime >= config.resetTimeoutMs
        ) {
          state.status = 'half-open';
          return true;
        }
        return false;
      }

      // half-open: allow one request through
      return true;
    },

    getState(): CircuitBreakerState {
      return { ...state };
    },
  };
}

// ── Metrics ────────────────────────────────────────────────────────────────

/**
 * Laya metrics for Prometheus.
 * These are updated by the client on each call.
 */
export interface LayaMetrics {
  requestsTotal: number;
  failuresTotal: number;
  timeoutsTotal: number;
  shadowTotal: number;
  fallbackTotal: number;
  latencySum: number;
  batchSizeSum: number;
  routeSuggestionTotal: Record<string, number>;
  shadowAgreementTotal: number;
  shadowDisagreementTotal: number;
  confidenceSum: number;
  confidenceCount: number;
}

export const createInitialMetrics = (): LayaMetrics => ({
  requestsTotal: 0,
  failuresTotal: 0,
  timeoutsTotal: 0,
  shadowTotal: 0,
  fallbackTotal: 0,
  latencySum: 0,
  batchSizeSum: 0,
  routeSuggestionTotal: {},
  shadowAgreementTotal: 0,
  shadowDisagreementTotal: 0,
  confidenceSum: 0,
  confidenceCount: 0,
});

/**
 * Record a Laya decision in metrics.
 */
export function recordLayaDecision(
  metrics: LayaMetrics,
  params: {
    latencyMs: number;
    success: boolean;
    isTimeout?: boolean;
    isShadow?: boolean;
    isFallback?: boolean;
    suggestedRoute?: string;
    confidence?: number;
    shadowAgreement?: boolean;
  }
): void {
  metrics.requestsTotal++;

  if (params.success) {
    if (params.isShadow) metrics.shadowTotal++;
    if (params.isFallback) metrics.fallbackTotal++;
    metrics.latencySum += params.latencyMs;
    if (params.confidence !== undefined) {
      metrics.confidenceSum += params.confidence;
      metrics.confidenceCount++;
    }
    if (params.suggestedRoute) {
      metrics.routeSuggestionTotal[params.suggestedRoute] =
        (metrics.routeSuggestionTotal[params.suggestedRoute] ?? 0) + 1;
    }
    if (params.isShadow && params.shadowAgreement !== undefined) {
      if (params.shadowAgreement) {
        metrics.shadowAgreementTotal++;
      } else {
        metrics.shadowDisagreementTotal++;
      }
    }
  } else {
    metrics.failuresTotal++;
    if (params.isTimeout) metrics.timeoutsTotal++;
  }
}

// ── Laya Client ──────────────────────────────────────────────────────────

export interface LayaClientConfig {
  config: LayaHttpConfig;
  circuitBreaker?: ReturnType<typeof createCircuitBreaker>;
  metrics?: LayaMetrics;
  /** Custom fetch implementation. Defaults to global fetch. */
  fetch?: typeof fetch;
}

/**
 * Laya client interface returned by createLayaClient.
 */
export interface LayaClient {
  /** Check if Laya is enabled and operational. */
  isOperational: () => boolean;
  /** Get current configuration. */
  getConfig: () => LayaHttpConfig;
  /** Get circuit breaker state. */
  getCircuitBreakerState: () => CircuitBreakerState;
  /** Get current metrics snapshot. */
  getMetrics: () => LayaMetrics;
  /**
   * Classify a single event.
   * Returns null if Laya is disabled or unavailable (fail-open).
   */
  decide: (event: LayaDecisionEvent) => Promise<LayaDecision | null>;
  /**
   * Classify multiple events in batch.
   * Returns array with null for failed requests.
   */
  decideBatch: (
    events: LayaDecisionEvent[]
  ) => Promise<Array<LayaDecision | null>>;
  /**
   * Check Laya service health.
   */
  healthCheck: () => Promise<boolean>;
}

/**
 * Create a Laya decision client.
 *
 * The client handles:
 * - HTTP requests to Laya service
 * - Timeout management
 * - Circuit breaker
 * - Fail-open fallback
 * - Shadow mode (no side effects)
 * - Metrics collection
 */
export function createLayaClient(config: LayaClientConfig): {
  /** Check if Laya is enabled and operational. */
  isOperational: () => boolean;
  /** Get current configuration. */
  getConfig: () => LayaHttpConfig;
  /** Get circuit breaker state. */
  getCircuitBreakerState: () => CircuitBreakerState;
  /** Get current metrics snapshot. */
  getMetrics: () => LayaMetrics;
  /**
   * Classify a single event.
   * Returns null if Laya is disabled or unavailable (fail-open).
   */
  decide: (event: LayaDecisionEvent) => Promise<LayaDecision | null>;
  /**
   * Classify multiple events in batch.
   * Returns array with null for failed requests.
   */
  decideBatch: (
    events: LayaDecisionEvent[]
  ) => Promise<Array<LayaDecision | null>>;
  /**
   * Check Laya service health.
   */
  healthCheck: () => Promise<boolean>;
} {
  const {
    config: layaConfig,
    circuitBreaker = createCircuitBreaker(),
    metrics = createInitialMetrics(),
    fetch: customFetch,
  } = config;

  const fetchFn = customFetch ?? globalThis.fetch;

  // Build service URL
  const serviceUrl =
    layaConfig.url ?? process.env.LAYA_URL ?? 'http://localhost:8080';

  async function callLaya<T>(
    path: string,
    body: unknown,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(`${serviceUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Laya HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Laya request timeout');
      }
      throw error;
    }
  }

  function mapResponseToLayaDecision(
    response: Record<string, unknown>
  ): LayaDecision {
    // Parse Laya's response format
    const eventClassResp = response.event_class as {
      choice?: string;
      confidence?: number;
    };
    const severityResp = response.severity as {
      choice?: string;
      confidence?: number;
    };
    const requiresInvestigationResp = response.requires_investigation as {
      choice?: boolean;
      confidence?: number;
    };

    // Build confidence object
    const confidence = {
      eventClass: eventClassResp?.confidence ?? 0,
      severity: severityResp?.confidence ?? 0,
      suggestedRoute: 0.5,
    };

    // Map to our decision format
    return {
      eventClass: (eventClassResp?.choice as LayaDecision['eventClass']) ?? 'UNKNOWN',
      severity: (severityResp?.choice as LayaDecision['severity']) ?? 'INFO',
      probableScope: 'UNKNOWN',
      suggestedRoute: 'INVESTIGATION',
      requiresInvestigation: requiresInvestigationResp?.choice ?? true,
      confidence,
    };
  }

  return {
    isOperational(): boolean {
      return layaConfig.enabled && circuitBreaker.canExecute();
    },

    getConfig(): LayaHttpConfig {
      return { ...layaConfig };
    },

    getCircuitBreakerState(): CircuitBreakerState {
      return circuitBreaker.getState();
    },

    getMetrics(): LayaMetrics {
      return { ...metrics };
    },

    async decide(event: LayaDecisionEvent): Promise<LayaDecision | null> {
      const startTime = Date.now();

      // Check if Laya is enabled
      if (!layaConfig.enabled || layaConfig.mode === 'disabled') {
        return null;
      }

      // Check circuit breaker
      if (!circuitBreaker.canExecute()) {
        recordLayaDecision(metrics, {
          latencyMs: Date.now() - startTime,
          success: false,
          isFallback: true,
        });
        return null;
      }

      // Validate input
      const parseResult = layaDecisionEventSchema.safeParse(event);
      if (!parseResult.success) {
        console.warn('[Laya] Invalid event:', parseResult.error.message);
        return null;
      }

      // Shadow mode: just log and return null (or mock decision)
      if (layaConfig.mode === 'shadow') {
        recordLayaDecision(metrics, {
          latencyMs: Date.now() - startTime,
          success: true,
          isShadow: true,
        });
        // In shadow mode, we still call Laya but don't use the result
        try {
          const result = await callLaya<Record<string, unknown>>(
            '/v1/decide',
            { event: parseResult.data },
            layaConfig.timeoutMs
          );
          const latencyMs = Date.now() - startTime;
          circuitBreaker.recordSuccess();
          return mapResponseToLayaDecision(result);
        } catch (error) {
          const latencyMs = Date.now() - startTime;
          const opened = circuitBreaker.recordFailure();
          console.warn('[Laya] Shadow call failed:', error);
          return null;
        }
      }

      // Active mode: call Laya
      try {
        const result = await callLaya<Record<string, unknown>>(
          '/v1/decide',
          { event: parseResult.data },
          layaConfig.timeoutMs
        );

        const latencyMs = Date.now() - startTime;
        circuitBreaker.recordSuccess();

        const decision = mapResponseToLayaDecision(result);

        recordLayaDecision(metrics, {
          latencyMs,
          success: true,
          suggestedRoute: decision.suggestedRoute,
          confidence: decision.confidence.eventClass,
        });

        return decision;
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        const isTimeout =
          error instanceof Error && error.message === 'Laya request timeout';
        const opened = circuitBreaker.recordFailure();

        console.warn('[Laya] Decision failed:', error);

        recordLayaDecision(metrics, {
          latencyMs,
          success: false,
          isTimeout,
          isFallback: layaConfig.failOpen,
        });

        // Fail-open: return null so pipeline continues
        if (layaConfig.failOpen) {
          return null;
        }
        throw error;
      }
    },

    async decideBatch(
      events: LayaDecisionEvent[]
    ): Promise<Array<LayaDecision | null>> {
      if (!layaConfig.enabled || layaConfig.mode === 'disabled') {
        return events.map(() => null);
      }

      if (!circuitBreaker.canExecute()) {
        recordLayaDecision(metrics, {
          latencyMs: 0,
          success: false,
          isFallback: true,
        });
        return events.map(() => null);
      }

      try {
        const result = await callLaya<{ decisions: Record<string, unknown>[] }>(
          '/v1/batch',
          { events: events.map((e) => ({ event: e })) },
          layaConfig.timeoutMs * Math.min(events.length, 10) // Scale timeout with batch size
        );

        circuitBreaker.recordSuccess();
        metrics.batchSizeSum += events.length;

        return result.decisions.map((decision) => {
          return mapResponseToLayaDecision(decision);
        });
      } catch (error) {
        const opened = circuitBreaker.recordFailure();
        console.warn('[Laya] Batch failed:', error);

        if (layaConfig.failOpen) {
          return events.map(() => null);
        }
        throw error;
      }
    },

    async healthCheck(): Promise<boolean> {
      if (!layaConfig.enabled) return false;

      try {
        const response = await fetchFn(`${serviceUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
