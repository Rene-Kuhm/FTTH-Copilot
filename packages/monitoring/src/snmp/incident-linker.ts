/**
 * SNMP Trap and Incident Linker & Recovery (Roadmap Fase 6 — 6.6).
 *
 * 6.6: "Vincular traps y recuperación con incidentes existentes;
 *      considerar desorden, retransmisiones y cambios de reloj del equipo."
 */

import type { TelemetryEvent } from '@ftth-copilot/shared';

export interface ActiveIncidentContext {
  id: string;
  tenantId: string;
  deviceKind: 'OLT' | 'ONU';
  deviceId: string;
  status: 'open' | 'acknowledged' | 'resolved';
  firstSeenAt: string | Date;
  lastSeenAt: string | Date;
  resolvedAt?: string | Date | null;
}

export type TrapCorrelationAction =
  | 'correlate_alarm'
  | 'mark_recovered'
  | 'discard_stale'
  | 'no_match';

export interface TrapCorrelationOutcome {
  action: TrapCorrelationAction;
  incidentId?: string;
  matchedIncident?: ActiveIncidentContext;
  updatedLastSeenAt?: string;
  recoveryAt?: string;
  reason: string;
}

export interface CorrelateTrapArgs {
  event: TelemetryEvent;
  activeIncidents: ReadonlyArray<ActiveIncidentContext>;
  clockSkewToleranceMs?: number;
}

export function isClearingTrap(category: string): boolean {
  return category === 'link_up';
}

/**
 * Correlates a normalized SNMP trap event with existing tenant incidents.
 *
 * Enforces:
 * 1. Strict tenant isolation (Rule 5 & 6.2).
 * 2. Recovery identification for clearing traps (`link_up`).
 * 3. Out-of-order UDP datagram and retransmission protection (Rule 6.6).
 */
export function correlateTrapWithIncidents(args: CorrelateTrapArgs): TrapCorrelationOutcome {
  const { event, activeIncidents, clockSkewToleranceMs = 0 } = args;

  // Find active (non-resolved) incident for the exact (tenantId, deviceKind, deviceId)
  const matched = activeIncidents.find(
    (inc) =>
      inc.tenantId === event.tenantId &&
      inc.deviceKind === event.deviceKind &&
      inc.deviceId === event.deviceId &&
      inc.status !== 'resolved',
  );

  if (!matched) {
    return {
      action: 'no_match',
      reason: 'No matching active incident found for device in tenant',
    };
  }

  const trapCategory = String(event.metrics.trapCategory ?? 'unknown');
  const isProvisional =
    event.metrics?.['catalogStatus'] === 'provisional' ||
    event.tags?.['catalogStatus'] === 'provisional';

  // Rule: Provisional and unknown traps must never open, correlate, or resolve incidents
  if (trapCategory === 'unknown_trap' || isProvisional) {
    return {
      action: 'no_match',
      reason: 'Provisional or unknown traps do not trigger, correlate, or resolve incidents',
    };
  }

  const trapMs = new Date(event.ts).getTime();
  const lastSeenMs = new Date(matched.lastSeenAt).getTime();

  // 1. Handling clearing / recovery traps (e.g. link_up)
  if (isClearingTrap(trapCategory)) {
    if (trapMs < lastSeenMs - clockSkewToleranceMs) {
      return {
        action: 'discard_stale',
        incidentId: matched.id,
        matchedIncident: matched,
        reason: 'Out-of-order clearing trap predates active incident observation',
      };
    }

    return {
      action: 'mark_recovered',
      incidentId: matched.id,
      matchedIncident: matched,
      recoveryAt: event.ts,
      reason: 'Clearing trap indicates link/signal recovery for incident',
    };
  }

  // 2. Handling alarm traps (e.g. los, dying_gasp, link_down)
  if (trapMs < lastSeenMs - clockSkewToleranceMs) {
    return {
      action: 'discard_stale',
      incidentId: matched.id,
      matchedIncident: matched,
      reason: 'Out-of-order alarm datagram arrived after newer state observation',
    };
  }

  return {
    action: 'correlate_alarm',
    incidentId: matched.id,
    matchedIncident: matched,
    updatedLastSeenAt: event.ts,
    reason: 'Alarm trap correlated with active incident and advanced lastSeenAt',
  };
}
