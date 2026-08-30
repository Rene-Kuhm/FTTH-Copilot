import type { AlertRecord, IncidentRecord } from './types';

export interface CorrelateOptions {
  now: Date;
  /** Minimum number of distinct alert kinds on one device to form an incident. */
  minKinds?: number;
}

const DEFAULT_MIN_KINDS = 2;

/**
 * Groups active alerts by device. A device with at least `minKinds` distinct
 * alert kinds becomes one correlated incident: severity is the max of its
 * alerts, and the time span is the union of firstSeenAt..lastSeenAt.
 *
 * This is a pure function; the caller persists incidents and links alerts.
 */
export function correlateAlerts(
  alerts: AlertRecord[],
  opts: CorrelateOptions,
): IncidentRecord[] {
  const minKinds = opts.minKinds ?? DEFAULT_MIN_KINDS;

  const groups = new Map<string, AlertRecord[]>();
  for (const alert of alerts) {
    if (alert.status === 'resolved') continue;
    const key = `${alert.deviceKind}:${alert.deviceId}`;
    const list = groups.get(key) ?? [];
    list.push(alert);
    groups.set(key, list);
  }

  const incidents: IncidentRecord[] = [];
  for (const group of groups.values()) {
    const kinds = new Set(group.map((a) => a.kind));
    if (kinds.size < minKinds) continue;

    const critical = group.some((a) => a.severity === 'critical');
    const firstSeenAt = group.reduce(
      (min, a) => (a.firstSeenAt < min ? a.firstSeenAt : min),
      group[0]!.firstSeenAt,
    );
    const lastSeenAt = group.reduce(
      (max, a) => (a.lastSeenAt > max ? a.lastSeenAt : max),
      group[0]!.lastSeenAt,
    );

    const representative = group[0]!;
    incidents.push({
      tenantId: representative.tenantId,
      connectionId: representative.connectionId,
      deviceKind: representative.deviceKind,
      deviceId: representative.deviceId,
      title: `Incidente en ${representative.deviceKind} ${representative.deviceId}`,
      description: `${group.length} alerta(s) activas: ${[...kinds].join(', ')}`,
      severity: critical ? 'critical' : 'warning',
      status: 'open',
      firstSeenAt,
      lastSeenAt,
      resolvedAt: null,
    });
  }

  return incidents;
}
