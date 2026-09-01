import type { INmsConnector, OnuDetail, OnuSummary } from '@ftth-copilot/connectors-core';
import type { CollectOptions, MetricPoint, SampleMeta } from './types';

function makePoint(
  meta: SampleMeta,
  deviceKind: MetricPoint['deviceKind'],
  deviceId: string,
  kind: MetricPoint['kind'],
  sampledAt: string,
  value?: number,
  valueText?: string,
): MetricPoint {
  return { ...meta, deviceKind, deviceId, kind, value, valueText, sampledAt };
}

/**
 * Returns a new `OnuSummary` with any fields present in `detail` overlaid on
 * top of `summary`. The detail endpoint is treated as the authoritative source
 * for the optical/firmware fields it exposes; pre-existing summary values are
 * preserved when the detail didn't carry them.
 */
function mergeOnuDetail(summary: OnuSummary, detail: OnuDetail | null | undefined): OnuSummary {
  if (!detail) return summary;
  return {
    ...summary,
    fecCorrected: detail.fecCorrected ?? summary.fecCorrected,
    fecUncorrected: detail.fecUncorrected ?? summary.fecUncorrected,
    biasCurrentMa: detail.biasCurrentMa ?? summary.biasCurrentMa,
    ontTemperatureCelsius: detail.ontTemperatureCelsius ?? summary.ontTemperatureCelsius,
  };
}

/**
 * Applies `fn` to every element of `items` with at most `concurrency`
 * invocations in flight. Preserves input order in the output array. A single
 * failure does not abort the batch — the thrown error is captured and the
 * caller decides what to do with it.
 */
async function mapAllSettled<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<OnuDetail | null>,
): Promise<Array<{ ok: true; value: OnuDetail | null } | { ok: false; reason: unknown }>> {
  const results: Array<{ ok: true; value: OnuDetail | null } | { ok: false; reason: unknown }> = new Array(items.length);
  let nextIndex = 0;
  const limit = Math.max(1, concurrency);
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      try {
        const value = await fn(items[i]!, i);
        results[i] = { ok: true, value };
      } catch (reason) {
        results[i] = { ok: false, reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Samples the current state of a connector into a flat list of MetricPoints.
 *
 * Uses only bulk endpoints by default (listOlts + listOnus) so it stays inside
 * SmartOLT's hourly rate limit. When `includeOltDetail` is true, OLT temperature
 * and uptime are read from getOltDetail() and bulk values for those metrics are
 * skipped to avoid duplicates. A failure in a single OLT's detail call is
 * swallowed so the rest of the sample survives.
 *
 * When `includeOnuDetail` is true, the collector fans out to getOnuDetail()
 * per ONU so optical-health fields (FEC corrected/uncorrected, bias current,
 * ONT temperature) reach the metrics table. A failure in a single ONU's
 * detail call is swallowed; the summary values from `listOnus()` survive.
 */
export async function collectSamples(
  connector: INmsConnector,
  meta: SampleMeta,
  opts: CollectOptions = {},
): Promise<MetricPoint[]> {
  const sampledAt = (opts.now ?? new Date()).toISOString();
  const points: MetricPoint[] = [];

  const [olts, onus] = await Promise.all([
    connector.listOlts(),
    connector.listOnus(),
  ]);

  for (const olt of olts) {
    if (olt.status) {
      points.push(makePoint(meta, 'OLT', olt.id, 'STATUS', sampledAt, undefined, olt.status));
    }
    if (!opts.includeOltDetail) {
      if (olt.temperatureCelsius !== undefined) {
        points.push(makePoint(meta, 'OLT', olt.id, 'TEMPERATURE_CELSIUS', sampledAt, olt.temperatureCelsius));
      }
      if (olt.uptimeSeconds !== undefined) {
        points.push(makePoint(meta, 'OLT', olt.id, 'UPTIME_SECONDS', sampledAt, olt.uptimeSeconds));
      }
    }
  }

  if (opts.includeOltDetail) {
    for (const olt of olts) {
      try {
        const detail = await connector.getOltDetail(olt.id);
        if (detail.temperatureCelsius !== undefined) {
          points.push(makePoint(meta, 'OLT', olt.id, 'TEMPERATURE_CELSIUS', sampledAt, detail.temperatureCelsius));
        }
        if (detail.uptimeSeconds !== undefined) {
          points.push(makePoint(meta, 'OLT', olt.id, 'UPTIME_SECONDS', sampledAt, detail.uptimeSeconds));
        }
      } catch {
        // A single OLT detail failure must not drop the whole sample.
      }
    }
  }

  let mergedOnus: OnuSummary[] = onus;
  if (opts.includeOnuDetail && onus.length > 0) {
    const settled = await mapAllSettled(
      onus,
      4,
      async (onu) => {
        const detail = await connector.getOnuDetail(onu.id);
        return detail ?? (await connector.getOnuDetail(onu.serial));
      },
    );
    mergedOnus = onus.map((onu, i) => {
      const r = settled[i]!;
      return r.ok ? mergeOnuDetail(onu, r.value) : onu;
    });
  }

  for (const onu of mergedOnus) {
    if (onu.status) {
      points.push(makePoint(meta, 'ONU', onu.id, 'STATUS', sampledAt, undefined, onu.status));
    }
    if (onu.rxPowerDbm !== undefined) {
      points.push(makePoint(meta, 'ONU', onu.id, 'RX_POWER_DBM', sampledAt, onu.rxPowerDbm));
    }
    if (onu.txPowerDbm !== undefined) {
      points.push(makePoint(meta, 'ONU', onu.id, 'TX_POWER_DBM', sampledAt, onu.txPowerDbm));
    }
    if (onu.uptimeSeconds !== undefined) {
      points.push(makePoint(meta, 'ONU', onu.id, 'UPTIME_SECONDS', sampledAt, onu.uptimeSeconds));
    }
    if (onu.fecCorrected !== undefined) {
      points.push(makePoint(meta, 'ONU', onu.id, 'FEC_CORRECTED', sampledAt, onu.fecCorrected));
    }
    if (onu.fecUncorrected !== undefined) {
      points.push(makePoint(meta, 'ONU', onu.id, 'FEC_UNCORRECTED', sampledAt, onu.fecUncorrected));
    }
    if (onu.biasCurrentMa !== undefined) {
      points.push(makePoint(meta, 'ONU', onu.id, 'BIAS_CURRENT_MA', sampledAt, onu.biasCurrentMa));
    }
    if (onu.ontTemperatureCelsius !== undefined) {
      points.push(makePoint(meta, 'ONU', onu.id, 'ONT_TEMPERATURE_CELSIUS', sampledAt, onu.ontTemperatureCelsius));
    }
  }

  return points;
}
