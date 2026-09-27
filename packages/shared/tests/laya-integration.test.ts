/**
 * Unit tests for Laya Integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LayaIntegration,
  shouldConsultLaya,
  mergeRoutingDecision,
} from '../src/laya-integration.js';
import type { LayaDecision, LayaSignal } from '../src/contracts.js';

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
      model: 'laya-multilingual',
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
        model: 'laya-multilingual',
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
        model: 'laya-multilingual',
      });
      expect(shadowIntegration.isShadowMode()).toBe(true);

      const assistedIntegration = new LayaIntegration({
        enabled: true,
        mode: 'assisted',
        timeoutMs: 250,
        failOpen: true,
        confidenceThresholdHigh: 0.95,
        confidenceThresholdLow: 0.75,
        model: 'laya-multilingual',
      });
      expect(assistedIntegration.isShadowMode()).toBe(false);
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
        schema: 'ftth.laya-decision.v1',
        eventId: 'test',
        eventClass: 'NORMAL',
        severity: 'INFO',
        probableScope: 'ONU',
        suggestedRoute: 'DIRECT',
        requiresInvestigation: false,
        confidence: {
          eventClass: 0.95,
          severity: 0.9,
          probableScope: 0.8,
          suggestedRoute: 0.95,
        },
        model: 'laya-multilingual',
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
        schema: 'ftth.laya-decision.v1',
        eventId: 'test',
        eventClass: 'OPTICAL_FAULT',
        severity: 'HIGH',
        probableScope: 'PON',
        suggestedRoute: 'DIRECT',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.5,
          severity: 0.4,
          probableScope: 0.6,
          suggestedRoute: 0.5,
        },
        model: 'laya-multilingual',
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
        schema: 'ftth.laya-decision.v1',
        eventId: 'test',
        eventClass: 'NORMAL',
        severity: 'LOW',
        probableScope: 'ONU',
        suggestedRoute: 'DIRECT',
        requiresInvestigation: false,
        confidence: {
          eventClass: 0.8,
          severity: 0.75,
          probableScope: 0.7,
          suggestedRoute: 0.8, // 0.8 is medium confidence (between 0.7 and 0.9)
        },
        model: 'laya-multilingual',
      };

      // Medium confidence (0.7-0.9) + DIRECT route → follow Laya
      expect(integration.shouldFollowLayaRoute(decision)).toBe(true);
    });
  });

  describe('shouldEscalate', () => {
    it('escalates UNKNOWN with low confidence', () => {
      const decision: LayaDecision = {
        schema: 'ftth.laya-decision.v1',
        eventId: 'test',
        eventClass: 'UNKNOWN',
        severity: 'INFO',
        probableScope: 'UNKNOWN',
        suggestedRoute: 'ASSISTED',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.5,
          severity: 0.5,
          probableScope: 0.5,
          suggestedRoute: 0.5,
        },
        model: 'laya-multilingual',
      };

      expect(integration.shouldEscalate(decision)).toBe(true);
    });

    it('escalates CRITICAL with low confidence', () => {
      const decision: LayaDecision = {
        schema: 'ftth.laya-decision.v1',
        eventId: 'test',
        eventClass: 'MASS_OUTAGE',
        severity: 'CRITICAL',
        probableScope: 'PON',
        suggestedRoute: 'INVESTIGATION',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.8,
          severity: 0.85, // Below 0.9
          probableScope: 0.7,
          suggestedRoute: 0.9,
        },
        model: 'laya-multilingual',
      };

      expect(integration.shouldEscalate(decision)).toBe(true);
    });

    it('does not escalate high confidence decisions', () => {
      const decision: LayaDecision = {
        schema: 'ftth.laya-decision.v1',
        eventId: 'test',
        eventClass: 'OPTICAL_FAULT',
        severity: 'HIGH',
        probableScope: 'PON',
        suggestedRoute: 'INVESTIGATION',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.95,
          severity: 0.95,
          probableScope: 0.9,
          suggestedRoute: 0.95,
        },
        model: 'laya-multilingual',
      };

      expect(integration.shouldEscalate(decision)).toBe(false);
    });
  });

  describe('buildLayaSignal', () => {
    it('builds correct signal from decision', () => {
      const decision: LayaDecision = {
        schema: 'ftth.laya-decision.v1',
        eventId: 'test',
        eventClass: 'OPTICAL_FAULT',
        severity: 'HIGH',
        probableScope: 'PON',
        suggestedRoute: 'INVESTIGATION',
        requiresInvestigation: true,
        confidence: {
          eventClass: 0.9,
          severity: 0.85,
          probableScope: 0.8,
          suggestedRoute: 0.92,
        },
        model: 'laya-multilingual',
      };

      const signal = integration.buildLayaSignal(decision);

      expect(signal.suggestedRoute).toBe('INVESTIGATION');
      expect(signal.confidence).toBe(0.9);
      expect(signal.probableScope).toBe('PON');
      expect(signal.eventClass).toBe('OPTICAL_FAULT');
      expect(signal.requiresInvestigation).toBe(true);
    });
  });
});

// ── Feature Flag Tests ──────────────────────────────────────────────────

describe('shouldConsultLaya', () => {
  it('returns false when disabled', () => {
    const config = {
      enabled: false,
      mode: 'disabled' as const,
      timeoutMs: 250,
      failOpen: true,
      confidenceThresholdHigh: 0.95,
      confidenceThresholdLow: 0.75,
      model: 'laya-multilingual',
    };
    expect(shouldConsultLaya(config)).toBe(false);
  });

  it('returns true in shadow mode', () => {
    const config = {
      enabled: true,
      mode: 'shadow' as const,
      timeoutMs: 250,
      failOpen: true,
      confidenceThresholdHigh: 0.95,
      confidenceThresholdLow: 0.75,
      model: 'laya-multilingual',
    };
    expect(shouldConsultLaya(config)).toBe(true);
  });

  it('returns true in assisted mode', () => {
    const config = {
      enabled: true,
      mode: 'assisted' as const,
      timeoutMs: 250,
      failOpen: true,
      confidenceThresholdHigh: 0.95,
      confidenceThresholdLow: 0.75,
      model: 'laya-multilingual',
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
      probableScope: 'ONU',
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
      probableScope: 'ONU',
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
      probableScope: 'PON',
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

    expect(event.schema).toBe('ftth.laya-decision-event.v1');
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
