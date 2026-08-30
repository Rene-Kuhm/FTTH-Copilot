import { describe, expect, it } from 'vitest';
import {
  createRateWindowCounter,
  truncateSyslogMessage,
} from '../src/syslog-guard';

describe('truncateSyslogMessage', () => {
  it('leaves short messages untouched', () => {
    expect(truncateSyslogMessage('hola', 10)).toBe('hola');
  });

  it('truncates long messages to the cap', () => {
    expect(truncateSyslogMessage('a'.repeat(100), 10)).toBe('a'.repeat(10));
  });

  it('defaults to a sane cap', () => {
    const long = 'x'.repeat(10_000);
    expect(truncateSyslogMessage(long).length).toBe(2000);
  });
});

describe('createRateWindowCounter', () => {
  it('allows events up to the budget within a window', () => {
    const counter = createRateWindowCounter({ maxEvents: 3, windowMs: 1000 });
    expect(counter.allow(0)).toBe(true);
    expect(counter.allow(1)).toBe(true);
    expect(counter.allow(2)).toBe(true);
    expect(counter.allow(3)).toBe(false);
    expect(counter.allow(4)).toBe(false);
  });

  it('resets the budget when the window rolls over', () => {
    const counter = createRateWindowCounter({ maxEvents: 2, windowMs: 1000 });
    expect(counter.allow(0)).toBe(true);
    expect(counter.allow(1)).toBe(true);
    expect(counter.allow(2)).toBe(false);
    // New window starts at 1000.
    expect(counter.allow(1000)).toBe(true);
    expect(counter.allow(1001)).toBe(true);
    expect(counter.allow(1002)).toBe(false);
  });
});
