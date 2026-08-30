import type { INmsConnector } from '@ftth-copilot/connectors-core';
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
 * Samples the current state of a connector into a flat list of MetricPoints.
 *
 * Uses only bulk endpoints by default (listOlts + listOnus) so it stays inside
 * SmartOLT's hourly rate limit. When `includeOltDetail` is true, OLT temperature
 * and uptime are read from getOltDetail() and bulk values for those metrics are
 * skipped to avoid duplicates. A failure in a single OLT's detail call is
 * swallowed so the rest of the sample survives.
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

  for (const onu of onus) {
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
