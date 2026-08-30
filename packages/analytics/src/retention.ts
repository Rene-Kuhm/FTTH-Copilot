import { deleteSamplesBefore } from './ingest';

export interface RetentionOptions {
  retentionDays: number;
  now?: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Purges metric samples older than `retentionDays` relative to `now`.
 * Bounds the growth of the time-series table so the early-warning detectors
 * keep working on a bounded, recent window of data.
 */
export async function runRetention(opts: RetentionOptions): Promise<{ deleted: number }> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - opts.retentionDays * MS_PER_DAY);
  return deleteSamplesBefore(cutoff);
}
