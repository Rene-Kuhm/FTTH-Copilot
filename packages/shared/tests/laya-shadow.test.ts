import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventClass } from '../src/laya-expert-system';
import type { LayaMode } from '../src/laya-shadow';
import {
  getLayaConfig,
  shouldLogDecision,
  canInfluenceRouting,
  canTakeDirectRoute,
  toDecisionLog,
  logLayaDecision,
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

    it('returns ASSISTED for default case (low confidence, no investigation)', () => {
      const result = { eventClass: 'UNKNOWN' as EventClass, confidence: 0.5, matchedKeywords: [], severity: 'INFO' as const, probableScope: 'UNKNOWN' as const, requiresInvestigation: false };
      const config = { enabled: true, mode: 'assisted' as LayaMode, failOpen: true, minConfidence: 0.75, suggestRoute: true, allowDirectRouting: false };

      expect(getSuggestedRoute(result, config)).toBe('ASSISTED');
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

    it('returns true for ASSISTED route match (edge case)', () => {
      expect(calculateAgreement('ASSISTED', 'assisted')).toBe(true);
    });

    it('handles lowercase layaRoute input', () => {
      // @ts-ignore - testing runtime behavior
      expect(calculateAgreement('direct', 'direct')).toBe(true);
    });
  });

  describe('logLayaDecision', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('logs decision to console in non-production environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const input = {
        tenantId: 'tenant-1',
        eventId: 'evt-123',
        source: 'user-query' as const,
        rawSummary: 'OLT reports LOS alarm',
      };

      const decision = {
        engine: 'expert-system' as const,
        model: 'ftth-expert-system-v1',
        modelVersion: '1.0.0',
        eventClass: 'OPTICAL_FAULT' as EventClass,
        severity: 'HIGH' as const,
        probableScope: 'PON' as const,
        requiresInvestigation: true,
        confidence: 0.87,
        matchedKeywords: ['los'],
        latencyMs: 15,
        suggestedRoute: 'INVESTIGATION' as const,
        shadow: true,
        mode: 'shadow' as LayaMode,
        result: 'success' as const,
      };

      await logLayaDecision(input, decision);

      expect(consoleLogSpy).toHaveBeenCalled();
      const logCall = consoleLogSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logCall) as Record<string, unknown>;
      const p = parsed as { type: string; tenantId: string; eventId?: string; engine: string; eventClass: string; severity: string; probableScope: string; confidence: number; suggestedRoute?: string; shadow: boolean; latencyMs: number; matchedKeywords?: string[] };

      expect(p.type).toStrictEqual('laya_decision');
      expect(p.tenantId).toStrictEqual('tenant-1');
      expect(p.eventId).toStrictEqual('evt-123');
      expect(p.engine).toStrictEqual('expert-system');
      expect(p.eventClass).toStrictEqual('OPTICAL_FAULT');
      expect(p.suggestedRoute).toStrictEqual('INVESTIGATION');

      process.env.NODE_ENV = originalEnv;
    });

    it('logs decision when LAYA_LOG_LEVEL is debug in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalLogLevel = process.env.LAYA_LOG_LEVEL;

      process.env.NODE_ENV = 'production';
      process.env.LAYA_LOG_LEVEL = 'debug';

      const input = {
        tenantId: 'tenant-1',
        eventId: 'evt-456',
        source: 'user-query' as const,
        rawSummary: 'Test alarm',
      };

      const decision = {
        engine: 'expert-system' as const,
        model: 'ftth-expert-system-v1',
        modelVersion: '1.0.0',
        eventClass: 'NORMAL' as EventClass,
        severity: 'INFO' as const,
        probableScope: 'ONU' as const,
        requiresInvestigation: false,
        confidence: 0.95,
        matchedKeywords: [],
        latencyMs: 10,
        suggestedRoute: 'DIRECT' as const,
        shadow: false,
        mode: 'assisted' as LayaMode,
        result: 'success' as const,
      };

      await logLayaDecision(input, decision);

      expect(consoleLogSpy).toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
      process.env.LAYA_LOG_LEVEL = originalLogLevel;
    });

    it('does not log when in production without debug flag', async () => {
      const originalEnv = process.env.NODE_ENV;
      const originalLogLevel = process.env.LAYA_LOG_LEVEL;

      process.env.NODE_ENV = 'production';
      process.env.LAYA_LOG_LEVEL = undefined;

      const input = {
        tenantId: 'tenant-1',
        eventId: 'evt-789',
        source: 'user-query' as const,
        rawSummary: 'Test alarm',
      };

      const decision = {
        engine: 'expert-system' as const,
        model: 'ftth-expert-system-v1',
        modelVersion: '1.0.0',
        eventClass: 'NORMAL' as EventClass,
        severity: 'INFO' as const,
        probableScope: 'ONU' as const,
        requiresInvestigation: false,
        confidence: 0.95,
        matchedKeywords: [],
        latencyMs: 10,
        suggestedRoute: 'DIRECT' as const,
        shadow: false,
        mode: 'assisted' as LayaMode,
        result: 'success' as const,
      };

      await logLayaDecision(input, decision);

      expect(consoleLogSpy).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
      process.env.LAYA_LOG_LEVEL = originalLogLevel;
    });
  });
});
