import type { MetricRow, SeriesByDevice, DeviceStatus } from './types';

const STATUS_VALUES: DeviceStatus[] = ['online', 'offline', 'degraded'];

/**
 * Groups flat metric rows into per-device series, skipping null values and
 * unknown statuses. Pure and order-independent (detectors sort by time).
 */
export function groupRows(rows: MetricRow[]): SeriesByDevice[] {
  const map = new Map<string, SeriesByDevice>();

  for (const row of rows) {
    const key = `${row.deviceKind}:${row.deviceId}`;
    let series = map.get(key);
    if (!series) {
      series = {
        deviceKind: row.deviceKind,
        deviceId: row.deviceId,
        rxPower: [],
        txPower: [],
        temperature: [],
        uptime: [],
        statuses: [],
        fecCorrected: [],
        fecUncorrected: [],
        biasCurrent: [],
        ontTemperature: [],
      };
      map.set(key, series);
    }

    const t = row.sampledAt.getTime();
    switch (row.kind) {
      case 'RX_POWER_DBM':
        if (row.value !== null) series.rxPower.push({ t, v: row.value });
        break;
      case 'TX_POWER_DBM':
        if (row.value !== null) series.txPower.push({ t, v: row.value });
        break;
      case 'TEMPERATURE_CELSIUS':
        if (row.value !== null) series.temperature.push({ t, v: row.value });
        break;
      case 'UPTIME_SECONDS':
        if (row.value !== null) series.uptime.push({ t, uptimeSeconds: row.value });
        break;
      case 'STATUS':
        if (row.valueText !== null && STATUS_VALUES.includes(row.valueText as DeviceStatus)) {
          series.statuses.push({ t, status: row.valueText as DeviceStatus });
        }
        break;
      case 'FEC_CORRECTED':
        if (row.value !== null) series.fecCorrected.push({ t, v: row.value });
        break;
      case 'FEC_UNCORRECTED':
        if (row.value !== null) series.fecUncorrected.push({ t, v: row.value });
        break;
      case 'BIAS_CURRENT_MA':
        if (row.value !== null) series.biasCurrent.push({ t, v: row.value });
        break;
      case 'ONT_TEMPERATURE_CELSIUS':
        if (row.value !== null) series.ontTemperature.push({ t, v: row.value });
        break;
    }
  }

  return [...map.values()];
}
