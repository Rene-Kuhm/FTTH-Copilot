import { describe, it, expect } from 'vitest';
import {
  detectBruteForce,
  detectAccessAfterFailures,
  detectConfigChange,
} from '../src/detectors';
import type { SecurityEvent } from '../src/types';

const NOW = 1_752_000_000_000;
const MIN = 60 * 1000;

function ev(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    t: NOW,
    category: 'other',
    sourceIp: '1.2.3.4',
    message: '',
    ...overrides,
  };
}

describe('detectBruteForce', () => {
  it('flags a source with enough auth failures in the window', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ category: 'auth_failure', t: NOW - i * MIN }),
    );
    const findings = detectBruteForce(events, { now: NOW, windowMs: 10 * MIN, minFailures: 5 });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('brute_force');
    expect(findings[0]!.severity).toBe('critical');
    expect(findings[0]!.sourceIp).toBe('1.2.3.4');
  });

  it('does not flag below the threshold', () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      ev({ category: 'auth_failure', t: NOW - i * MIN }),
    );
    expect(detectBruteForce(events, { now: NOW, minFailures: 5 })).toEqual([]);
  });

  it('ignores failures outside the window', () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      ev({ category: 'auth_failure', t: NOW - 60 * MIN - i * MIN }),
    );
    expect(detectBruteForce(events, { now: NOW, windowMs: 10 * MIN, minFailures: 5 })).toEqual([]);
  });

  it('counts sources independently', () => {
    const events = [
      ...Array.from({ length: 5 }, (_, i) => ev({ category: 'auth_failure', sourceIp: '1.1.1.1', t: NOW - i * MIN })),
      ...Array.from({ length: 2 }, (_, i) => ev({ category: 'auth_failure', sourceIp: '2.2.2.2', t: NOW - i * MIN })),
    ];
    const findings = detectBruteForce(events, { now: NOW, minFailures: 5 });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.sourceIp).toBe('1.1.1.1');
  });
});

describe('detectAccessAfterFailures', () => {
  it('flags access following repeated failures', () => {
    const events = [
      ev({ category: 'auth_failure', t: NOW - 3 * MIN }),
      ev({ category: 'auth_failure', t: NOW - 2 * MIN }),
      ev({ category: 'auth_failure', t: NOW - 1 * MIN }),
      ev({ category: 'access', t: NOW }),
    ];
    const findings = detectAccessAfterFailures(events, { now: NOW, minFailures: 3 });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('access_after_failures');
    expect(findings[0]!.severity).toBe('warning');
  });

  it('does not flag access without prior failures', () => {
    const events = [ev({ category: 'access', t: NOW })];
    expect(detectAccessAfterFailures(events, { now: NOW, minFailures: 3 })).toEqual([]);
  });

  it('does not count failures outside the window', () => {
    const events = [
      ev({ category: 'auth_failure', t: NOW - 60 * MIN }),
      ev({ category: 'access', t: NOW }),
    ];
    expect(detectAccessAfterFailures(events, { now: NOW, windowMs: 10 * MIN, minFailures: 1 })).toEqual([]);
  });

  it('flags access that shares a timestamp with prior failures (same-second syslog)', () => {
    // Syslog resolution is per-second; 3 failures and the access all land at NOW.
    // Before the fix, the detector used strict `e.t < event.t` and missed this case.
    const T = NOW;
    const events = [
      ev({ category: 'auth_failure', t: T, sourceIp: '9.9.9.9', message: 'Failed password for root from 9.9.9.9' }),
      ev({ category: 'auth_failure', t: T, sourceIp: '9.9.9.9', message: 'Failed password for admin from 9.9.9.9' }),
      ev({ category: 'auth_failure', t: T, sourceIp: '9.9.9.9', message: 'Failed password for test from 9.9.9.9' }),
      ev({ category: 'access', t: T, sourceIp: '9.9.9.9', message: 'Accepted publickey for root from 9.9.9.9' }),
    ];
    const findings = detectAccessAfterFailures(events, { now: T, windowMs: 5 * MIN, minFailures: 3 });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('access_after_failures');
    expect(findings[0]!.sourceIp).toBe('9.9.9.9');
  });
});

describe('detectConfigChange', () => {
  it('flags config changes', () => {
    const events = [ev({ category: 'config_change', message: 'commit confirmed' })];
    const findings = detectConfigChange(events, { now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe('config_change');
    expect(findings[0]!.severity).toBe('warning');
  });

  it('ignores non-config events', () => {
    const events = [ev({ category: 'access' }), ev({ category: 'auth_failure' })];
    expect(detectConfigChange(events, { now: NOW })).toEqual([]);
  });
});
