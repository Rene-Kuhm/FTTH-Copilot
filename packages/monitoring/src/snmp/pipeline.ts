/**
 * End-to-End SNMP Normalization Pipeline (Roadmap Fase 2 — Gate 2).
 *
 * Coordinates:
 * 1. Notification identity resolution (resolveDeviceIdentity).
 * 2. Deterministic adapter resolution (OltAdapterRegistry).
 * 3. Safe adapter execution (executeAdapterSafe) enforcing tenant isolation.
 * 4. Production of canonical TelemetryEvent ('ftth.telemetry.v1').
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { executeAdapterSafe } from './adapter/contract';
import { defaultAdapterRegistry, OltAdapterRegistry } from './adapter/registry';
import { resolveDeviceIdentity, type ResolvedDeviceIdentity } from './identity';
import type { SnmpSenderContext } from './mapping';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from './types';

export interface SnmpPipelineOptions {
  adapterRegistry?: OltAdapterRegistry;
  onTelemetryEvent?: (
    event: TelemetryEvent,
    evidence: RawSnmpEvidenceEnvelope,
    identity: ResolvedDeviceIdentity,
  ) => void;
}

export interface SnmpPipelineResult {
  event: TelemetryEvent;
  evidence: RawSnmpEvidenceEnvelope;
  identity: ResolvedDeviceIdentity;
}

/**
 * Processes an incoming decoded SNMP notification through identity and adapter stages.
 */
export function processSnmpNotification(
  notification: DecodedSnmpNotification,
  senderContext: SnmpSenderContext,
  evidence: RawSnmpEvidenceEnvelope,
  options: SnmpPipelineOptions = {},
): SnmpPipelineResult {
  const registry = options.adapterRegistry ?? defaultAdapterRegistry;

  // 1. Resolve authoritative multi-source device identity
  const identity = resolveDeviceIdentity(notification, senderContext);

  // 2. Deterministically resolve the vendor adapter (or standard fallback)
  const adapter = registry.resolve(notification, identity);

  // 3. Safely normalize to TelemetryEvent with strict invariants
  const event = executeAdapterSafe(adapter, notification, identity, evidence);

  // 4. Trigger telemetry listener if configured
  options.onTelemetryEvent?.(event, evidence, identity);

  return { event, evidence, identity };
}
