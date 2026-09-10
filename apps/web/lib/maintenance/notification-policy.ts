/**
 * Maintenance notification policy (Roadmap Fase 5 — 5.3 + 5.4).
 *
 * Background:
 *
 * 5.3: "Mantener ingesta y detección; modificar solamente la
 *      política de notificación para eventos esperables dentro
 *      del alcance."
 * 5.4: "Definir eventos que nunca se silencian por mantenimiento,
 *      especialmente señales SOC ajenas al trabajo autorizado.
 *      Registrar cada supresión y su motivo."
 *
 * This module is the pure, deterministic projection of an alert +
 * the active maintenance windows onto a notification decision. The
 * decision is one of:
 *
 *   - 'notify'        — send the notification (default).
 *   - 'suppress'      — silence: the event is expected inside an
 *                       active window whose scope covers it, and
 *                       it is NOT in the SOC list. The suppression
 *                       is recorded for audit (5.4).
 *   - 'never-suppress'— even when an active window covers the
 *                       scope, the SOC list forces a notification.
 *
 * The policy is OFF by default at the call site; the route checks
 * the `manage_maintenance` permission + a `notificationPolicyEnabled`
 * flag before reading this module.
 */

import type { MaintenanceWindow } from './overlap';
import {
  isInsideActiveMaintenance,
} from './overlap';

// SOC event categories — events in these categories MUST never be
// silenced by maintenance (5.4). The list is closed; production
// environments MAY extend it via configuration but the default is
// frozen here.
export const SOC_CATEGORIES: ReadonlyArray<
  'auth_failure' | 'access' | 'config_change' | 'rogue_device'
> = ['auth_failure', 'access', 'config_change', 'rogue_device'];

export type NotificationDecision = 'notify' | 'suppress' | 'never-suppress';

export interface MaintenancePolicyInput {
  /** Event severity: critical events have priority. */
  severity: 'warning' | 'critical' | 'info';
  /** Event category; SOC categories are NEVER silenced. */
  category: string;
  /** The device the event concerns. */
  deviceKind: string;
  deviceId: string;
  /** When the event happened (epoch ms). */
  whenMs: number;
}

export interface MaintenancePolicyArgs {
  event: MaintenancePolicyInput;
  /** Active maintenance windows of the tenant (cancelled excluded). */
  windows: ReadonlyArray<MaintenanceWindow>;
}

/**
 * Apply the policy. Pure: same inputs → same decision.
 */
export function applyMaintenanceNotificationPolicy(
  args: MaintenancePolicyArgs,
): NotificationDecision {
  const { event, windows } = args;

  // 5.4: SOC categories are NEVER silenced.
  if ((SOC_CATEGORIES as ReadonlyArray<string>).includes(event.category)) {
    return 'never-suppress';
  }

  // 5.3: only silence events that fall inside an active window.
  if (!isInsideActiveMaintenance(event.whenMs, windows)) {
    return 'notify';
  }

  // The event falls inside an active window. Check whether the
  // window's scope covers the device:
  //   - tenant-wide windows cover everything.
  //   - connection/device windows cover only when the device kind/id
  //     match the explicit id in the scope.
  // The current MaintenanceWindow.scope is opaque JSON
  // ({ kind: 'tenant' | 'connection' | 'device', id?: string }).
  // For the first version, we treat tenant-wide windows as covering
  // everything; connection / device windows are recognized
  // structurally but the semantic mapping (deviceKind -> connection)
  // lives outside this module. Until that mapping exists, those
  // windows never suppress, to avoid silencing events the policy
  // did not actually intend to suppress.
  for (const w of windows) {
    if (w.status !== 'scheduled') continue;
    if (event.whenMs < w.startUtcMs || event.whenMs >= w.endUtcMs) continue;
    if (w.scope.kind === 'tenant') {
      return 'suppress';
    }
    // connection / device: the consumer MUST wire up the semantic
    // mapping before this branch suppresses. Until then, notify.
  }
  return 'notify';
}
