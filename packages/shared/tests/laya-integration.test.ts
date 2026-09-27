/**
 * Unit tests for Laya Integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventClass, Severity, ProbableScope } from '../src/laya-expert-system';
import {
  LayaIntegration,
  shouldConsultLaya,
  mergeRoutingDecision,
  getLayaIntegration,
  resetLayaIntegration,
  type LayaDecision,
} from '../src/laya-integration.js';
import type { LayaSignal, LayaHttpConfig, LayaDecisionEvent } from '../src/laya-shadow.js';

// ── LayaIntegration Tests ──────────────────────────────────────────────────

describe('LayaIntegration', () => {
  let integration: LayaIntegration;

  beforeEach(() => {
    integration = new LayaIntegration({
      enabled: false,
      mode: 'disabled',
      timeoutMs: 250,
      failOpen: true,
      confidenceThresholdHigh: 0.95,
      confidenceThresholdLow: 0.75,
    });
  });

  describe('isEnabled', () => {
    it('returns false when disabled', () => {
      expect(integration.isEnabled()).toBe(false);
    });

    it('returns true when enabled', () => {
      const enabledIntegration = new LayaIntegration({
        enabled: true,
        mode: 'shadow',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });
      expect(enabledIntegration.isEnabled()).toBe(true);
    });
  });

  describe('isShadowMode', () => {
    it('returns true only in shadow mode', () => {
      const shadowIntegration = new LayaIntegration({
        enabled: true,
        mode: 'shadow',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });
      expect(shadowIntegration.isShadowMode()).toBe(true);

      const assistedIntegration = new LayaIntegration({
        enabled: true,
        mode: 'assisted',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });
      expect(assistedIntegration.isShadowMode()).toBe(false);
    });
  });

  describe('getMode', () => {
    it('returns the configured mode', () => {
      const shadowIntegration = new LayaIntegration({
        enabled: true,
        mode: 'shadow',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });
      expect(shadowIntegration.getMode()).toBe('shadow');

      const assistedIntegration = new LayaIntegration({
        enabled: true,
        mode: 'assisted',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });
      expect(assistedIntegration.getMode()).toBe('assisted');

      const automaticIntegration = new LayaIntegration({
        enabled: true,
        mode: 'automatic',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });
      expect(automaticIntegration.getMode()).toBe('automatic');
    });
  });

  describe('getMetrics', () => {
    it('returns metrics from the client', () => {
      const enabledIntegration = new LayaIntegration({
        enabled: true,
        mode: 'shadow',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });

      const metrics = enabledIntegration.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics).toBe('object');
      expect(metrics).toHaveProperty('requestsTotal');
      expect(metrics).toHaveProperty('failuresTotal');
    });
  });

  describe('getCircuitBreakerState', () => {
    it('returns circuit breaker state from the client', () => {
      const enabledIntegration = new LayaIntegration({
        enabled: true,
        mode: 'shadow',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });

      const state = enabledIntegration.getCircuitBreakerState();
      expect(state).toBeDefined();
      expect(typeof state).toBe('object');
    });
  });

  describe('processEvent', () => {
    it('returns null when disabled', async () => {
      const disabledIntegration = new LayaIntegration({
        enabled: false,
        mode: 'disabled',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });

      const event: LayaDecisionEvent = {
        eventId: 'evt-001',
        tenantId: 'tenant-001',
        timestamp: new Date().toISOString(),
        source: 'snmp',
        deviceKind: 'ONU',
        deviceId: 'ONU-342',
        alarmType: 'LOS',
        rxPower: -27.8,
        rawSummary: 'ONU-342 reports LOS',
      };

      const result = await disabledIntegration.processEvent(event);
      expect(result).toBeNull();
    });

    it('returns null when LAYA_URL is not configured', async () => {
      // Even when enabled, if no LAYA_URL is set, the client fails-open and returns null
      const enabledIntegration = new LayaIntegration({
        enabled: true,
        mode: 'shadow',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });

      const event: LayaDecisionEvent = {
        eventId: 'evt-001',
        tenantId: 'tenant-001',
        timestamp: new Date().toISOString(),
        source: 'snmp',
        deviceKind: 'ONU',
        deviceId: 'ONU-342',
        alarmType: 'LOS',
        rxPower: -27.8,
        rawSummary: 'ONU-342 reports LOS',
      };

      // Without LAYA_URL configured, the client fails open and returns null
      const result = await enabledIntegration.processEvent(event);
      expect(result).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('returns health status from client', async () => {
      const enabledIntegration = new LayaIntegration({
        enabled: true,
        mode: 'shadow',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
      });

      const health = await enabledIntegration.healthCheck();
      expect(typeof health).toBe('boolean');
    });
  });

  describe('shouldFollowLayaRoute', () => {
    it('follows high confidence DIRECT suggestions', () => {
      const integration = new LayaIntegration({
        enabled: true,
        mode: 'assisted',
        confidenceThresholdHigh: 0.9,
        confidenceThresholdLow: 0.7,
      });

      const decision: LayaDecision = {
        eventClass: 'NORMAL',
        severity: 'INFO',
        probableScope: 'ONU',
        suggestedRoute: 'DIRECT',
        requiresInvestigation: false,
        confidence: {
          eventClass: 0.95,
          severity: 0.9,
          suggestedRoute: 0.95,
        },
      };

      expect(integration.shouldFollowLayaRoute(decision)).toBe(true);
    });

    it('does not follow low confidence suggestions', () => {
      const integration = new LayaIntegration({
        enabled: true,
        mode: 'assisted',
        confidenceThresholdHigh: 0.9,
        confidenceThresholdLow: 0.7,
      });

      const decision: LayaDecision = {
        eventClass: 'OPTICAL_FAULT',
        severity: 'HIGH',
        probableScope: 'PON',
        suggestedRoute: 'DIRECT',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.5,
          severity: 0.4,
          suggestedRoute: 0.5,
        },
      };

      expect(integration.shouldFollowLayaRoute(decision)).toBe(false);
    });

    it('follows medium confidence DIRECT routes', () => {
      const integration = new LayaIntegration({
        enabled: true,
        mode: 'assisted',
        confidenceThresholdHigh: 0.9,
        confidenceThresholdLow: 0.7,
      });

      const decision: LayaDecision = {
        eventClass: 'NORMAL',
        severity: 'LOW',
        probableScope: 'ONU',
        suggestedRoute: 'DIRECT',
        requiresInvestigation: false,
        confidence: {
          eventClass: 0.8,
          severity: 0.75,
          suggestedRoute: 0.8, // 0.8 is medium confidence (between 0.7 and 0.9)
        },
      };

      // Medium confidence (0.7-0.9) + DIRECT route → follow Laya
      expect(integration.shouldFollowLayaRoute(decision)).toBe(true);
    });
  });

  describe('shouldEscalate', () => {
    it('escalates UNKNOWN with low confidence', () => {
      const decision: LayaDecision = {
        eventClass: 'UNKNOWN',
        severity: 'INFO',
        probableScope: 'UNKNOWN',
        suggestedRoute: 'ASSISTED',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.5,
          severity: 0.5,
          suggestedRoute: 0.5,
        },
      };

      expect(integration.shouldEscalate(decision)).toBe(true);
    });

    it('escalates CRITICAL with low confidence', () => {
      const decision: LayaDecision = {
        eventClass: 'MASS_OUTAGE',
        severity: 'CRITICAL',
        probableScope: 'PON',
        suggestedRoute: 'INVESTIGATION',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.8,
          severity: 0.85, // Below 0.9
          suggestedRoute: 0.9,
        },
      };

      expect(integration.shouldEscalate(decision)).toBe(true);
    });

    it('does not escalate high confidence decisions', () => {
      const decision: LayaDecision = {
        eventClass: 'OPTICAL_FAULT',
        severity: 'HIGH',
        probableScope: 'PON',
        suggestedRoute: 'INVESTIGATION',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.95,
          severity: 0.95,
          suggestedRoute: 0.95,
        },
      };

      expect(integration.shouldEscalate(decision)).toBe(false);
    });
  });

  describe('buildLayaSignal', () => {
    it('builds correct signal from decision', () => {
      const decision: LayaDecision = {
        eventClass: 'OPTICAL_FAULT',
        severity: 'HIGH',
        probableScope: 'PON',
        suggestedRoute: 'INVESTIGATION',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.9,
          severity: 0.85,
          suggestedRoute: 0.92,
        },
      };

      const signal = integration.buildLayaSignal(decision);

      expect(signal.suggestedRoute).toBe('INVESTIGATION');
      expect(signal.confidence).toBe(0.9);
      expect(signal.probableScope).toBe('PON');
      expect(signal.eventClass).toBe('OPTICAL_FAULT');
      expect(signal.requiresInvestigation).toBe(true);
      expect(signal.severity).toBe('HIGH');
    });
  });
});

// ── Feature Flag Tests ──────────────────────────────────────────────────

describe('shouldConsultLaya', () => {
  it('returns false when disabled', () => {
    const config: LayaHttpConfig = {
      enabled: false,
      mode: 'disabled',
      timeoutMs: 250,
      failOpen: true,
      confidenceThresholdHigh: 0.95,
      confidenceThresholdLow: 0.75,
    };
    expect(shouldConsultLaya(config)).toBe(false);
  });

  it('returns true in shadow mode', () => {
    const config: LayaHttpConfig = {
      enabled: true,
      mode: 'shadow',
      timeoutMs: 250,
      failOpen: true,
      confidenceThresholdHigh: 0.95,
      confidenceThresholdLow: 0.75,
    };
    expect(shouldConsultLaya(config)).toBe(true);
  });

  it('returns true in assisted mode', () => {
    const config: LayaHttpConfig = {
      enabled: true,
      mode: 'assisted',
      timeoutMs: 250,
      failOpen: true,
      confidenceThresholdHigh: 0.95,
      confidenceThresholdLow: 0.75,
    };
    expect(shouldConsultLaya(config)).toBe(true);
  });
});

// ── Routing Merge Tests ─────────────────────────────────────────────────

describe('mergeRoutingDecision', () => {
  it('uses adaptive route when no Laya signal', () => {
    const result = mergeRoutingDecision({
      adaptiveRoute: 'assisted',
      layaSignal: null,
      confidenceThresholds: { high: 0.9, low: 0.7 },
    });
    expect(result).toBe('assisted');
  });

  it('uses Laya DIRECT with high confidence', () => {
    const signal: LayaSignal = {
      suggestedRoute: 'DIRECT',
      confidence: 0.95,
      eventClass: 'NORMAL' as EventClass,
      severity: 'INFO' as Severity,
      probableScope: 'ONU' as ProbableScope,
      requiresInvestigation: false,
    };

    const result = mergeRoutingDecision({
      adaptiveRoute: 'investigation',
      layaSignal: signal,
      confidenceThresholds: { high: 0.9, low: 0.7 },
    });

    expect(result).toBe('direct');
  });

  it('uses adaptive route with low confidence', () => {
    const signal: LayaSignal = {
      suggestedRoute: 'DIRECT',
      confidence: 0.5,
      eventClass: 'NORMAL' as EventClass,
      severity: 'INFO' as Severity,
      probableScope: 'ONU' as ProbableScope,
      requiresInvestigation: false,
    };

    const result = mergeRoutingDecision({
      adaptiveRoute: 'assisted',
      layaSignal: signal,
      confidenceThresholds: { high: 0.9, low: 0.7 },
    });

    expect(result).toBe('assisted');
  });

  it('escalates to INVESTIGATION with medium confidence', () => {
    const signal: LayaSignal = {
      suggestedRoute: 'INVESTIGATION',
      confidence: 0.8,
      eventClass: 'OPTICAL_FAULT' as EventClass,
      severity: 'HIGH' as Severity,
      probableScope: 'PON' as ProbableScope,
      requiresInvestigation: true,
    };

    const result = mergeRoutingDecision({
      adaptiveRoute: 'direct',
      layaSignal: signal,
      confidenceThresholds: { high: 0.9, low: 0.7 },
    });

    expect(result).toBe('investigation');
  });
});

// ── Event Conversion Tests ────────────────────────────────────────────────

describe('LayaIntegration.toLayaEvent', () => {
  it('converts telemetry event to Laya format', () => {
    const event = LayaIntegration.toLayaEvent({
      eventId: 'evt-001',
      tenantId: 'tenant-001',
      source: 'snmp',
      deviceKind: 'ONU',
      deviceId: 'ONU-342',
      alarmType: 'LOS',
      rxPower: -27.8,
      rawSummary: 'ONU-342 reports LOS. RX power dropped.',
    });

    expect(event.eventId).toBe('evt-001');
    expect(event.source).toBe('snmp');
    expect(event.deviceKind).toBe('ONU');
    expect(event.rxPower).toBe(-27.8);
  });

  it('includes topology context when provided', () => {
    const event = LayaIntegration.toLayaEvent({
      eventId: 'evt-002',
      tenantId: 'tenant-001',
      source: 'smartolt',
      alarmType: 'MASS_OUTAGE',
      affectedOnus: 14,
      rawSummary: '14 ONUs offline on PON 0/2/7',
      topologyContext: {
        oltId: 'OLT-01',
        ponPort: '0/2/7',
      },
    });

    expect(event.topologyContext).toBeDefined();
    expect(event.topologyContext?.oltId).toBe('OLT-01');
    expect(event.topologyContext?.ponPort).toBe('0/2/7');
  });
});

// ── Global Instance Tests ─────────────────────────────────────────────────

describe('getLayaIntegration', () => {
  beforeEach(() => {
    // Reset global instance before each test
    resetLayaIntegration();
  });

  it('creates and returns a singleton instance', () => {
    const instance1 = getLayaIntegration();
    const instance2 = getLayaIntegration();

    expect(instance1).toBe(instance2);
    expect(instance1).toBeInstanceOf(LayaIntegration);
  });

  it('returns the same instance on multiple calls', () => {
    const instance1 = getLayaIntegration();
    const instance2 = getLayaIntegration();
    const instance3 = getLayaIntegration();

    expect(instance1).toBe(instance2);
    expect(instance2).toBe(instance3);
  });
});

describe('resetLayaIntegration', () => {
  beforeEach(() => {
    resetLayaIntegration();
  });

  it('resets the global instance to null', () => {
    const instance1 = getLayaIntegration();
    resetLayaIntegration();
    const instance2 = getLayaIntegration();

    // instance2 should be a new instance, not the same as instance1
    expect(instance1).not.toBe(instance2);
  });

  it('allows creating a fresh instance after reset', () => {
    const instance1 = getLayaIntegration();
    expect(instance1).toBeInstanceOf(LayaIntegration);

    resetLayaIntegration();

    const instance2 = getLayaIntegration();
    expect(instance2).toBeInstanceOf(LayaIntegration);
    expect(instance1).not.toBe(instance2);
  });
});
