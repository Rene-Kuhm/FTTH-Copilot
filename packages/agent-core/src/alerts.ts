import type { INmsConnector, OltSummary, OnuSummary } from '@ftth-copilot/connectors-core';

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'offline' | 'high_temp' | 'degraded' | 'low_signal';
  title: string;
  description: string;
  affectedEntity: string; // OLT or ONU ID
  detectedAt: string;
}

export async function detectAlerts(connector: INmsConnector): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const now = new Date().toISOString();

  const [olts, onus, overview] = await Promise.all([
    connector.listOlts(),
    connector.listOnus(),
    connector.getNetworkOverview(),
  ]);

  // OLTs with high temperature
  for (const olt of olts) {
    if ((olt.temperatureCelsius ?? 0) > 60) {
      alerts.push({
        id: `alert-olt-temp-${olt.id}`,
        severity: olt.temperatureCelsius! > 70 ? 'critical' : 'warning',
        category: 'high_temp',
        title: `Temperatura alta en ${olt.name}`,
        description: `${olt.name} (${olt.id}) opera a ${olt.temperatureCelsius}°C. Umbral: 60°C.`,
        affectedEntity: olt.id,
        detectedAt: now,
      });
    }
    if (olt.status === 'degraded') {
      alerts.push({
        id: `alert-olt-degraded-${olt.id}`,
        severity: 'warning',
        category: 'degraded',
        title: `OLT degradado: ${olt.name}`,
        description: `${olt.name} (${olt.id}) está en estado degradado.`,
        affectedEntity: olt.id,
        detectedAt: now,
      });
    }
  }

  // Offline ONUs
  const offlineOnus = onus.filter(o => o.status === 'offline');
  for (const onu of offlineOnus) {
    alerts.push({
      id: `alert-onu-offline-${onu.id}`,
      severity: 'critical',
      category: 'offline',
      title: `ONU offline: ${onu.customerName ?? onu.id}`,
      description: `ONU ${onu.id} (${onu.customerName ?? 's/n'}) en OLT ${onu.oltId} está offline. Última vista: ${onu.lastSeenAt ?? 'desconocido'}.`,
      affectedEntity: onu.id,
      detectedAt: now,
    });
  }

  // Degraded ONUs
  const degradedOnus = onus.filter(o => o.status === 'degraded');
  for (const onu of degradedOnus) {
    alerts.push({
      id: `alert-onu-degraded-${onu.id}`,
      severity: 'warning',
      category: 'degraded',
      title: `ONU degradada: ${onu.customerName ?? onu.id}`,
      description: `ONU ${onu.id} (${onu.customerName ?? 's/n'}) tiene señal degradada. RX: ${onu.rxPowerDbm} dBm.`,
      affectedEntity: onu.id,
      detectedAt: now,
    });
  }

  // Low signal ONUs (below -27 dBm)
  const lowSignalOnus = onus.filter(o => (o.rxPowerDbm ?? 0) < -27 && o.status !== 'offline');
  for (const onu of lowSignalOnus) {
    alerts.push({
      id: `alert-onu-signal-${onu.id}`,
      severity: 'warning',
      category: 'low_signal',
      title: `Señal baja: ${onu.customerName ?? onu.id}`,
      description: `ONU ${onu.id} (${onu.customerName ?? 's/n'}) tiene RX power de ${onu.rxPowerDbm} dBm (umbral: -27 dBm).`,
      affectedEntity: onu.id,
      detectedAt: now,
    });
  }

  return alerts.sort((a, b) => {
    const sevOrder = { critical: 0, warning: 1, info: 2 };
    return sevOrder[a.severity] - sevOrder[b.severity];
  });
}
