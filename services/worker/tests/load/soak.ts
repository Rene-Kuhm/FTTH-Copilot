import assert from 'node:assert/strict';
import { getActiveResourcesInfo, memoryUsage } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

export function setting(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  assert(Number.isInteger(value) && value >= min && value <= max, `${name} must be an integer in [${min}, ${max}]`);
  return value;
}

export function soakDurationMs(): number {
  return 1000 * setting('SOAK_SECONDS', 120, 10, 86_400);
}

function sample() {
  assert(globalThis.gc, 'Run the soak target with Node --expose-gc');
  globalThis.gc();
  const { heapUsed, rss } = memoryUsage();
  return { heapUsed, rss, handles: getActiveResourcesInfo().length };
}

/** Measure at idle between cycles, after warming up the same workload. */
export async function runSoak(label: string, cycle: () => Promise<void>): Promise<void> {
  const durationMs = soakDurationMs();
  const mib = 1024 ** 2;
  const heapBudget = mib * setting('SOAK_HEAP_GROWTH_MIB', 24, 1, 4096);
  const rssBudget = mib * setting('SOAK_RSS_GROWTH_MIB', 96, 1, 4096);
  const handlesBudget = setting('SOAK_HANDLE_GROWTH', 2, 0, 100);

  for (let i = 0; i < 3; i++) {
    await cycle();
    await delay(1000);
  }
  const baseline = sample();
  const started = performance.now();
  const intervalMs = Math.min(10_000, durationMs / 5);
  let nextSampleAt = intervalMs;
  let cycles = 0;
  console.log(JSON.stringify({ label, phase: 'baseline', ...baseline }));

  do {
    const cycleStarted = performance.now();
    await cycle();
    cycles++;
    await delay(Math.max(0, 1000 - (performance.now() - cycleStarted)));
    const elapsedMs = performance.now() - started;
    if (elapsedMs >= nextSampleAt && elapsedMs < durationMs) {
      console.log(JSON.stringify({ label, phase: 'sample', elapsedMs, cycles, ...sample() }));
      nextSampleAt += intervalMs;
    }
  } while (performance.now() - started < durationMs);

  const final = sample();
  const growth = {
    heapUsed: final.heapUsed - baseline.heapUsed,
    rss: final.rss - baseline.rss,
    handles: final.handles - baseline.handles,
  };
  console.log(JSON.stringify({ label, phase: 'final', elapsedMs: performance.now() - started, cycles, ...final, growth }));
  assert(growth.heapUsed <= heapBudget, `post-GC heap growth ${growth.heapUsed} B > ${heapBudget} B`);
  assert(growth.rss <= rssBudget, `RSS growth ${growth.rss} B > ${rssBudget} B`);
  assert(growth.handles <= handlesBudget, `active resource growth ${growth.handles} > ${handlesBudget}`);
}
