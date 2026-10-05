/**
 * Learned confidence scoring for correlated network situations.
 *
 * The topology correlator decides *which* events belong together; this module decides
 * *how much to believe* that grouping. It is an online logistic (perceptron) classifier
 * over hand-derived network features, not a black box: every weight is a named
 * coefficient an operator can inspect, and each one moves in response to real outcomes
 * — a situation that becomes a confirmed incident pushes its features up, one an
 * operator dismisses pushes them down.
 *
 * Weights are per-tenant and persisted, so the ranking improves as the installation
 * accumulates labelled outcomes. Until then the priors below are used unchanged.
 */

/** One member event of a correlated situation. */
export interface SituationEvent {
  sourceEventId: string;
  deviceId: string;
  deviceKind: string;
  timestamp: string;
  sourceKind: 'snmp_trap' | 'syslog' | 'metric' | 'nms' | string;
  alertKind?: string;
  severity?: 'critical' | 'warning' | 'info' | string;
}

export interface SituationGroup {
  ancestorKind: string;
  ancestorId: string;
  windowStart: string;
  windowEnd: string;
  affectedRatio: number;
  affectedCount: number;
  totalPopulation: number;
  events: SituationEvent[];
}

/**
 * All features are normalised to [0, 1] so no single one can dominate the logit and
 * the online update keeps a single learning rate meaningful.
 */
export interface SituationFeatures {
  /** Share of the ancestor's downstream population that went down together. */
  affectedRatio: number;
  /** Distinct downstream branches hit; >1 implies an upstream shared component. */
  branchSpread: number;
  /** How many independent evidence sources corroborate (snmp, syslog, metric, …). */
  evidenceDiversity: number;
  /** 1 when the events are packed at one instant, →0 when spread across the window. */
  temporalTightness: number;
  /** Share of events carrying the same alert kind. */
  kindAgreement: number;
  /** Depth of the shared ancestor: OLT-level is broad, CTO-level is local. */
  ancestorBreadth: number;
  /** Worst member severity, mapped to a ramp. */
  severityWeight: number;
  /** Confirmed RBCD anomalies overlapping the window, saturating at 3. */
  anomalyCorroboration: number;
  /** Group size relative to a reference of 20 events. */
  volume: number;
}

export type CorrelationWeights = Record<keyof SituationFeatures, number>;

const FEATURE_KEYS: Array<keyof SituationFeatures> = [
  'affectedRatio',
  'branchSpread',
  'evidenceDiversity',
  'temporalTightness',
  'kindAgreement',
  'ancestorBreadth',
  'severityWeight',
  'anomalyCorroboration',
  'volume',
];

/**
 * Priors. The sign encodes the prior belief: a wide blast radius on a shared upstream
 * ancestor, corroborated by several independent sources in a tight window, is what an
 * operator should trust. `temporalTightness` and `volume` are deliberately small
 * because they are the two easiest to overfit on a small installation.
 */
export function defaultWeights(): CorrelationWeights {
  return {
    affectedRatio: 0.85,
    branchSpread: 0.7,
    evidenceDiversity: 0.8,
    temporalTightness: 0.15,
    kindAgreement: 0.5,
    ancestorBreadth: 0.6,
    severityWeight: 0.55,
    anomalyCorroboration: 0.9,
    volume: 0.1,
  };
}

/**
 * Numerically stable logistic: avoids exp() overflow at large |x|, and keeps the result
 * strictly inside (0, 1). At |x| > ~745 the exponential underflows to 0, which would
 * otherwise return exactly 0 or 1 — a confidence of literally zero is not a meaningful
 * score, and downstream comparisons against it become degenerate.
 */
export function sigmoid(x: number): number {
  const EPSILON = 1e-12;
  if (!Number.isFinite(x)) return x > 0 ? 1 - EPSILON : EPSILON;
  const raw = x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
  return Math.min(1 - EPSILON, Math.max(EPSILON, raw));
}

const SEVERITY_RAMP: Record<string, number> = { critical: 1, warning: 0.55, info: 0.2 };

/** How many downstream layers a shared ancestor represents; OLT is the broadest. */
const ANCESTOR_BREADTH: Record<string, number> = {
  OLT: 1,
  PON_PORT: 0.75,
  SPLITTER: 0.55,
  CTO: 0.4,
  ONU: 0.15,
};

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** An overlap reported by the anomaly detector for this situation. */
export interface AnomalyOverlap {
  key: string;
  startIndex: number;
  endIndex: number;
}

/**
 * Derive the feature vector for a situation.
 *
 * `anomalies` are RBCD groups whose window overlaps the situation window; corroboration
 * from an independent statistical detector is the single strongest signal available,
 * so it is a first-class feature rather than a tie-breaker.
 */
export function extractFeatures(
  group: SituationGroup,
  anomalies: readonly AnomalyOverlap[] = [],
): SituationFeatures {
  const events = group.events ?? [];
  const start = new Date(group.windowStart).getTime();
  const end = new Date(group.windowEnd).getTime();
  const windowMs = Number.isFinite(end - start) && end > start ? end - start : 0;

  // Branch spread: distinct devices is the only branch signal available at this layer,
  // so it doubles as the proxy for how many downstream legs the fault reached.
  const distinctDevices = new Set(events.map((e) => e.deviceId)).size;
  const branchSpread = clamp01(distinctDevices / 5);

  const sources = new Set(events.map((e) => e.sourceKind));
  const evidenceDiversity = clamp01(sources.size / 3);

  // Temporal tightness: the share of the window the event span actually occupies. A
  // zero-length window means "same instant", which is maximally tight.
  let temporalTightness = 0.5;
  if (windowMs > 0 && events.length > 0) {
    const times = events
      .map((e) => new Date(e.timestamp).getTime())
      .filter((t) => Number.isFinite(t));
    if (times.length > 0) {
      const span = Math.max(...times) - Math.min(...times);
      temporalTightness = clamp01(1 - span / windowMs);
    }
  } else if (events.length > 0) {
    temporalTightness = 1;
  }

  const kinds = events.map((e) => e.alertKind).filter((k): k is string => Boolean(k));
  const kindAgreement = kinds.length === 0
    ? 0
    : clamp01(new Set(kinds).size === 1 ? 1 : 1 - (new Set(kinds).size - 1) / kinds.length);

  const ancestorBreadth = clamp01(ANCESTOR_BREADTH[group.ancestorKind] ?? 0.3);

  const worstSeverity = events.reduce<number>(
    (worst, e) => Math.max(worst, SEVERITY_RAMP[e.severity ?? 'info'] ?? 0.2),
    0,
  );

  const anomalyCorroboration = clamp01(anomalies.length / 3);

  const volume = clamp01(events.length / 20);

  // ── Support scaling ────────────────────────────────────────────────
  // Every consensus-derived feature is trivially maximal for a single event: one event
  // is always perfectly "tight" and always perfectly "same kind". Left unscaled, a lone
  // info-level blip scored 0.86 and escalated to `major`, because ancestorBreadth alone
  // contributed 0.6. Correlation is a claim about agreement BETWEEN events, so these
  // features are scaled by how much evidence actually exists to agree.
  //
  // Support is measured in event count, not distinct devices: twenty traps from one bad
  // ONU are strong evidence, and a device-count measure would wrongly zero that out.
  const support = clamp01(events.length / 3);

  return {
    // Blast radius and volume describe the population, not agreement, so they are not
    // support-scaled.
    affectedRatio: clamp01(group.affectedRatio),
    branchSpread: branchSpread * support,
    evidenceDiversity: evidenceDiversity * support,
    temporalTightness: temporalTightness * support,
    kindAgreement: kindAgreement * support,
    ancestorBreadth: ancestorBreadth * support,
    severityWeight: worstSeverity,
    anomalyCorroboration,
    volume,
  };
}

export interface SituationScore {
  /** Posterior probability that the grouping is a real single fault, in (0, 1). */
  confidence: number;
  /** Uncalibrated weighted sum of features, kept for inspection and for learning. */
  rawLogit: number;
  severity: 'critical' | 'major' | 'minor' | 'info';
  contributions: Array<{ feature: keyof SituationFeatures; value: number; weight: number; contribution: number }>;
}

/**
 * Score a situation. Severity blends the posterior with the operational blast radius,
 * so a high-confidence but narrow situation stays `minor` while a wide one escalates.
 */
export function scoreSituation(
  features: SituationFeatures,
  weights: CorrelationWeights,
): SituationScore {
  const contributions = FEATURE_KEYS.map((feature) => {
    const value = features[feature];
    const weight = weights[feature] ?? 0;
    return { feature, value, weight, contribution: value * weight };
  });

  const rawLogit = contributions.reduce((acc, c) => acc + c.contribution, 0);
  const confidence = sigmoid(rawLogit);

  const blastRadius = features.affectedRatio;
  let severity: SituationScore['severity'];
  if (confidence >= 0.8 && blastRadius >= 0.5) severity = 'critical';
  else if (confidence >= 0.7 || blastRadius >= 0.4) severity = 'major';
  else if (confidence >= 0.5) severity = 'minor';
  else severity = 'info';

  return { confidence, rawLogit, severity, contributions };
}

/** Perceptron learning rate, deliberately small: one operator action is weak evidence. */
const LEARNING_RATE = 0.01;

/**
 * Fold one labelled outcome into the weights and return a new vector.
 *
 * Standard perceptron update: w ← w + η·(y − p)·x, with y ∈ {0, 1}. Because the error
 * term is the residual (y − p), a confident mistake is corrected hard and a correct
 * confident prediction barely moves. Weights are clamped to (−1, 1) so a long-running
 * installation cannot let one feature run away and dominate the classifier.
 */
export function updateWeights(
  weights: CorrelationWeights,
  features: SituationFeatures,
  confirmed: boolean,
): CorrelationWeights {
  const y = confirmed ? 1 : 0;
  const p = sigmoid(FEATURE_KEYS.reduce((acc, k) => acc + (weights[k] ?? 0) * features[k], 0));
  const error = y - p;

  const next = { ...weights };
  for (const key of FEATURE_KEYS) {
    const delta = LEARNING_RATE * error * features[key];
    next[key] = Math.min(1, Math.max(-1, (weights[key] ?? 0) + delta));
  }
  return next;
}
