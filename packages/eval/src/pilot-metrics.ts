/**
 * Pilot Quality, Performance, and Timing Metrics (Roadmap Fase 7 — 7.3 & 7.4).
 *
 * 7.3: "Medir diagnóstico correcto entre casos evaluables, afirmaciones respaldadas,
 *       abstención, cobertura de etiquetas, falsos positivos de alertas, latencia p95
 *       y costo por investigación. No confundir clasificación de evidencia con corrección de causa raíz."
 * 7.4: "Registrar tiempo hasta causa confirmada y hasta resolución como métricas distintas;
 *       comparar contra baseline de incidentes comparables y reportar tamaño de muestra."
 */

export interface PilotInvestigationRecord {
  id: string;
  status: 'completed' | 'abstained' | 'failed';
  adjudicatedLabel?: 'confirmed' | 'incorrect' | 'insufficient_data' | null;
  claimsCount: number;
  supportedClaimsCount: number;
  latencyMs: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  detectedAt?: string | Date;
  causeConfirmedAt?: string | Date;
  resolvedAt?: string | Date;
}

export interface PilotAlertRecord {
  alertId: string;
  isFalsePositive: boolean;
}

export interface PilotMetricsInput {
  investigations: ReadonlyArray<PilotInvestigationRecord>;
  alerts?: ReadonlyArray<PilotAlertRecord>;
  minAdjudicatedSampleSize?: number;
  promptCostPer1k?: number;
  completionCostPer1k?: number;
  baseline?: {
    meanTimeToCauseMs: number;
    meanTimeToResolutionMs: number;
    sampleSize: number;
  };
}

export interface DurationStats {
  sampleSize: number;
  meanMs: number;
  p95Ms: number;
}

export interface PilotMetricsReport {
  totalInvestigations: number;
  evaluableCasesCount: number;
  adjudicatedCasesCount: number;
  diagnosticAccuracy: number | null; // null if sample size insufficient (rule 7.3)
  diagnosticAccuracySufficiency: 'sufficient' | 'insufficient_sample';
  supportedClaimsRatio: number;
  abstentionRate: number;
  labelsCoverage: number;
  alertFalsePositiveRate: number;
  latencyP95Ms: number;
  costPerInvestigationUsd: number;
  timeToConfirmedCause: DurationStats;
  timeToResolution: DurationStats;
  baselineComparison?: {
    causeReductionPct: number;
    resolutionReductionPct: number;
    baselineSampleSize: number;
  };
}

function calculateP95(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}

function calculateMean(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, v) => acc + v, 0);
  return sum / numbers.length;
}

export function computePilotMetrics(input: PilotMetricsInput): PilotMetricsReport {
  const {
    investigations,
    alerts = [],
    minAdjudicatedSampleSize = 10,
    promptCostPer1k = 0.00125,
    completionCostPer1k = 0.005,
    baseline,
  } = input;

  const total = investigations.length;
  if (total === 0) {
    return {
      totalInvestigations: 0,
      evaluableCasesCount: 0,
      adjudicatedCasesCount: 0,
      diagnosticAccuracy: null,
      diagnosticAccuracySufficiency: 'insufficient_sample',
      supportedClaimsRatio: 1.0,
      abstentionRate: 0.0,
      labelsCoverage: 0.0,
      alertFalsePositiveRate: 0.0,
      latencyP95Ms: 0,
      costPerInvestigationUsd: 0,
      timeToConfirmedCause: { sampleSize: 0, meanMs: 0, p95Ms: 0 },
      timeToResolution: { sampleSize: 0, meanMs: 0, p95Ms: 0 },
    };
  }

  // 1. Diagnostic accuracy over evaluable adjudicated cases
  // Evaluable cases exclude unadjudicated and insufficient_data
  const adjudicated = investigations.filter(
    (inv) => inv.adjudicatedLabel === 'confirmed' || inv.adjudicatedLabel === 'incorrect',
  );
  const totalWithAnyLabel = investigations.filter((inv) => inv.adjudicatedLabel != null);
  const confirmedCount = adjudicated.filter((inv) => inv.adjudicatedLabel === 'confirmed').length;

  const isSampleSufficient = adjudicated.length >= minAdjudicatedSampleSize;
  const diagnosticAccuracy =
    isSampleSufficient && adjudicated.length > 0 ? confirmedCount / adjudicated.length : null;

  // 2. Supported claims ratio
  let totalClaims = 0;
  let supportedClaims = 0;
  for (const inv of investigations) {
    totalClaims += inv.claimsCount;
    supportedClaims += inv.supportedClaimsCount;
  }
  const supportedClaimsRatio = totalClaims > 0 ? supportedClaims / totalClaims : 1.0;

  // 3. Abstention rate
  const abstainedCount = investigations.filter((inv) => inv.status === 'abstained').length;
  const abstentionRate = abstainedCount / total;

  // 4. Label coverage
  const labelsCoverage = totalWithAnyLabel.length / total;

  // 5. Alert false positive rate
  const fpAlertsCount = alerts.filter((a) => a.isFalsePositive).length;
  const alertFalsePositiveRate = alerts.length > 0 ? fpAlertsCount / alerts.length : 0.0;

  // 6. Latency p95
  const latencies = investigations.map((inv) => inv.latencyMs);
  const latencyP95Ms = calculateP95(latencies);

  // 7. Cost per investigation
  let totalCost = 0;
  for (const inv of investigations) {
    const promptTokens = inv.tokensPrompt ?? 0;
    const compTokens = inv.tokensCompletion ?? 0;
    totalCost += (promptTokens / 1000) * promptCostPer1k + (compTokens / 1000) * completionCostPer1k;
  }
  const costPerInvestigationUsd = totalCost / total;

  // 8. Time to confirmed cause & Time to resolution (7.4)
  const causeDurations: number[] = [];
  const resolutionDurations: number[] = [];

  for (const inv of investigations) {
    if (inv.detectedAt && inv.causeConfirmedAt) {
      const start = new Date(inv.detectedAt).getTime();
      const end = new Date(inv.causeConfirmedAt).getTime();
      if (end >= start) causeDurations.push(end - start);
    }
    if (inv.detectedAt && inv.resolvedAt) {
      const start = new Date(inv.detectedAt).getTime();
      const end = new Date(inv.resolvedAt).getTime();
      if (end >= start) resolutionDurations.push(end - start);
    }
  }

  const timeToConfirmedCause: DurationStats = {
    sampleSize: causeDurations.length,
    meanMs: calculateMean(causeDurations),
    p95Ms: calculateP95(causeDurations),
  };

  const timeToResolution: DurationStats = {
    sampleSize: resolutionDurations.length,
    meanMs: calculateMean(resolutionDurations),
    p95Ms: calculateP95(resolutionDurations),
  };

  let baselineComparison;
  if (baseline && baseline.sampleSize > 0) {
    const causeReduction =
      baseline.meanTimeToCauseMs > 0
        ? (baseline.meanTimeToCauseMs - timeToConfirmedCause.meanMs) / baseline.meanTimeToCauseMs
        : 0;
    const resolutionReduction =
      baseline.meanTimeToResolutionMs > 0
        ? (baseline.meanTimeToResolutionMs - timeToResolution.meanMs) /
          baseline.meanTimeToResolutionMs
        : 0;

    baselineComparison = {
      causeReductionPct: Math.round(causeReduction * 1000) / 10,
      resolutionReductionPct: Math.round(resolutionReduction * 1000) / 10,
      baselineSampleSize: baseline.sampleSize,
    };
  }

  return {
    totalInvestigations: total,
    evaluableCasesCount: adjudicated.length,
    adjudicatedCasesCount: totalWithAnyLabel.length,
    diagnosticAccuracy,
    diagnosticAccuracySufficiency: isSampleSufficient ? 'sufficient' : 'insufficient_sample',
    supportedClaimsRatio,
    abstentionRate,
    labelsCoverage,
    alertFalsePositiveRate,
    latencyP95Ms,
    costPerInvestigationUsd,
    timeToConfirmedCause,
    timeToResolution,
    baselineComparison,
  };
}
