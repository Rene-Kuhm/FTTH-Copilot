import { describe, it, expect } from 'vitest';
import type { EventClass } from '../src/laya-expert-system';
import type { LayaMode } from '../src/laya-shadow';
import {
  getLayaConfig,
  shouldLogDecision,
  canInfluenceRouting,
  canTakeDirectRoute,
  toDecisionLog,
  getSuggestedRoute,
  calculateAgreement,
} from '../src/laya-shadow';

describe('LayaShadow', () => {
  describe('getLayaConfig', () => {
    it('returns defaults when env vars not set', () => {
      const config = getLayaConfig();
      
      expect(config.enabled).toBe(true);
      expect(config.mode).toBe('shadow');
      expect(config.failOpen).toBe(true);
      expect(config.minConfidence).toBe(0.75);
    });
  });

  describe('shouldLogDecision', () => {
    it('returns false when disabled', () => {
      expect(shouldLogDecision({ enabled: false, mode: 'shadow', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false })).toBe(false);
    });

    it('returns true when enabled', () => {
      expect(shouldLogDecision({ enabled: true, mode: 'shadow', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false })).toBe(true);
    });

    it('returns false when mode is disabled', () => {
      expect(shouldLogDecision({ enabled: true, mode: 'disabled', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false })).toBe(false);
    });
  });

  describe('canInfluenceRouting', () => {
    it('returns false in shadow mode', () => {
      expect(canInfluenceRouting({ enabled: true, mode: 'shadow', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false })).toBe(false);
    });

    it('returns true in assisted mode', () => {
      expect(canInfluenceRouting({ enabled: true, mode: 'assisted', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false })).toBe(true);
    });

    it('returns true in automatic mode', () => {
      expect(canInfluenceRouting({ enabled: true, mode: 'automatic', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false })).toBe(true);
    });
  });

  describe('canTakeDirectRoute', () => {
    it('returns false when not automatic mode', () => {
      expect(canTakeDirectRoute({ enabled: true, mode: 'assisted', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false }, 0.9)).toBe(false);
    });

    it('returns false when confidence below threshold', () => {
      expect(canTakeDirectRoute({ enabled: true, mode: 'automatic', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: true }, 0.6)).toBe(false);
    });

    it('returns true when all conditions met', () => {
      expect(canTakeDirectRoute({ enabled: true, mode: 'automatic', failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: true }, 0.9)).toBe(true);
    });
  });

  describe('toDecisionLog', () => {
    it('converts ClassificationResult to log format', () => {
      const input = {
        tenantId: 'tenant-1',
        eventId: 'evt-123',
        source: 'user-query' as const,
        rawSummary: 'OLT reports LOS alarm',
      };

      const result = {
        eventClass: 'OPTICAL_FAULT' as const,
        confidence: 0.87,
        matchedKeywords: ['los alarm'],
        severity: 'HIGH' as const,
        probableScope: 'PON' as const,
        requiresInvestigation: true,
      };

      const config = { enabled: true, mode: 'shadow' as const, failOpen: true, minConfidence: 0.75, suggestRoute: true, allowDirectRouting: false };

      const log = toDecisionLog(input, result, config, 15, 'INVESTIGATION');

      expect(log.eventClass).toBe('OPTICAL_FAULT');
      expect(log.severity).toBe('HIGH');
      expect(log.probableScope).toBe('PON');
      expect(log.confidence).toBe(0.87);
      expect(log.shadow).toBe(true);
      expect(log.latencyMs).toBe(15);
      expect(log.engine).toBe('expert-system');
    });
  });

  describe('getSuggestedRoute', () => {
    it('returns DIRECT for high confidence no investigation', () => {
      const result = { eventClass: 'NORMAL' as EventClass, confidence: 0.9, matchedKeywords: [], severity: 'INFO' as const, probableScope: 'UNKNOWN' as const, requiresInvestigation: false };
      const config = { enabled: true, mode: 'assisted' as LayaMode, failOpen: true, minConfidence: 0.75, suggestRoute: true, allowDirectRouting: false };

      expect(getSuggestedRoute(result, config)).toBe('DIRECT');
    });

    it('returns INVESTIGATION when required', () => {
      const result = { eventClass: 'OPTICAL_FAULT' as EventClass, confidence: 0.9, matchedKeywords: [], severity: 'HIGH' as const, probableScope: 'PON' as const, requiresInvestigation: true };
      const config = { enabled: true, mode: 'assisted' as LayaMode, failOpen: true, minConfidence: 0.75, suggestRoute: true, allowDirectRouting: false };

      expect(getSuggestedRoute(result, config)).toBe('INVESTIGATION');
    });

    it('returns DIRECT for high confidence no investigation', () => {
      // CONGESTION with high confidence and no investigation = DIRECT
      const result = { eventClass: 'CONGESTION' as EventClass, confidence: 0.8, matchedKeywords: [], severity: 'LOW' as const, probableScope: 'UPLINK' as const, requiresInvestigation: false };
      const config = { enabled: true, mode: 'assisted' as LayaMode, failOpen: true, minConfidence: 0.75, suggestRoute: true, allowDirectRouting: false };

      expect(getSuggestedRoute(result, config)).toBe('DIRECT');
    });

    it('returns undefined when suggestRoute is false', () => {
      const result = { eventClass: 'NORMAL' as EventClass, confidence: 0.9, matchedKeywords: [], severity: 'INFO' as const, probableScope: 'UNKNOWN' as const, requiresInvestigation: false };
      const config = { enabled: true, mode: 'shadow' as LayaMode, failOpen: true, minConfidence: 0.75, suggestRoute: false, allowDirectRouting: false };

      expect(getSuggestedRoute(result, config)).toBeUndefined();
    });
  });

  describe('calculateAgreement', () => {
    it('returns true when routes match', () => {
      expect(calculateAgreement('INVESTIGATION', 'investigation')).toBe(true);
    });

    it('returns false when routes differ', () => {
      expect(calculateAgreement('DIRECT', 'investigation')).toBe(false);
    });

    it('returns false when layaRoute is undefined', () => {
      expect(calculateAgreement(undefined, 'direct')).toBe(false);
    });
  });
});
