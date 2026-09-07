import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for the single-flight scheduler contract.
 *
 * The previous contract (`apps/web/lib/monitoring/scheduler.ts`):
 *   setInterval(() => runScheduledPoll().catch(() => {}), intervalMs);
 *
 * If a run takes longer than `intervalMs`, the next interval tick
 * fires while the previous run is still in flight and a second run
 * starts in parallel. With a slow NMS or a heavy FEC tick, this
 * overlap compounds.
 *
 * The new contract:
 *   setInterval(() => void tryStart('polling', runScheduledPoll), intervalMs);
 *
 * `tryStart` is a single-flight guard. While a run is in flight, a
 * second tick is logged and dropped. The in-flight flag is reset in
 * `finally`, so a thrown run never leaks the lock.
 *
 * The tests drive `tryStart` directly to avoid pulling the entire
 * `startPollingLoop` boot path (which needs Prisma, the connector
 * factory, and Telegram env vars).
 */

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// We import after the timers are installed so the warm-up timeouts in
// start*Loop are controllable.
import { __clearSchedulerState, tryStart } from '../../../lib/monitoring/scheduler';

describe('single-flight scheduler guard', () => {
  it('exports tryStart as a testable helper', () => {
    // The single-flight guard is exposed for direct testing. This
    // avoids having to exercise the full startPollingLoop boot path
    // (which pulls Prisma + the connector factory).
    expect(typeof tryStart).toBe('function');
  });

  it('skips a tick that lands while the previous run is still in flight', async () => {
    __clearSchedulerState();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let resolveFirst: () => void = () => {};
    const firstRun = new Promise<void>((res) => {
      resolveFirst = res;
    });
    const run1 = vi.fn().mockReturnValue(firstRun);
    const run2 = vi.fn().mockResolvedValue(undefined);

    // Start the first run — do not await it.
    const first = tryStart('overlap', run1);
    // While the first is still in flight, start the second.
    const second = await tryStart('overlap', run2);

    // First call started running; second call was skipped.
    expect(run1).toHaveBeenCalledTimes(1);
    expect(run2).toHaveBeenCalledTimes(0);
    expect(second).toBe(false);

    // Finish the first run.
    resolveFirst();
    await first;
    expect(run1).toHaveBeenCalledTimes(1);

    // Now a third call can run because the first has resolved.
    const third = await tryStart('overlap', run2);
    expect(third).toBe(true);
    expect(run2).toHaveBeenCalledTimes(1);

    // No warn was emitted (the only skip was silent on the second
    // call because tryStart returns false directly). Actually, the
    // current implementation DOES emit a warn on the skip — pin that.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((call: unknown[]) =>
      typeof call[0] === 'string' &&
      call[0].includes('skipped overlapping tick'),
    )).toBe(true);
  });

  it('clears the in-flight flag after the run resolves (next tick can run)', async () => {
    __clearSchedulerState();
    const run = vi.fn().mockResolvedValue(undefined);

    const r1 = await tryStart('next', run);
    expect(r1).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    const r2 = await tryStart('next', run);
    expect(r2).toBe(true); // the previous run has already resolved
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight flag even when the run throws (no lock leak)', async () => {
    __clearSchedulerState();
    const run1 = vi.fn().mockRejectedValue(new Error('boom'));
    const run2 = vi.fn().mockResolvedValue(undefined);

    const r1 = await tryStart('throws', run1);
    expect(r1).toBe(false); // throws → returns false (no consumption of cooldown)
    expect(run1).toHaveBeenCalledTimes(1);

    // The second call should be allowed because the first threw and
    // the in-flight flag was reset in the `finally` block.
    const r2 = await tryStart('throws', run2);
    expect(r2).toBe(true);
    expect(run2).toHaveBeenCalledTimes(1);
  });

  it('isolates in-flight state per name', async () => {
    __clearSchedulerState();
    let resolveFirst: () => void = () => {};
    const firstRun = new Promise<void>((res) => {
      resolveFirst = res;
    });

    const a = tryStart('alpha', () => firstRun);
    const b = await tryStart('beta', async () => undefined);

    // Different names → independent state.
    expect(b).toBe(true);

    resolveFirst();
    await a;
  });
});
