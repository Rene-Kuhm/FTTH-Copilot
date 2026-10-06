import type { TelemetryEvent } from '@ftth-copilot/shared';
import type { DeviceEventCategory } from '@ftth-copilot/db';
import { spoolEvent, type DeviceEventPayload } from './event-ingest';

/**
 * Persists SNMP traps as device events.
 *
 * The receiver normalises a trap into a `TelemetryEvent`; this maps it onto the
 * `DeviceEvent` row the rest of the app already reads, and hands it to the
 * durable spool so a database outage delays persistence instead of dropping the
 * trap.
 */

/**
 * `DeviceEventCategory` has only four values, so trap categories collapse onto
 * the nearest one. Link and reachability traps are `access`; the two that share
 * a name with the enum map to themselves; the rest are `other`.
 */
const ACCESS_TRAPS = new Set([
  'los',
  'los_clear',
  'dying_gasp',
  'link_down',
  'link_up',
  'onu_offline',
  'onu_online',
  'otdr_fiber_break',
]);

const DIRECT_CATEGORIES = new Set(['auth_failure', 'config_change']);

/**
 * Catalog severity to the syslog numbering already used by the syslog path,
 * where `DeviceEvent.severity` comes from `priority % 8` (0..7).
 */
const SEVERITY_BY_CATALOG: Record<string, number> = {
  critical: 2,
  warning: 4,
  info: 6,
};

export function mapTrapSeverity(severity: string | undefined): number | null {
  return severity ? (SEVERITY_BY_CATALOG[severity] ?? null) : null;
}

export function mapTrapCategory(trapCategory: string | undefined): DeviceEventCategory {
  if (!trapCategory) return 'other';
  if (DIRECT_CATEGORIES.has(trapCategory)) return trapCategory as DeviceEventCategory;
  if (ACCESS_TRAPS.has(trapCategory)) return 'access';
  return 'other';
}

/** Human-readable one-liner, since the raw OID and varbinds are not persisted. */
export function describeTrap(event: TelemetryEvent): string {
  const tags = event.tags ?? {};
  const parts = [
    tags['trapCategory'] ?? 'snmp-trap',
    `${event.deviceKind} ${event.deviceId}`,
  ];
  const vendor = tags['vendor'];
  if (vendor) parts.push(`vendor=${vendor}`);
  const olt = tags['oltId'];
  if (olt) parts.push(`olt=${olt}`);

  return parts.join(' | ');
}

/**
 * Queue a normalised trap durably.
 *
 * Returns the spool id, or null when the spool refused the record.
 */
export function spoolSnmpTrap(event: TelemetryEvent): string | null {
  const payload: DeviceEventPayload = {
    tenantId: event.tenantId,
    connectionId: event.tags?.['connectionId'] ?? null,
    severity: mapTrapSeverity(event.tags?.['severity']),
    category: mapTrapCategory(event.tags?.['trapCategory']),
    message: describeTrap(event),
    occurredAt: new Date(event.ts),
    deviceKind: event.deviceKind,
    deviceId: event.deviceId,
  };

  return spoolEvent(payload);
}