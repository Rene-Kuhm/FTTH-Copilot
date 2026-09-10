/**
 * Pilot Acceptance Criteria and Hard Safety Gates (Roadmap Fase 7 — 7.5 & 7.6).
 *
 * 7.5: "Definir antes del piloto los umbrales numéricos de aceptación y duración.
 *       Si no están fijados, no habilitar producción general.
 *       Propuesta de inicio: 14 días y 50 investigaciones adjudicadas."
 * 7.6: "Criterios duros: cero accesos cruzados, cero acciones NMS no autorizadas
 *       y rechazo de referencias inexistentes en pruebas de aceptación."
 */

import type { PilotMetricsReport } from './pilot-metrics';

export interface HardSafetyMetrics {
  crossTenantLeaks: number;
  unauthorizedNmsActions: number;
  nonExistentReferencesAccepted: number;
}

export interface PilotAcceptanceThresholds {
  minDurationDays: number;
  minAdjudicatedInvestigations: number;
  minDiagnosticAccuracy: number;
  minSupportedClaimsRatio: number;
  maxAlertFalsePositiveRate: number;
  maxLatencyP95Ms: number;
}

export const DEFAULT_PILOT_THRESHOLDS: Readonly<PilotAcceptanceThresholds> = {
  minDurationDays: 14,
  minAdjudicatedInvestigations: 50,
  minDiagnosticAccuracy: 0.8, // >= 80% confirmed root causes
  minSupportedClaimsRatio: 0.9, // >= 90% claims backed by evidence
  maxAlertFalsePositiveRate: 0.05, // <= 5% false alarms
  maxLatencyP95Ms: 15000, // <= 15s p95
};

export interface HardSafetyResult {
  passed: boolean;
  violations: string[];
}

export interface PilotAcceptanceResult {
  decision: 'accepted' | 'rejected' | 'insufficient_volume_or_duration';
  hardSafetyPassed: boolean;
  thresholdsPassed: boolean;
  blockers: string[];
  metrics: {
    durationDays: number;
    adjudicatedCount: number;
    diagnosticAccuracy: number | null;
    supportedClaimsRatio: number;
    alertFalsePositiveRate: number;
    latencyP95Ms: number;
  };
}

/**
 * Validates zero-tolerance hard safety criteria (7.6).
 */
export function evaluateHardSafetyCriteria(metrics: HardSafetyMetrics): HardSafetyResult {
  const violations: string[] = [];

  if (metrics.crossTenantLeaks > 0) {
    violations.push(
      `HARD GATE BREACH: Detected ${metrics.crossTenantLeaks} cross-tenant data leakages`,
    );
  }

  if (metrics.unauthorizedNmsActions > 0) {
    violations.push(
      `HARD GATE BREACH: Detected ${metrics.unauthorizedNmsActions} unauthorized NMS commands/mutations`,
    );
  }

  if (metrics.nonExistentReferencesAccepted > 0) {
    violations.push(
      `HARD GATE BREACH: Accepted ${metrics.nonExistentReferencesAccepted} nonexistent device/evidence references`,
    );
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Comprehensive pilot acceptance evaluation (7.5 + 7.6 + Gate 7).
 */
export function evaluatePilotAcceptance(
  report: PilotMetricsReport,
  safety: HardSafetyMetrics,
  durationDays: number,
  customThresholds: Partial<PilotAcceptanceThresholds> = {},
): PilotAcceptanceResult {
  const thresholds: PilotAcceptanceThresholds = {
    ...DEFAULT_PILOT_THRESHOLDS,
    ...customThresholds,
  };

  const hardSafety = evaluateHardSafetyCriteria(safety);
  const blockers: string[] = [...hardSafety.violations];

  // 1. Duration & Volume Check (7.5)
  const hasVolume = report.adjudicatedCasesCount >= thresholds.minAdjudicatedInvestigations;
  const hasDuration = durationDays >= thresholds.minDurationDays;

  if (!hasDuration) {
    blockers.push(
      `Pilot duration (${durationDays} days) is less than required ${thresholds.minDurationDays} days`,
    );
  }

  if (!hasVolume) {
    blockers.push(
      `Adjudicated investigations count (${report.adjudicatedCasesCount}) is below required minimum ${thresholds.minAdjudicatedInvestigations}`,
    );
  }

  // 2. Numerical Thresholds Check
  let thresholdsPassed = true;

  if (report.diagnosticAccuracy === null) {
    thresholdsPassed = false;
    blockers.push('Diagnostic accuracy is indeterminate (insufficient adjudicated sample)');
  } else if (report.diagnosticAccuracy < thresholds.minDiagnosticAccuracy) {
    thresholdsPassed = false;
    blockers.push(
      `Diagnostic accuracy (${(report.diagnosticAccuracy * 100).toFixed(1)}%) is below required threshold (${(thresholds.minDiagnosticAccuracy * 100).toFixed(1)}%)`,
    );
  }

  if (report.supportedClaimsRatio < thresholds.minSupportedClaimsRatio) {
    thresholdsPassed = false;
    blockers.push(
      `Supported claims ratio (${(report.supportedClaimsRatio * 100).toFixed(1)}%) is below threshold (${(thresholds.minSupportedClaimsRatio * 100).toFixed(1)}%)`,
    );
  }

  if (report.alertFalsePositiveRate > thresholds.maxAlertFalsePositiveRate) {
    thresholdsPassed = false;
    blockers.push(
      `Alert false positive rate (${(report.alertFalsePositiveRate * 100).toFixed(1)}%) exceeds threshold (${(thresholds.maxAlertFalsePositiveRate * 100).toFixed(1)}%)`,
    );
  }

  if (report.latencyP95Ms > thresholds.maxLatencyP95Ms) {
    thresholdsPassed = false;
    blockers.push(
      `Latency p95 (${report.latencyP95Ms}ms) exceeds max threshold (${thresholds.maxLatencyP95Ms}ms)`,
    );
  }

  let decision: 'accepted' | 'rejected' | 'insufficient_volume_or_duration';
  if (!hardSafety.passed) {
    decision = 'rejected';
  } else if (!hasDuration || !hasVolume) {
    decision = 'insufficient_volume_or_duration';
  } else if (thresholdsPassed) {
    decision = 'accepted';
  } else {
    decision = 'rejected';
  }

  return {
    decision,
    hardSafetyPassed: hardSafety.passed,
    thresholdsPassed: thresholdsPassed && hasVolume && hasDuration,
    blockers,
    metrics: {
      durationDays,
      adjudicatedCount: report.adjudicatedCasesCount,
      diagnosticAccuracy: report.diagnosticAccuracy,
      supportedClaimsRatio: report.supportedClaimsRatio,
      alertFalsePositiveRate: report.alertFalsePositiveRate,
      latencyP95Ms: report.latencyP95Ms,
    },
  };
}
