import { setTimeout as delay } from 'node:timers/promises';
import type { Phase } from './profiles';

interface Sample {
  ms: number;
  error?: string;
}

type Operation = (index: number) => Promise<string | undefined>;

export async function runPhases(
  phases: Phase[],
  names: readonly string[],
  maxInFlight: number,
  operation: Operation,
): Promise<boolean> {
  const results = phases.map((phase) => ({
    phase,
    samples: names.map((): Sample[] => []),
  }));
  const inFlight = new Set<Promise<void>>();
  let next = 0;
  let phaseStart = performance.now();

  for (const { phase, samples } of results) {
    const count = phase.seconds * phase.perSecond;
    for (let slot = 0; slot < count; slot++) {
      const scheduled = phaseStart + (slot * 1_000) / phase.perSecond;
      const wait = scheduled - performance.now();
      if (wait > 0) await delay(wait);

      const index = next++;
      const bucket = samples[index % names.length];
      const launchDelay = performance.now() - scheduled;
      if (launchDelay >= 1_000 || inFlight.size >= maxInFlight) {
        bucket.push({ ms: launchDelay, error: 'generator missed arrival' });
        continue;
      }
      const task = Promise.resolve().then(() => operation(index)).then(
        (error) => { bucket.push({ ms: performance.now() - scheduled, error }); },
        () => { bucket.push({ ms: performance.now() - scheduled, error: 'operation failed' }); },
      );
      inFlight.add(task);
      void task.then(() => inFlight.delete(task));
    }
    phaseStart += phase.seconds * 1_000;
  }

  await Promise.all(inFlight);
  const resultsByPhase = results.flatMap(({ phase, samples }) => samples.map((bucket, index) => ({
    phase: phase.name,
    operation: names[index],
    durationSeconds: phase.seconds,
    ...summarize(phase, bucket),
  })));
  for (const result of resultsByPhase) console.log(JSON.stringify(result));
  return resultsByPhase.every((result) => result.pass);
}

export function summarize(phase: Phase, samples: Sample[]) {
  const durations = samples.filter((sample) => sample.error === undefined)
    .map((sample) => sample.ms).sort((a, b) => a - b);
  const errors: Record<string, number> = {};
  for (const { error } of samples) {
    if (error !== undefined) errors[error] = (errors[error] ?? 0) + 1;
  }
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1] ?? null;
  const p99 = durations[Math.ceil(durations.length * 0.99) - 1] ?? null;
  const errorRate = samples.length ? (samples.length - durations.length) / samples.length : 1;
  const missed = errors['generator missed arrival'] ?? 0;
  return {
    offered: samples.length,
    launched: samples.length - missed,
    succeeded: durations.length,
    errors,
    errorRate,
    p95Ms: p95 === null ? null : Number(p95.toFixed(2)),
    p99Ms: p99 === null ? null : Number(p99.toFixed(2)),
    pass: p95 !== null && p99 !== null && p95 <= phase.p95Ms && p99 <= phase.p99Ms
      && errorRate <= phase.maxErrorRate && missed === 0,
  };
}
