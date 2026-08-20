import type {
  OltSummary,
  OnuSummary,
  OnuDetail,
  NetworkOverview,
} from '@ftth-copilot/connectors-core';

/**
 * Fixtures realistas basados en respuestas típicas de SmartOLT.
 * Reemplazar por llamadas reales cuando consigamos acceso a la sandbox.
 *
 * Reglas semánticas para que las respuestas del agente sean coherentes:
 * - OLT-001 y OLT-002: healthy
 * - OLT-003: alta temperatura (alerta)
 * - Algunas ONUs en cada OLT están offline o con señal baja
 */

export const FIXTURE_OLTS: OltSummary[] = [
  {
    id: 'OLT-001',
    name: 'OLT-Norte-Principal',
    ip: '10.0.1.10',
    status: 'online',
    uptimeSeconds: 1234567,
    temperatureCelsius: 42,
  },
  {
    id: 'OLT-002',
    name: 'OLT-Sur-Respaldo',
    ip: '10.0.1.11',
    status: 'online',
    uptimeSeconds: 9876543,
    temperatureCelsius: 38,
  },
  {
    id: 'OLT-003',
    name: 'OLT-Este-Cobertura',
    ip: '10.0.1.12',
    status: 'degraded',
    uptimeSeconds: 86400,
    temperatureCelsius: 68,
  },
];

export const FIXTURE_ONUS: OnuSummary[] = [
  // OLT-001
  {
    id: 'ONU-0001',
    serial: 'SN-A1B2C3D4',
    oltId: 'OLT-001',
    customerName: 'Juan Pérez',
    status: 'online',
    rxPowerDbm: -19.5,
    txPowerDbm: 2.1,
    uptimeSeconds: 432000,
    lastSeenAt: '2026-08-20T01:30:00Z',
  },
  {
    id: 'ONU-0002',
    serial: 'SN-B2C3D4E5',
    oltId: 'OLT-001',
    customerName: 'María González',
    status: 'online',
    rxPowerDbm: -22.0,
    txPowerDbm: 2.3,
    uptimeSeconds: 864000,
    lastSeenAt: '2026-08-20T01:30:00Z',
  },
  {
    id: 'ONU-0003',
    serial: 'SN-C3D4E5F6',
    oltId: 'OLT-001',
    customerName: 'Carlos López',
    status: 'offline',
    rxPowerDbm: -28.5,
    uptimeSeconds: 0,
    lastSeenAt: '2026-08-19T18:45:00Z',
  },
  // OLT-002
  {
    id: 'ONU-0010',
    serial: 'SN-D4E5F6A7',
    oltId: 'OLT-002',
    customerName: 'Ana Martínez',
    status: 'online',
    rxPowerDbm: -20.1,
    txPowerDbm: 1.9,
    uptimeSeconds: 1296000,
    lastSeenAt: '2026-08-20T01:30:00Z',
  },
  {
    id: 'ONU-0011',
    serial: 'SN-E5F6A7B8',
    oltId: 'OLT-002',
    customerName: 'Luis Rodríguez',
    status: 'degraded',
    rxPowerDbm: -25.5,
    txPowerDbm: 2.0,
    uptimeSeconds: 600000,
    lastSeenAt: '2026-08-20T01:30:00Z',
  },
  // OLT-003 (con problemas)
  {
    id: 'ONU-0020',
    serial: 'SN-F6A7B8C9',
    oltId: 'OLT-003',
    customerName: 'Pedro Sánchez',
    status: 'offline',
    rxPowerDbm: -30.0,
    uptimeSeconds: 0,
    lastSeenAt: '2026-08-19T15:20:00Z',
  },
  {
    id: 'ONU-0021',
    serial: 'SN-A7B8C9D0',
    oltId: 'OLT-003',
    customerName: 'Sofía Fernández',
    status: 'offline',
    rxPowerDbm: -29.8,
    uptimeSeconds: 0,
    lastSeenAt: '2026-08-19T16:10:00Z',
  },
];

export const FIXTURE_ONU_DETAILS: Record<string, OnuDetail> = {
  'ONU-0001': {
    ...FIXTURE_ONUS[0]!,
    model: 'HG8145V5',
    vendor: 'Huawei',
    oltPort: '0/1/1',
    firmwareVersion: 'V3R019C10S135',
    signalHistory: [
      { timestamp: '2026-08-19T22:00:00Z', rxPowerDbm: -19.2 },
      { timestamp: '2026-08-19T23:00:00Z', rxPowerDbm: -19.4 },
      { timestamp: '2026-08-20T00:00:00Z', rxPowerDbm: -19.5 },
      { timestamp: '2026-08-20T01:00:00Z', rxPowerDbm: -19.5 },
    ],
  },
  'ONU-0003': {
    ...FIXTURE_ONUS[2]!,
    model: 'HG8145V5',
    vendor: 'Huawei',
    oltPort: '0/1/3',
    firmwareVersion: 'V3R019C10S135',
    signalHistory: [
      { timestamp: '2026-08-19T15:00:00Z', rxPowerDbm: -24.0 },
      { timestamp: '2026-08-19T18:00:00Z', rxPowerDbm: -27.5 },
      { timestamp: '2026-08-19T18:45:00Z', rxPowerDbm: -28.5 },
    ],
  },
};

export function computeOverview(): NetworkOverview {
  const onlineOnus = FIXTURE_ONUS.filter((o) => o.status === 'online').length;
  const offlineOnus = FIXTURE_ONUS.filter((o) => o.status === 'offline').length;
  const oltsOnline = FIXTURE_OLTS.filter((o) => o.status === 'online').length;
  const oltsHighTemp = FIXTURE_OLTS.filter(
    (o) => (o.temperatureCelsius ?? 0) > 60,
  ).length;
  const avgUptime =
    FIXTURE_ONUS.reduce((acc, o) => acc + (o.uptimeSeconds ?? 0), 0) /
    FIXTURE_ONUS.length;

  return {
    totalOlts: FIXTURE_OLTS.length,
    oltsOnline,
    totalOnus: FIXTURE_ONUS.length,
    onusOnline: onlineOnus,
    onusOffline: offlineOnus,
    averageUptimeSeconds: Math.round(avgUptime),
    oltsWithHighTemperature: oltsHighTemp,
  };
}
