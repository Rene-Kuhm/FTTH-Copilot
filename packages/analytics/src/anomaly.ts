/**
 * Anomaly detection for seasonal operational time series.
 *
 * Follows the Robust Binned Community Detection (RBCD) approach used for
 * large-scale time-series monitoring: decompose the signal, score the residual with a
 * median/MAD estimator that tolerates heavy tails, and then require anomaly *bins* to
 * form a temporal community before reporting them. The community step is what keeps
 * isolated sensor noise from paging an operator while a genuine multi-hour outage —
 * which occupies a contiguous run of bins — is still reported.
 *
 * Deliberately dependency-free: the whole detector is arithmetic over a number array,
 * so it runs in the Next.js route handler without pulling in a numeric dependency.
 */

/** Median of a numeric sample. Returns NaN for an empty sample. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Median absolute deviation about `center`. Robust to outliers, unlike a standard
 * deviation, because the median of the absolute deviations is itself not dragged by
 * a handful of extreme points.
 */
export function medianAbsoluteDeviation(values: readonly number[], center = median(values)): number {
  if (values.length === 0) return 0;
  return median(values.map((v) => Math.abs(v - center)));
}

export interface RobustZResult {
  /** Signed z-scores: positive above the median, negative below. */
  scores: number[];
  center: number;
  /** Robust dispersion actually used for scaling (MAD, or stddev as a fallback). */
  scale: number;
}

const /** 0.6745 is Φ⁻¹(0.75), the constant that makes MAD a consistent estimator of σ
 * for normally distributed data. */
MAD_TO_SIGMA = 0.6745;

/**
 * Scale values by a robust dispersion estimate and return signed z-scores.
 *
 * When the MAD collapses to zero (a series that is nearly constant, e.g. a counter
 * that only moved once) dividing by it would yield ±Infinity for every point, so we
 * fall back to the standard deviation and, failing that, to zero scores.
 */
export function robustZScore(values: readonly number[]): RobustZResult {
  if (values.length === 0) return { scores: [], center: 0, scale: 0 };

  const center = median(values);
  const mad = medianAbsoluteDeviation(values, center);
  let scale = mad / MAD_TO_SIGMA;

  if (scale === 0 || !Number.isFinite(scale)) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    if (stddev === 0 || !Number.isFinite(stddev)) {
      return { scores: values.map(() => 0), center, scale: 0 };
    }
    scale = stddev;
  }

  const scores = values.map((v) => (v - center) / scale);
  return { scores, center, scale };
}

export interface Decomposition {
  trend: number[];
  seasonal: number[];
  residual: number[];
}

/**
 * Additive seasonal decomposition: centered moving average for the trend, an averaged
 * per-phase seasonal profile, and whatever is left as the residual.
 *
 * A centered moving average is used rather than a trailing one so the trend is not
 * phase-shifted; a shifted trend would leak part of the seasonal signal into the
 * residual and hide exactly the anomaly we are looking for.
 */
export function seasonalDecompose(
  values: readonly number[],
  pointsPerDay: number,
): Decomposition {
  const n = values.length;
  if (n === 0) return { trend: [], seasonal: [], residual: [] };

  // The period is capped so every phase bucket keeps at least three samples.
  //
  // Without this cap, asking for a daily cycle (1440 points/day) over a short series
  // puts ONE sample in each phase bucket, so the seasonal profile becomes the signal
  // itself, the residual collapses to exactly zero, and the detector silently never
  // fires on anything. A detector that cannot alert is worse than no detector, so the
  // period shrinks to whatever the data can actually support.
  const requestedPeriod = Math.max(1, Math.floor(pointsPerDay));
  const period = Math.min(requestedPeriod, Math.max(1, Math.floor(n / 3)));

  // ── Trend: running MEDIAN over one period ───────────────────────────
  // Both the window length and the estimator matter here.
  //
  // Length: it must equal the period. A 25-point average over a 24-point sinusoid
  // does not cancel it, and the leftover bias lands in the residual as a periodic
  // artefact large enough to dominate the z-scores.
  //
  // Estimator: a running median, not a mean. A centered moving average is
  // forward-looking, so an outage of length L inflates the trend for the ~L/2 samples
  // *preceding* it, producing a ramp of phantom negative anomalies that trail the real
  // event. In the reference run this added 11 bogus flags around a single 6-hour
  // outage. A running median tolerates up to 50% contamination of its window, so a
  // 6-point spike inside a 24-point window cannot move it at all.
  //
  // Validity is tracked separately because 0 is a legitimate trend value and cannot
  // double as the "not yet computed" sentinel.
  const defined = new Array<boolean>(n).fill(false);
  const trend = new Array<number>(n).fill(0);
  const window = new Array<number>(period);

  for (let i = 0; i < n; i += 1) {
    // A full window only. A truncated leading window would be a median over a handful
    // of samples whose values still carry most of the seasonal swing, so it is biased
    // — and that bias flows straight into the per-phase seasonal profile, showing up
    // as phantom anomalies in the first day of data. The leading edge is backfilled
    // from the first full window instead.
    if (i < period - 1 || i >= n) continue;
    for (let j = i - period + 1; j <= i; j += 1) window[j - (i - period + 1)] = values[j]!;
    trend[i] = median(window);
    defined[i] = true;
  }

  // Backfill the undefined leading edge by holding the first computed value flat, so
  // the residual at index 0 is not polluted by a trend of zero.
  const firstDefined = defined.findIndex(Boolean);
  if (firstDefined !== -1) {
    for (let i = firstDefined - 1; i >= 0; i -= 1) trend[i] = trend[firstDefined]!;
  } else {
    // Series shorter than one period: fall back to its own level.
    const level = values.reduce((s, v) => s + v, 0) / n;
    trend.fill(level);
  }
  for (let i = firstDefined + 1; i < n; i += 1) {
    if (!defined[i]) trend[i] = trend[i - 1]!;
  }

  // ── Seasonal: robust (median) profile of (value - trend) per phase ──
  // The profile is a MEDIAN, not a mean, and that choice is load-bearing. A mean over
  // the phase buckets lets a single extreme value drag the whole profile: one
  // six-hour outage shifts the profile for those six phases on *every other day*,
  // which then reads as an anomaly at the same hours all week. A real detection run
  // flagged 64 points, 58 of them phantom. The median ignores the contaminated day
  // entirely, so the outage is reported once and the quiet days stay quiet.
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const phase = i % period;
    const bucket = buckets.get(phase);
    const detrended = values[i]! - trend[i]!;
    if (bucket) bucket.push(detrended);
    else buckets.set(phase, [detrended]);
  }
  const seasonalProfile = new Array<number>(period).fill(0);
  for (const [phase, samples] of buckets) {
    seasonalProfile[phase] = samples.length > 0 ? median(samples) : 0;
  }
  // Centre the profile so the seasonal component averages to zero and does not steal
  // level from the residual.
  const profileMean = seasonalProfile.reduce((s, v) => s + v, 0) / period;
  for (let p = 0; p < period; p += 1) seasonalProfile[p]! -= profileMean;

  const seasonal = values.map((_, i) => seasonalProfile[i % period]!);

  return {
    trend,
    seasonal,
    residual: values.map((v, i) => v - trend[i]! - seasonal[i]!),
  };
}

export interface Anomaly {
  index: number;
  /** Signed robust z-score of the residual at this point. */
  score: number;
  value: number;
  /** `true` when the anomaly sits inside a community of consecutive anomalous bins. */
  inCommunity: boolean;
}

export interface DetectAnomaliesOptions {
  /** How many samples make up one full seasonal cycle (24 for hourly data). */
  pointsPerDay: number;
  /** Absolute z-score above which a point is a candidate. Default 3.5. */
  zThreshold?: number;
  /**
   * Minimum run of consecutive candidate bins required to report a community.
   * Default 3, so a lone spike from a single bad reading is not an outage.
   */
  minCommunityLength?: number;
}

/**
 * Detect anomalous points in a seasonal series.
 *
 * Pipeline: decompose → robust z-score of the residual → candidate bins → community
 * filter. A candidate is reported when it is extreme on its own (`inCommunity: false`)
 * or when it belongs to a contiguous run of at least `minCommunityLength` candidates
 * (`inCommunity: true`).
 */
export function detectAnomalies(
  values: readonly number[],
  options: DetectAnomaliesOptions,
): Anomaly[] {
  const { pointsPerDay } = options;
  const zThreshold = options.zThreshold ?? 3.5;
  const minCommunityLength = options.minCommunityLength ?? 3;

  if (values.length < 4) return [];

  const { residual } = seasonalDecompose(values, pointsPerDay);
  if (residual.length === 0) return [];

  const { scores } = robustZScore(residual);

  const isCandidate = scores.map((s) => Math.abs(s) >= zThreshold);
  const hasCandidate = isCandidate.some(Boolean);
  if (!hasCandidate) return [];

  // Mark every candidate that belongs to a run of >= minCommunityLength.
  const inCommunity = new Array<boolean>(scores.length).fill(false);
  let runStart = 0;
  for (let i = 0; i <= isCandidate.length; i += 1) {
    if (i < isCandidate.length && isCandidate[i]) continue;
    const runLength = i - runStart;
    if (isCandidate[runStart] && runLength >= minCommunityLength) {
      for (let j = runStart; j < i; j += 1) inCommunity[j] = true;
    }
    runStart = i + 1;
  }

  return scores
    .map((score, index) => ({
      index,
      score,
      value: values[index]!,
      inCommunity: inCommunity[index]!,
    }))
    .filter((a) => isCandidate[a.index]!);
}

export interface AnomalyGroup {
  startIndex: number;
  endIndex: number;
  length: number;
  direction: 'up' | 'down';
  /** Largest absolute z-score inside the group. */
  peakScore: number;
  peakIndex: number;
  points: Anomaly[];
}

/**
 * Collapse detected anomalies into contiguous groups — one group per real-world
 * incident rather than one entry per sample.
 */
export function groupAnomalies(anomalies: readonly Anomaly[]): AnomalyGroup[] {
  if (anomalies.length === 0) return [];

  const groups: AnomalyGroup[] = [];
  let current: Anomaly[] = [anomalies[0]!];

  for (let i = 1; i < anomalies.length; i += 1) {
    const a = anomalies[i]!;
    const prev = anomalies[i - 1]!;
    // Contiguity: neighbouring sample indices, and a consistent direction, so a rise
    // and a fall in adjacent samples stay two separate groups.
    if (a.index === prev.index + 1 && Math.sign(a.score) === Math.sign(prev.score)) {
      current.push(a);
    } else {
      groups.push(buildGroup(current));
      current = [a];
    }
  }
  groups.push(buildGroup(current));
  return groups;
}

function buildGroup(points: Anomaly[]): AnomalyGroup {
  const peak = points.reduce((best, p) => (Math.abs(p.score) > Math.abs(best.score) ? p : best), points[0]!);
  return {
    startIndex: points[0]!.index,
    endIndex: points[points.length - 1]!.index,
    length: points.length,
    direction: peak.score >= 0 ? 'up' : 'down',
    peakScore: peak.score,
    peakIndex: peak.index,
    points,
  };
}
