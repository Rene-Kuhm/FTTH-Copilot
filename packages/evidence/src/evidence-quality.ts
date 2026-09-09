/**
 * Evidence quality — pure functions for telemetry freshness, coverage
 * and counter sanity (Roadmap Fase 2, 2.1 + 2.2 + 2.3 + 2.4).
 *
 * Design decisions follow the roadmap rules:
 *
 * 1. **Per-source cadence/TTL is configuration, not magic.** The
 *    default policy table documents each source's expected cadence,
 *    TTL, gap tolerance and minimum sample count. Environments
 *    calibrate these values; nothing here hard-codes universal
 *    thresholds.
 *
 * 2. **A gap is not a value.** A prolonged hole inside the window must
 *    be treated as *unknown* (2.3), even when samples exist at both
 *    ends, because a silent collector gives no evidence either way.
 *
 * 3. **Device state ≠ collector state (2.4).** The quality verdict is
 *    about the *evidence stream*, not the device. A collector failure
 *    never proves an ONU is offline; callers must not fabricate
 *    device-down assertions from missing samples.
 *
 * 4. **Counter resets are observations.** UPTIME_SECONDS / FEC counts
 *    that jump backwards are flagged, not silently clamped, so the
 *    investigation can distinguish a reboot from a collection error.
 *
 * Every function is pure: given the same samples and the same
 * synthetic clock, the result is deterministic (required by the
 * roadmap's TDD/verification discipline).
 */

import type { Verdict } from './types';

// ── Source policy (2.1) ───────────────────────────────────────────────────────
//
// `SourcePolicy` describes the *expected* telemetry contract for one
// metric family/source. The values are documentation-first defaults;
// production environments calibrate them (roadmap 2.1: "los umbrales
// son configuración documentada y requieren calibración por entorno").

export type QualityLevel = 'fresh' | 'stale' | 'insufficient' | 'unknown' | 'error';

export interface SourcePolicy {
  /** Stable source/metric-family identifier, e.g. 'smartolt.poll' or 'fec'. */
  readonly source: string;
  /** Expected sampling cadence, in milliseconds. */
  readonly expectedCadenceMs: number;
  /** How long a single sample stays *fresh* before it is *stale*. */
  readonly ttlMs: number;
  /**
   * Maximum tolerated gap between consecutive samples (ms). A longer
   * gap inside the window marks the covered span *unknown* even when
   * samples exist at both ends (2.3).
   */
  readonly maxGapMs: number;
  /** Minimum number of samples required to call the window *covered*. */
  readonly minSamples: number;
}

/** Built-in default policy for the known metric families (2.1). */
export const DEFAULT_SOURCE_POLICIES: readonly SourcePolicy[] = [
  {
    source: 'smartolt.poll',
    expectedCadenceMs: 60_000,
    ttlMs: 300_000, // 5 min
    maxGapMs: 180_000, // 3 min
    minSamples: 3,
  },
  {
    source: 'fec',
    expectedCadenceMs: 60_000,
    ttlMs: 300_000,
    maxGapMs: 180_000,
    minSamples: 3,
  },
  {
    source: 'syslog',
    expectedCadenceMs: 0, // event-driven, no cadence
    ttlMs: 0, // events are permanent until retention
    maxGapMs: 0, // gaps are normal for event streams
    minSamples: 0,
  },
] as const;

// ── Sample shape ──────────────────────────────────────────────────────────────
//
// `QualitySample` is the minimal view of a telemetry row the quality
// functions need. Consumers map their own rows (MetricSample,
// DeviceEvent, poll envelope) onto this shape; the functions stay
// DB-agnostic and pure.

export interface QualitySample {
  /** Sample timestamp, ms epoch (or ISO string convertible by Date). */
  readonly sampledAt: number | string | Date;
  /** Numeric value, when the metric is numeric (RX/TX power, uptime…). */
  readonly value?: number | null;
  /** Text value, when the metric is categorical (STATUS: online/offline…). */
  readonly valueText?: string | null;
  /** Source identifier, matched against `SourcePolicy.source`. */
  readonly source?: string;
}

export type QualityReason =
  | 'fresh'
  | 'stale'
  | 'stale-no-sample'
  | 'insufficient-samples'
  | 'unknown-gap'
  | 'future-sample'
  | 'out-of-order'
  | 'counter-reset'
  | 'recovered'
  | 'collector-failure';

export interface QualityResult {
  readonly level: QualityLevel;
  readonly reason: QualityReason;
  /** Age of the newest sample in ms, when there is at least one. */
  readonly newestAgeMs: number | null;
  /** Number of samples in the given window. */
  readonly sampleCount: number;
  /** True when a threshold from `SourcePolicy` was exceeded. */
  readonly policyApplied: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function toMs(value: number | string | Date): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`EvidenceQuality: invalid timestamp ${String(value)}`);
  }
  return parsed;
}

export interface QualityWindow {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Evaluate the freshness/coverage of a sample series against a
 * source policy, using a synthetic clock `nowMs` (2.2 + 2.3 + 2.4).
 *
 * Order of evaluation (first match wins):
 * 1. future sample → `error`
 * 2. no samples → `unknown` (collector may be down; never device-down)
 * 3. newest older than TTL → `stale`
 * 4. a gap longer than `maxGapMs` anywhere in the series → `unknown`
 *    (2.3): even when the window itself is sparse, the existence of
 *    a prolonged hole inside the series is a stronger signal than
 *    the per-window sample count.
 * 5. fewer than `minSamples` inside the configured window →
 *    `insufficient`
 * 6. otherwise → `fresh` (or `recovered` when out-of-order arrivals
 *    are detected — see 2.2's "fuera de orden" requirement).
 *
 * The function never inspects device state and never fabricates
 * device assertions (2.4). It only reports on the evidence stream.
 */
export function assessFreshness(
  samples: readonly QualitySample[],
  policy: SourcePolicy,
  nowMs: number,
): QualityResult {
  // Reject future samples (reloj controlado in the required test list).
  for (const s of samples) {
    const t = toMs(s.sampledAt);
    if (t > nowMs + 60_000) {
      return {
        level: 'error',
        reason: 'future-sample',
        newestAgeMs: null,
        sampleCount: samples.length,
        policyApplied: true,
      };
    }
  }

  if (samples.length === 0) {
    return {
      level: 'unknown',
      reason: 'stale-no-sample',
      newestAgeMs: null,
      sampleCount: 0,
      policyApplied: true,
    };
  }

  const sorted = [...samples]
    .map((s) => ({ t: toMs(s.sampledAt), s }))
    .sort((a, b) => a.t - b.t);

  const newest = sorted[sorted.length - 1]!;
  const newestAgeMs = Math.max(0, nowMs - newest.t);

  if (newestAgeMs > policy.ttlMs) {
    return {
      level: 'stale',
      reason: 'stale',
      newestAgeMs,
      sampleCount: samples.length,
      policyApplied: true,
    };
  }

  // Gap check (2.3): a hole longer than maxGapMs ANYWHERE in the
  // series makes the covered span unknown even with samples at both
  // ends. This check happens BEFORE the minSamples check because a
  // prolonged hole is a stronger signal than per-window sparseness.
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i]!.t - sorted[i - 1]!.t;
    if (gap > policy.maxGapMs) {
      return {
        level: 'unknown',
        reason: 'unknown-gap',
        newestAgeMs,
        sampleCount: samples.length,
        policyApplied: true,
      };
    }
  }

  const window: QualityWindow = { startMs: nowMs - policy.ttlMs, endMs: nowMs };
  const inWindow = sorted.filter((x) => x.t >= window.startMs && x.t <= window.endMs);
  if (inWindow.length < policy.minSamples) {
    return {
      level: 'insufficient',
      reason: 'insufficient-samples',
      newestAgeMs,
      sampleCount: samples.length,
      policyApplied: true,
    };
  }

  // Out-of-order detection: compare the chronological ordering to
  // the input ordering; if the series arrived out of chronological
  // sequence (collector jitter or batched replay), report `recovered`
  // instead of `fresh` so the agent knows the evidence was reassembled.
  // The series is sorted above for evaluation; we still need the
  // arrival order to detect the jitter.
  if (samples.length >= 2) {
    let arrivalOutOfOrder = false;
    for (let i = 1; i < samples.length; i += 1) {
      if (toMs(samples[i]!.sampledAt) < toMs(samples[i - 1]!.sampledAt)) {
        arrivalOutOfOrder = true;
        break;
      }
    }
    if (arrivalOutOfOrder) {
      return {
        level: 'fresh',
        reason: 'recovered',
        newestAgeMs,
        sampleCount: samples.length,
        policyApplied: true,
      };
    }
  }

  return {
    level: 'fresh',
    reason: 'fresh',
    newestAgeMs,
    sampleCount: samples.length,
    policyApplied: true,
  };
}

/**
 * Detect a counter reset (e.g. UPTIME_SECONDS dropping, FEC counters
 * going backwards) in a numeric series. Returns the index of the
 * first reset, or null. Pure and deterministic (2.2).
 */
export function detectCounterReset(
  samples: readonly QualitySample[],
): number | null {
  let prev: number | null = null;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!.value;
    if (v === null || v === undefined) continue;
    if (prev !== null && v < prev) return i;
    prev = v;
  }
  return null;
}

/**
 * True when a sample is missing a value in a family that requires
 * one (a numeric metric with neither `value` nor `valueText`, or a
 * categorical metric with no `valueText`). Used for "valores ausentes"
 * coverage (2.2).
 */
export function isMissingValue(
  sample: QualitySample,
  numeric: boolean,
): boolean {
  if (numeric) {
    return sample.value === null || sample.value === undefined;
  }
  return sample.valueText === null || sample.valueText === undefined;
}

// ── Bridge to TruthGate (2.5, compatible extension) ──────────────────────────
//
// The existing TruthGate (`classifyEnvelope`) emits Verdicts with
// `code: 'ok' | 'low_confidence' | 'stale' | 'incomplete'`. This
// bridge maps a `QualityResult` onto the SAME Verdict shape so the
// agent's existing verdict accumulation path can carry quality
// signals without schema changes.

const LEVEL_TO_VERDICT: Record<QualityLevel, Verdict['code']> = {
  fresh: 'ok',
  stale: 'stale',
  insufficient: 'incomplete',
  unknown: 'incomplete',
  error: 'incomplete',
};

const LEVEL_TO_SEVERITY: Record<QualityLevel, Verdict['severity']> = {
  fresh: 'ok',
  stale: 'warning',
  insufficient: 'warning',
  unknown: 'critical',
  error: 'critical',
};

export interface QualityVerdictArgs {
  readonly toolName: string;
  readonly result: QualityResult;
}

/** Convert a QualityResult to the TruthGate Verdict shape (2.5). */
export function toQualityVerdict(args: QualityVerdictArgs): Verdict {
  return {
    toolName: args.toolName,
    code: LEVEL_TO_VERDICT[args.result.level],
    reason: args.result.reason,
    severity: LEVEL_TO_SEVERITY[args.result.level],
  };
}

/** Re-export the Verdict type for convenience. */
export type { Verdict };