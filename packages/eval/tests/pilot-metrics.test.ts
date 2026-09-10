import { describe, expect, it } from 'vitest';
import {
  computePilotMetrics,
  type PilotInvestigationRecord,
  type PilotAlertRecord,
} from '../src/pilot-metrics';

describe('Pilot Metrics Engine (Roadmap Fase 7 — 7.3 & 7.4)', () => {
  const mockInvestigations: PilotInvestigationRecord[] = [
    {
      id: 'inv-1',
      status: 'completed',
      adjudicatedLabel: 'confirmed',
      claimsCount: 4,
      supportedClaimsCount: 4,
      latencyMs: 1200,
      tokensPrompt: 800,
      tokensCompletion: 200,
      detectedAt: '2026-09-10T10:00:00.000Z',
      causeConfirmedAt: '2026-09-10T10:05:00.000Z', // 5m
      resolvedAt: '2026-09-10T10:20:00.000Z', // 20m
    },
    {
      id: 'inv-2',
      status: 'completed',
      adjudicatedLabel: 'confirmed',
      claimsCount: 3,
      supportedClaimsCount: 3,
      latencyMs: 1500,
      tokensPrompt: 1000,
      tokensCompletion: 300,
      detectedAt: '2026-09-10T11:00:00.000Z',
      causeConfirmedAt: '2026-09-10T11:07:00.000Z', // 7m
      resolvedAt: '2026-09-10T11:25:00.000Z', // 25m
    },
    {
      id: 'inv-3',
      status: 'completed',
      adjudicatedLabel: 'incorrect',
      claimsCount: 2,
      supportedClaimsCount: 1,
      latencyMs: 2000,
      tokensPrompt: 1200,
      tokensCompletion: 400,
      detectedAt: '2026-09-10T12:00:00.000Z',
      causeConfirmedAt: '2026-09-10T12:15:00.000Z', // 15m
      resolvedAt: '2026-09-10T12:45:00.000Z', // 45m
    },
    {
      id: 'inv-4',
      status: 'abstained',
      adjudicatedLabel: 'insufficient_data',
      claimsCount: 0,
      supportedClaimsCount: 0,
      latencyMs: 800,
      tokensPrompt: 500,
      tokensCompletion: 50,
    },
  ];

  const mockAlerts: PilotAlertRecord[] = [
    { alertId: 'alt-1', isFalsePositive: false },
    { alertId: 'alt-2', isFalsePositive: false },
    { alertId: 'alt-3', isFalsePositive: true },
  ];

  it('marks diagnostic accuracy as insufficient when sample size is below threshold (7.3)', () => {
    const report = computePilotMetrics({
      investigations: mockInvestigations,
      minAdjudicatedSampleSize: 10, // requires 10, we only have 3 (2 confirmed, 1 incorrect)
    });

    expect(report.diagnosticAccuracy).toBeNull();
    expect(report.diagnosticAccuracySufficiency).toBe('insufficient_sample');
    expect(report.evaluableCasesCount).toBe(3);
    expect(report.adjudicatedCasesCount).toBe(4);
  });

  it('computes accurate diagnostic accuracy when sample size is sufficient', () => {
    const report = computePilotMetrics({
      investigations: mockInvestigations,
      minAdjudicatedSampleSize: 2, // sufficient: 2 confirmed out of 3 evaluable = 66.7%
    });

    expect(report.diagnosticAccuracy).toBeCloseTo(0.667, 2);
    expect(report.diagnosticAccuracySufficiency).toBe('sufficient');
  });

  it('computes supported claims ratio, abstention rate and false positive rate', () => {
    const report = computePilotMetrics({
      investigations: mockInvestigations,
      alerts: mockAlerts,
    });

    // Total claims = 4 + 3 + 2 = 9. Supported = 4 + 3 + 1 = 8. Ratio = 8/9
    expect(report.supportedClaimsRatio).toBeCloseTo(8 / 9, 2);
    // 1 abstained out of 4 = 0.25
    expect(report.abstentionRate).toBe(0.25);
    // 1 FP alert out of 3 = 0.333
    expect(report.alertFalsePositiveRate).toBeCloseTo(1 / 3, 2);
  });

  it('measures time-to-cause and time-to-resolution distinctly and compares with baseline (7.4)', () => {
    const report = computePilotMetrics({
      investigations: mockInvestigations,
      baseline: {
        meanTimeToCauseMs: 15 * 60 * 1000, // 15 mins
        meanTimeToResolutionMs: 60 * 60 * 1000, // 60 mins
        sampleSize: 50,
      },
    });

    expect(report.timeToConfirmedCause.sampleSize).toBe(3);
    // mean cause time: (5 + 7 + 15) / 3 = 9 mins = 540,000 ms
    expect(report.timeToConfirmedCause.meanMs).toBe(540000);

    expect(report.timeToResolution.sampleSize).toBe(3);
    // mean resolution time: (20 + 25 + 45) / 3 = 30 mins = 1,800,000 ms
    expect(report.timeToResolution.meanMs).toBe(1800000);

    // Reduction vs 15m baseline: (15 - 9) / 15 = 40%
    expect(report.baselineComparison?.causeReductionPct).toBe(40);
    // Reduction vs 60m baseline: (60 - 30) / 60 = 50%
    expect(report.baselineComparison?.resolutionReductionPct).toBe(50);
    expect(report.baselineComparison?.baselineSampleSize).toBe(50);
  });
});
