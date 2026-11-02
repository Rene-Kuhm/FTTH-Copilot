import { describe, expect, it } from 'vitest';
import { readJobOutcome } from '../src/job-outcome';

/**
 * BullMQ decides on its own whether a failed job is retried. The worker only
 * observes the outcome, and these two questions are what the operator asks:
 * "how long did it take" and "was it retried".
 *
 * The shape of the job is the part of BullMQ the worker depends on, so it is
 * spelled out here instead of importing BullMQ's types: a test can then
 * assert the decisions without a Redis instance.
 */

describe('job outcome', () => {
  it('measures the time the job spent in the handler', () => {
    const outcome = readJobOutcome({ processedOn: 1_000, finishedOn: 3_500 });

    expect(outcome.durationSeconds).toBeCloseTo(2.5, 6);
  });

  it('cannot measure a job that never started', () => {
    const outcome = readJobOutcome({ processedOn: undefined, finishedOn: 3_500 });

    expect(outcome.durationSeconds).toBeNull();
  });

  it('ignores a duration that came out negative', () => {
    const outcome = readJobOutcome({ processedOn: 3_500, finishedOn: 1_000 });

    expect(outcome.durationSeconds).toBeNull();
  });

  it('says a job with no attempts left is not retried', () => {
    const outcome = readJobOutcome({ processedOn: 1, finishedOn: 2 }, { attemptsMade: 3, attempts: 3 });

    expect(outcome.willRetry).toBe(false);
  });

  it('says a job with attempts left is retried', () => {
    const outcome = readJobOutcome({ processedOn: 1, finishedOn: 2 }, { attemptsMade: 1, attempts: 3 });

    expect(outcome.willRetry).toBe(true);
  });

  it('treats a job without attempts configured as not retried', () => {
    const outcome = readJobOutcome({ processedOn: 1, finishedOn: 2 }, { attemptsMade: 1 });

    expect(outcome.willRetry).toBe(false);
  });

  it('does not retry a job that failed unrecoverably', () => {
    const outcome = readJobOutcome(
      { processedOn: 1, finishedOn: 2 },
      { attemptsMade: 1, attempts: 3, errorName: 'UnrecoverableError' },
    );

    expect(outcome.willRetry).toBe(false);
  });

  it('does not retry a successful job', () => {
    const outcome = readJobOutcome({ processedOn: 1, finishedOn: 2 });

    expect(outcome.willRetry).toBe(false);
  });
});
