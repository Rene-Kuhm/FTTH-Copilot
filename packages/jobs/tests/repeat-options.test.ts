import { describe, expect, it } from 'vitest';
import { toRepeatOptions } from '../src/queue';

describe('toRepeatOptions', () => {
  it('carries the period of the loop', () => {
    expect(toRepeatOptions({ everyMs: 900_000 })).toEqual({ every: 900_000 });
  });

  it('omits the start date when there is none', () => {
    expect('startDate' in toRepeatOptions({ everyMs: 60_000 })).toBe(false);
  });

  it('carries the start date as epoch milliseconds', () => {
    // The unit matters: BullMQ reads the value with `tonumber`, so a `Date`
    // (which serializes to a string) would be ignored and the first tick
    // would fire immediately instead of at the requested instant.
    const startDateMs = 1_760_000_000_000;
    expect(toRepeatOptions({ everyMs: 60_000, startDateMs })).toEqual({
      every: 60_000,
      startDate: startDateMs,
    });
    expect(typeof toRepeatOptions({ everyMs: 60_000, startDateMs }).startDate).toBe('number');
  });
});
