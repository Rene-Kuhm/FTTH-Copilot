import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetSchedulerHealth,
  markExpected,
  markNotExpected,
  overallHealthy,
  recordError,
  recordSuccess,
  recordSyslogBound,
  snapshotHealth,
} from '../../../lib/monitoring/scheduler-health';

describe('scheduler-health registry', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('starts with an empty snapshot', () => {
    expect(snapshotHealth()).toEqual({});
  });

  it('records a service as expected', () => {
    markExpected('polling');
    expect(snapshotHealth()).toEqual({
      polling: {
        expected: true,
        lastRunAt: null,
        lastError: null,
        lastErrorAt: null,
      },
    });
  });

  it('records a service as not expected', () => {
    markNotExpected('firmware');
    expect(snapshotHealth()).toEqual({
      firmware: {
        expected: false,
        lastRunAt: null,
        lastError: null,
        lastErrorAt: null,
      },
    });
  });

  it('records a successful tick and clears the last error', () => {
    markExpected('polling');
    recordError('polling', 'first failure', 1000);
    recordSuccess('polling', 2000);
    const snap = snapshotHealth();
    expect(snap['polling']?.lastRunAt).toBe(2000);
    expect(snap['polling']?.lastError).toBeNull();
    expect(snap['polling']?.lastErrorAt).toBeNull();
  });

  it('records an error and keeps the timestamp for the operator', () => {
    markExpected('polling');
    recordError('polling', 'port busy', 1500);
    const snap = snapshotHealth();
    expect(snap['polling']?.lastError).toBe('port busy');
    expect(snap['polling']?.lastErrorAt).toBe(1500);
  });

  it('tracks syslog bind state', () => {
    markExpected('syslog');
    recordSyslogBound(true);
    expect(snapshotHealth()['syslog']?.bound).toBe(true);
    recordSyslogBound(false);
    expect(snapshotHealth()['syslog']?.bound).toBe(false);
  });
});

describe('snapshotHealth', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('regression: returns populated entries (not {}) after services register', () => {
    // The previous implementation used Object.entries(STATE) on a Map,
    // which always returned {} because Map properties are not
    // enumerable. /api/health therefore always reported
    // `services: {}` and `healthy: true`, masking every real error.
    markExpected('polling');
    recordSuccess('polling', 1_000);
    markExpected('syslog');
    recordSyslogBound(true);

    const snap = snapshotHealth();
    expect(Object.keys(snap).sort()).toEqual(['polling', 'syslog']);
    expect(snap['polling']?.expected).toBe(true);
    expect(snap['polling']?.lastRunAt).toBe(1_000);
    expect(snap['syslog']?.bound).toBe(true);
  });
});

describe('overallHealthy', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('returns true for an empty snapshot (no expected services means nothing to fail)', () => {
    expect(overallHealthy({})).toBe(true);
  });

  it('returns true when no services are expected', () => {
    markNotExpected('polling');
    expect(overallHealthy(snapshotHealth())).toBe(true);
  });

  it('returns false when an expected service has never run', () => {
    markExpected('polling');
    // No recordSuccess call → lastRunAt stays null.
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns true once the expected service has run successfully', () => {
    markExpected('polling');
    recordSuccess('polling', 5_000);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(true);
  });

  it('returns false when an expected service has a recent error', () => {
    markExpected('polling');
    recordSuccess('polling', 1_000);
    recordError('polling', 'NMS down', 9_500);
    // now=10000, errorAt=9500 → diff=500 < recentErrorMs=600000
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns true once the error window has elapsed (the operator had time to act)', () => {
    markExpected('polling');
    recordError('polling', 'NMS down', 1_000);
    // now=400_000, errorAt=1000 → diff=399_000 > recentErrorMs=60_000
    expect(overallHealthy(snapshotHealth(), 60_000, 400_000)).toBe(true);
  });

  it('returns false when syslog is expected but never bound', () => {
    markExpected('syslog');
    // No bind callback fired → bound stays undefined.
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns false when syslog was bound but then closed (bound=false)', () => {
    markExpected('syslog');
    recordSyslogBound(true);
    recordSyslogBound(false);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns false when ANY expected service is unhealthy (not just one)', () => {
    markExpected('polling');
    markExpected('firmware');
    recordSuccess('polling', 1_000);
    recordError('firmware', 'audit failed', 9_500);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });
});

import {
  detectHangedLoops,
  type ServiceHealth,
  type SchedulerName,
} from '../../../lib/monitoring/scheduler-health';

describe('detectHangedLoops (Fase 2 — 2.6)', () => {
  const NOW = 1_700_000_000_000;
  const STALE_MS = 10 * 60 * 1000;

  function snap(entries: Array<[SchedulerName, ServiceHealth]>): Record<string, ServiceHealth> {
    return Object.fromEntries(entries);
  }

  it('reports services that never ran (ausencia de primera ejecución)', () => {
    const s = snap([
      ['polling', { expected: true, lastRunAt: null, lastError: null, lastErrorAt: null }],
      ['firmware', { expected: true, lastRunAt: null, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW).sort()).toEqual(['firmware', 'polling']);
  });

  it('reports services whose last successful tick is too old (ciclo colgado)', () => {
    const s = snap([
      [
        'polling',
        { expected: true, lastRunAt: NOW - 20 * 60 * 1000, lastError: null, lastErrorAt: null },
      ],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual(['polling']);
  });

  it('does NOT report services that ran recently (healthy)', () => {
    const s = snap([
      ['polling', { expected: true, lastRunAt: NOW - 30_000, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual([]);
  });

  it('does NOT report services that are not expected (env flag off)', () => {
    const s = snap([
      ['polling', { expected: false, lastRunAt: null, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual([]);
  });

  it('is idempotent — same snapshot → same list', () => {
    const s = snap([
      ['polling', { expected: true, lastRunAt: null, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual(detectHangedLoops(s, NOW));
  });
});
