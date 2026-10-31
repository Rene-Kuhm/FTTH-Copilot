import { describe, expect, it } from 'vitest';
import * as scheduler from '../src/index';

/**
 * Public surface of `@ftth-copilot/scheduler`.
 *
 * The package is the execution host of the background work: the web re-exports
 * it (`apps/web/lib/monitoring/scheduler.ts`) and the worker calls it from the
 * queue handlers (`services/worker/src/registry.ts`). A rename that breaks
 * one of the two is a wiring bug, so the surface is pinned here.
 */
describe('scheduler package surface', () => {
  it('exposes the runnable units of the three loops', () => {
    expect(typeof scheduler.runScheduledPoll).toBe('function');
    expect(typeof scheduler.runScheduledFirmwareAudit).toBe('function');
    expect(typeof scheduler.runScheduledFecCollection).toBe('function');
  });

  it('exposes the in-process loop starters', () => {
    expect(typeof scheduler.startPollingLoop).toBe('function');
    expect(typeof scheduler.startFirmwareAuditLoop).toBe('function');
    expect(typeof scheduler.startFecCollectionLoop).toBe('function');
  });

  it('exposes the concurrency helpers', () => {
    expect(typeof scheduler.advisoryLockKey).toBe('function');
    expect(typeof scheduler.acquireSchedulerLock).toBe('function');
    expect(typeof scheduler.tryStart).toBe('function');
    expect(typeof scheduler.__clearSchedulerState).toBe('function');
  });

  it('exposes the health registry', () => {
    expect(typeof scheduler.markExpected).toBe('function');
    expect(typeof scheduler.markNotExpected).toBe('function');
    expect(typeof scheduler.recordSuccess).toBe('function');
    expect(typeof scheduler.recordError).toBe('function');
    expect(typeof scheduler.snapshotHealth).toBe('function');
    expect(typeof scheduler.__resetSchedulerHealth).toBe('function');
  });
});
