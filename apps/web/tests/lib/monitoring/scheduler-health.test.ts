import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  markExpected: vi.fn(),
  markNotExpected: vi.fn(),
  recordSuccess: vi.fn(),
  recordError: vi.fn(),
  recordSyslogBound: vi.fn(),
  recordSnmpBound: vi.fn(),
  snapshotHealth: vi.fn(),
  detectHangedLoops: vi.fn(),
  overallHealthy: vi.fn(),
  serviceStatus: vi.fn(),
  setNextRun: vi.fn(),
  withServiceStatus: vi.fn(),
  __resetSchedulerHealth: vi.fn(),
}));

vi.mock('@ftth-copilot/scheduler', () => mocks);

import * as schedulerHealth from '@/lib/monitoring/scheduler-health';

describe('scheduler-health monitoring re-exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-exports every scheduler health symbol from @ftth-copilot/scheduler', () => {
    expect(schedulerHealth.markExpected).toBe(mocks.markExpected);
    expect(schedulerHealth.markNotExpected).toBe(mocks.markNotExpected);
    expect(schedulerHealth.recordSuccess).toBe(mocks.recordSuccess);
    expect(schedulerHealth.recordError).toBe(mocks.recordError);
    expect(schedulerHealth.recordSyslogBound).toBe(mocks.recordSyslogBound);
    expect(schedulerHealth.recordSnmpBound).toBe(mocks.recordSnmpBound);
    expect(schedulerHealth.snapshotHealth).toBe(mocks.snapshotHealth);
    expect(schedulerHealth.detectHangedLoops).toBe(mocks.detectHangedLoops);
    expect(schedulerHealth.overallHealthy).toBe(mocks.overallHealthy);
    expect(schedulerHealth.serviceStatus).toBe(mocks.serviceStatus);
    expect(schedulerHealth.setNextRun).toBe(mocks.setNextRun);
    expect(schedulerHealth.withServiceStatus).toBe(mocks.withServiceStatus);
    expect(schedulerHealth.__resetSchedulerHealth).toBe(mocks.__resetSchedulerHealth);
  });

  it('delegates calls and return values through the re-exported functions', () => {
    const healthSnapshot = {
      polling: { expected: true, lastRunAt: 1_700_000_000_000, lastError: null, lastErrorAt: null },
    };
    mocks.snapshotHealth.mockReturnValue(healthSnapshot);
    mocks.overallHealthy.mockReturnValue(true);
    mocks.detectHangedLoops.mockReturnValue([]);

    schedulerHealth.markExpected('polling');
    schedulerHealth.recordSuccess('polling', 1_700_000_000_000);
    schedulerHealth.recordError('syslog', 'timeout', 1_700_000_000_500);
    schedulerHealth.recordSyslogBound(true);
    schedulerHealth.recordSnmpBound(false);
    schedulerHealth.setNextRun('polling', 1_700_000_060_000);

    expect(mocks.markExpected).toHaveBeenCalledWith('polling');
    expect(mocks.recordSuccess).toHaveBeenCalledWith('polling', 1_700_000_000_000);
    expect(mocks.recordError).toHaveBeenCalledWith('syslog', 'timeout', 1_700_000_000_500);
    expect(mocks.recordSyslogBound).toHaveBeenCalledWith(true);
    expect(mocks.recordSnmpBound).toHaveBeenCalledWith(false);
    expect(mocks.setNextRun).toHaveBeenCalledWith('polling', 1_700_000_060_000);
    expect(schedulerHealth.snapshotHealth()).toBe(healthSnapshot);
    expect(schedulerHealth.overallHealthy(healthSnapshot)).toBe(true);
    expect(schedulerHealth.detectHangedLoops(healthSnapshot, 1_700_000_000_000)).toEqual([]);
  });
});
