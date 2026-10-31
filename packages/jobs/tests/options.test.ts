import { describe, expect, it } from 'vitest';
import { toJobsOptions } from '../src/options';

describe('toJobsOptions', () => {
  it('forwards only the options that were provided', () => {
    expect(toJobsOptions()).toEqual({});
    expect(toJobsOptions({ jobId: 'abc' })).toEqual({ jobId: 'abc' });
  });

  it('maps the delay to the option BullMQ understands', () => {
    expect(toJobsOptions({ delayMs: 500 })).toEqual({ delay: 500 });
  });

  it('forwards the retry policy', () => {
    const options = toJobsOptions({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
    expect(options.attempts).toBe(3);
    expect(options.backoff).toEqual({ type: 'exponential', delay: 1000 });
  });

  it('forwards the retention policy', () => {
    const options = toJobsOptions({ removeOnComplete: 10, removeOnFail: false });
    expect(options.removeOnComplete).toBe(10);
    expect(options.removeOnFail).toBe(false);
  });
});
