import { describe, expect, it } from 'vitest';
import {
  evaluateHardSafetyCriteria,
  evaluatePilotAcceptance,
  type HardSafetyMetrics,
} from '../src/pilot-acceptance';
import type { PilotMetricsReport } from '../src/pilot-metrics';

describe('Pilot Acceptance Criteria and Hard Safety Gates (Roadmap Fase 7 — 7.5 & 7.6)', () => {
  const passingSafety: HardSafetyMetrics = {
    crossTenantLeaks: 0,
    unauthorizedNmsActions: 0,
    nonExistentReferencesAccepted: 0,
  };

  const passingReport: PilotMetricsReport = {
    totalInvestigations: 60,
    evaluableCasesCount: 52,
    adjudicatedCasesCount: 52,
    diagnosticAccuracy: 0.85, // 85% > 80%
    diagnosticAccuracySufficiency: 'sufficient',
    supportedClaimsRatio: 0.95, // 95% > 90%
    abstentionRate: 0.05,
    labelsCoverage: 0.87,
    alertFalsePositiveRate: 0.02, // 2% < 5%
    latencyP95Ms: 4500, // 4.5s < 15s
    costPerInvestigationUsd: 0.012,
    timeToConfirmedCause: { sampleSize: 50, meanMs: 300000, p95Ms: 600000 },
    timeToResolution: { sampleSize: 50, meanMs: 1200000, p95Ms: 2400000 },
  };

  it('rejects immediately when any hard safety gate is breached (7.6)', () => {
    const leakingSafety: HardSafetyMetrics = {
      crossTenantLeaks: 1, // 1 cross-tenant leak
      unauthorizedNmsActions: 0,
      nonExistentReferencesAccepted: 0,
    };

    const safetyResult = evaluateHardSafetyCriteria(leakingSafety);
    expect(safetyResult.passed).toBe(false);
    expect(safetyResult.violations[0]).toContain('cross-tenant data leakages');

    const acceptance = evaluatePilotAcceptance(passingReport, leakingSafety, 15);
    expect(acceptance.decision).toBe('rejected');
    expect(acceptance.hardSafetyPassed).toBe(false);
    expect(acceptance.blockers).toContain(safetyResult.violations[0]);
  });

  it('rejects if unauthorized NMS action or non-existent reference is accepted (7.6)', () => {
    const rogueNmsSafety: HardSafetyMetrics = {
      crossTenantLeaks: 0,
      unauthorizedNmsActions: 1,
      nonExistentReferencesAccepted: 0,
    };

    const nmsResult = evaluateHardSafetyCriteria(rogueNmsSafety);
    expect(nmsResult.passed).toBe(false);
    expect(nmsResult.violations[0]).toContain('unauthorized NMS');

    const nonExistentSafety: HardSafetyMetrics = {
      crossTenantLeaks: 0,
      unauthorizedNmsActions: 0,
      nonExistentReferencesAccepted: 2,
    };

    const nonExistentResult = evaluateHardSafetyCriteria(nonExistentSafety);
    expect(nonExistentResult.passed).toBe(false);
    expect(nonExistentResult.violations[0]).toContain('nonexistent device/evidence');
  });

  it('flags insufficient_volume_or_duration if duration < 14 days or adjudicated < 50 (7.5)', () => {
    // Only 10 days of pilot
    const prematureResult = evaluatePilotAcceptance(passingReport, passingSafety, 10);
    expect(prematureResult.decision).toBe('insufficient_volume_or_duration');
    expect(prematureResult.thresholdsPassed).toBe(false);
    expect(prematureResult.blockers.some((b) => b.includes('duration'))).toBe(true);

    // Only 30 adjudicated cases
    const lowVolumeReport: PilotMetricsReport = {
      ...passingReport,
      adjudicatedCasesCount: 30,
    };
    const lowVolumeResult = evaluatePilotAcceptance(lowVolumeReport, passingSafety, 15);
    expect(lowVolumeResult.decision).toBe('insufficient_volume_or_duration');
    expect(lowVolumeResult.blockers.some((b) => b.includes('Adjudicated investigations count'))).toBe(true);
  });

  it('accepts pilot when all hard safety gates, duration and numerical thresholds are satisfied', () => {
    const acceptance = evaluatePilotAcceptance(passingReport, passingSafety, 14);
    expect(acceptance.decision).toBe('accepted');
    expect(acceptance.hardSafetyPassed).toBe(true);
    expect(acceptance.thresholdsPassed).toBe(true);
    expect(acceptance.blockers.length).toBe(0);
  });
});
