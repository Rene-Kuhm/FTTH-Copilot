/**
 * Histogram of the time the jobs take.
 *
 * BullMQ 6 does not expose the latency of the jobs it ran — the v5 helper
 * `getJobLatencies` is gone — so the worker measures it itself: the BullMQ
 * job carries `processedOn` (when it went active) and `finishedOn` (when it
 * ended), and the difference is the time it spent in the handler.
 *
 * The shape is the classic Prometheus histogram: cumulative buckets plus the
 * sum and the count. VictoriaMetrics turns the buckets into a quantile, so
 * the operator can ask for the p95 of a queue without the worker keeping
 * every sample in memory.
 */

/**
 * Bucket boundaries, in seconds.
 *
 * The lower half is dense because most jobs are fast (a poll of one OLT, a
 * drain of a few events) and the tail is wide because the slow ones are the
 * interesting ones: a FEC collection over a whole plant, an investigation
 * that has to reach an LLM.
 */
export const DEFAULT_JOB_DURATION_BUCKETS_SECONDS = [
  0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300,
] as const;

/** Latency observed for one queue. */
export interface QueueLatency {
  /** Cumulative count per bucket boundary, in the order of the buckets. */
  readonly buckets: readonly number[];
  /** Sum of the observed durations, in seconds. */
  readonly sum: number;
  /** Number of observations. */
  readonly count: number;
}

/** A histogram that accumulates the duration of the jobs, per queue. */
export interface LatencyHistogram {
  /** Records one job that took `seconds`. */
  record(queue: string, seconds: number): void;
  /** The accumulated latency of every queue that ran a job. */
  snapshot(): ReadonlyMap<string, QueueLatency>;
}

/**
 * Builds a histogram.
 *
 * The buckets are used as given: a caller that wants different boundaries
 * gets a histogram with those, and the exposition follows the same order.
 */
export function createLatencyHistogram(
  buckets: readonly number[] = DEFAULT_JOB_DURATION_BUCKETS_SECONDS,
): LatencyHistogram {
  const boundaries = [...buckets].sort((a, b) => a - b);
  const state = new Map<string, { counts: number[]; sum: number; count: number }>();

  return {
    record(queue: string, seconds: number): void {
      if (!Number.isFinite(seconds) || seconds < 0) return;

      let entry = state.get(queue);
      if (!entry) {
        entry = { counts: new Array<number>(boundaries.length).fill(0), sum: 0, count: 0 };
        state.set(queue, entry);
      }

      entry.count += 1;
      entry.sum += seconds;
      // The buckets are cumulative: every boundary at or above the observed
      // duration counts this observation.
      for (let index = 0; index < boundaries.length; index += 1) {
        if (seconds <= boundaries[index]!) entry.counts[index] = (entry.counts[index] ?? 0) + 1;
      }
    },

    snapshot(): ReadonlyMap<string, QueueLatency> {
      const result = new Map<string, QueueLatency>();
      for (const [queue, entry] of state) {
        result.set(queue, {
          buckets: [...entry.counts],
          sum: entry.sum,
          count: entry.count,
        });
      }
      return result;
    },
  };
}
