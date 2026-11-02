import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JOB_DURATION_BUCKETS_SECONDS,
  createLatencyHistogram,
} from '../src/job-latency';

/**
 * BullMQ 6 no expone la latencia de los jobs que ejecutó, así que el worker
 * la mide. El acumulador es la pieza que decide si esa medición sirve: un
 * histograma mal armado (buckets no acumulativos, suma que no cuadra) hace
 * que el p95 que ve el operador sea mentira.
 */

describe('job latency histogram', () => {
  it('starts empty', () => {
    const histogram = createLatencyHistogram();

    expect(histogram.snapshot().size).toBe(0);
  });

  it('counts the observations and sums their duration', () => {
    const histogram = createLatencyHistogram();
    histogram.record('ftth-poll', 0.2);
    histogram.record('ftth-poll', 1.4);

    const latency = histogram.snapshot().get('ftth-poll');
    expect(latency?.count).toBe(2);
    expect(latency?.sum).toBeCloseTo(1.6, 6);
  });

  it('accumulates the buckets', () => {
    const histogram = createLatencyHistogram([0.1, 1, 10]);
    histogram.record('ftth-poll', 0.05);
    histogram.record('ftth-poll', 0.5);
    histogram.record('ftth-poll', 5);

    const latency = histogram.snapshot().get('ftth-poll');
    // A bucket counts the observations that are <= its boundary, and the
    // buckets are cumulative: 0.05 falls in the first one, 0.5 in the
    // second, and the 5 second job only in the third.
    expect(latency?.buckets).toEqual([1, 2, 3]);
  });

  it('keeps the buckets of every queue apart', () => {
    const histogram = createLatencyHistogram([1, 10]);
    histogram.record('ftth-poll', 0.5);
    histogram.record('ftth-ingest', 5);

    const snapshot = histogram.snapshot();
    expect(snapshot.get('ftth-poll')?.count).toBe(1);
    expect(snapshot.get('ftth-ingest')?.count).toBe(1);
    expect(snapshot.get('ftth-ingest')?.buckets).toEqual([0, 1]);
  });

  it('ignores a duration that is not a number', () => {
    const histogram = createLatencyHistogram();
    histogram.record('ftth-poll', Number.NaN);
    histogram.record('ftth-poll', -1);

    expect(histogram.snapshot().size).toBe(0);
  });

  it('leaves a job longer than the last bucket out of the finite buckets', () => {
    const histogram = createLatencyHistogram([1, 10]);
    histogram.record('ftth-poll', 900);

    const latency = histogram.snapshot().get('ftth-poll');
    // Prometheus semantics: a bucket with boundary `le` counts the jobs
    // that took at most `le`. A job slower than the last boundary belongs to
    // the implicit `+Inf` bucket, which carries the whole count.
    expect(latency?.buckets).toEqual([0, 0]);
    expect(latency?.count).toBe(1);
    expect(latency?.sum).toBe(900);
  });

  it('defaults to buckets that cover the jobs of a network poll', () => {
    expect(DEFAULT_JOB_DURATION_BUCKETS_SECONDS).toContain(0.5);
    expect(DEFAULT_JOB_DURATION_BUCKETS_SECONDS).toContain(60);
    expect(DEFAULT_JOB_DURATION_BUCKETS_SECONDS).toContain(300);
  });
});
