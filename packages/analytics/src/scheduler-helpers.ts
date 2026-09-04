import type { OnuDetail, OnuSummary } from '@ftth-copilot/connectors-core';
import type { MetricPoint, SampleMeta } from './types';

/**
 * Per-field FEC/optical guard. Returns the point when the field is a finite
 * number; returns `null` otherwise so the caller can skip it without polluting
 * the output with NaN/Infinity rows.
 *
 * `assembleOnuDetailPoints` only emits points for the four FEC/optical kinds.
 * `STATUS`, `RX_POWER_DBM`, `TX_POWER_DBM`, and `UPTIME_SECONDS` are owned by
 * the bulk `collectSamples` path that the FEC scheduler is layered on top of,
 * so this helper deliberately does NOT re-emit them — doing so would duplicate
 * rows the 15-min poller already wrote.
 */
function pointIfFinite(
  meta: SampleMeta,
  deviceId: string,
  kind: MetricPoint['kind'],
  sampledAt: string,
  value: number | undefined,
): MetricPoint | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return { ...meta, deviceKind: 'ONU', deviceId, kind, value, sampledAt };
}

/**
 * Deterministic, pure rotation over `onus` returning a stable slice of size
 * `sliceSize` based on `tickIndex`.
 *
 * Contract (REQ-2):
 *   - The slice starts at `(tickIndex * sliceSize) % max(1, onus.length)`,
 *     wrapping around the end of the sorted input when needed.
 *   - The input is sorted by `id` for determinism; the original array is
 *     NEVER mutated (the sort runs on a shallow copy, and frozen inputs are
 *     tolerated).
 *   - When `sliceSize >= onus.length`, the slice equals the full sorted input.
 *   - When `sliceSize <= 0` or `onus` is empty, returns an empty array.
 *   - O(n log n) for the sort, O(sliceSize) for the slice itself.
 *   - No I/O, no `Date.now()`, no `Math.random()`.
 */
export function pickFecFanOutSlice(
  onus: readonly OnuSummary[],
  tickIndex: number,
  sliceSize: number,
): OnuSummary[] {
  const length = onus.length;
  if (length === 0 || sliceSize <= 0) return [];

  const sorted = [...onus].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // If the slice covers (or exceeds) the whole input, return the full sorted
  // input — no need to wrap.
  if (sliceSize >= length) return sorted;

  const start = ((tickIndex * sliceSize) % length + length) % length;
  const end = start + sliceSize;
  if (end <= length) {
    return sorted.slice(start, end);
  }
  return [...sorted.slice(start, length), ...sorted.slice(0, end - length)];
}

/**
 * Pre-flight guard (REQ-3) that checks whether `perCycle` requests fired every
 * `intervalMs` would stay under `limitPerHour` SmartOLT requests.
 *
 * Formula: `perCycle × (3,600,000 / intervalMs) ≤ limitPerHour` (inclusive
 * upper bound — AD-3).
 *
 * Edge cases (defensive against bad env vars):
 *   - `perCycle <= 0` (including negative or NaN) → `true` (vacuous: zero
 *     requests projected per hour, so the budget is never exceeded).
 *   - `intervalMs <= 0`, `NaN`, or non-finite → `false` (the projection is
 *     undefined; refuse to fan-out rather than risk blowing the budget).
 *
 * Pure: no I/O, no `Date.now()`.
 */
export function fitsRateBudget(perCycle: number, intervalMs: number, limitPerHour: number): boolean {
  if (!Number.isFinite(perCycle) || perCycle <= 0) return true;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  return perCycle * (3_600_000 / intervalMs) <= limitPerHour;
}

/**
 * Assembles `MetricPoint`s for a single `OnuDetail`, mirroring the per-field
 * shape that `collect.ts:136-161` emits for the SAME four FEC/optical kinds.
 *
 * The helper is intentionally narrower than `collectSamples` — it only emits
 * `FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, and
 * `ONT_TEMPERATURE_CELSIUS`. `STATUS`, `RX_POWER_DBM`, `TX_POWER_DBM`, and
 * `UPTIME_SECONDS` are owned by the bulk path and re-emitting them here would
 * duplicate rows the 15-min poller already wrote.
 *
 * Per-field guard: a field that is `undefined`, `NaN`, or non-finite contributes
 * no point. A Mikrowisp detail that lacks every FEC/optical field therefore
 * produces an empty array (REQ-4 / AD-4 graceful no-op).
 *
 * Pure: no I/O, no `Date.now()`. The caller passes `sampledAt` so the timestamp
 * can be fixed across an entire tick.
 */
export function assembleOnuDetailPoints(
  meta: SampleMeta,
  detail: OnuDetail,
  sampledAt: string,
): MetricPoint[] {
  const points: MetricPoint[] = [];
  const maybePush = (
    kind: MetricPoint['kind'],
    value: number | undefined,
  ): void => {
    const point = pointIfFinite(meta, detail.id, kind, sampledAt, value);
    if (point) points.push(point);
  };

  maybePush('FEC_CORRECTED', detail.fecCorrected);
  maybePush('FEC_UNCORRECTED', detail.fecUncorrected);
  maybePush('BIAS_CURRENT_MA', detail.biasCurrentMa);
  maybePush('ONT_TEMPERATURE_CELSIUS', detail.ontTemperatureCelsius);

  return points;
}

/**
 * Bounded-concurrency fan-out with per-item failure capture. Mirrors the
 * semantics of the private `mapAllSettled` in `collect.ts:39-61` — preserved
 * here as a public helper so the FEC scheduler does not need to depend on a
 * private export from `collect.ts`.
 *
 * Contract:
 *   - `concurrency` is clamped to `>= 1`; values below 1 run sequentially.
 *   - The output preserves the input order (result[i] corresponds to items[i]).
 *   - A thrown rejection from `fn` is captured as `{ ok: false, reason }`; the
 *     other items still complete.
 *   - Returns an empty array for empty input.
 *
 * Note: the surface is async even when `fn` is synchronous — this matches
 * `collect.ts` so callers can swap implementations without changing call sites.
 */
export async function mapAllSettled<T, U>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<Array<{ ok: true; value: U } | { ok: false; reason: unknown }>> {
  const length = items.length;
  const results: Array<{ ok: true; value: U } | { ok: false; reason: unknown }> = new Array(length);
  if (length === 0) return results;

  const limit = Math.max(1, Math.floor(concurrency));
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex++;
      if (i >= length) return;
      try {
        const value = await fn(items[i]!, i);
        results[i] = { ok: true, value };
      } catch (reason) {
        results[i] = { ok: false, reason };
      }
    }
  };

  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < limit; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}