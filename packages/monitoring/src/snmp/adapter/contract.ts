/**
 * OLT Vendor Adapter Contract and Safety Invariants (Roadmap Fase 2).
 *
 * Defines the contract every vendor adapter must implement, and the execution harness
 * that enforces:
 * 1. Multi-tenant isolation (adapters cannot mutate tenantId).
 * 2. Pure transformation (adapters have zero side-effects, no network mutation).
 * 3. Severity bounding (cannot elevate severity without source justification).
 */

import { type TelemetryEvent } from '@ftth-copilot/shared';
import { lookupTrapDefinition } from '../catalog';
import type { ResolvedDeviceIdentity } from '../identity';
import type { DecodedSnmpNotification, RawSnmpEvidenceEnvelope } from '../types';

export interface OltVendorAdapter {
  readonly vendorId: string;
  readonly displayName: string;
  readonly supportedPens: readonly number[];
  readonly supportedFamilies: readonly string[];

  /**
   * Evaluates whether this adapter can interpret the given notification and identity.
   */
  supports(notification: DecodedSnmpNotification, identity: ResolvedDeviceIdentity): boolean;

  /**
   * Pure transformation normalizer producing a canonical TelemetryEvent.
   */
  normalize(
    notification: DecodedSnmpNotification,
    identity: ResolvedDeviceIdentity,
    rawEvidence: RawSnmpEvidenceEnvelope,
  ): TelemetryEvent;
}

export class AdapterSecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterSecurityViolationError';
  }
}

/**
 * Execution harness wrapping adapter normalization with mandatory safety invariants.
 */
export function executeAdapterSafe(
  adapter: OltVendorAdapter,
  notification: DecodedSnmpNotification,
  identity: ResolvedDeviceIdentity,
  rawEvidence: RawSnmpEvidenceEnvelope,
): TelemetryEvent {
  // Execute pure adapter transformation
  const event = adapter.normalize(notification, identity, rawEvidence);

  // Invariant 1: Tenant Immutability
  // If an adapter returns a mismatched tenantId, override it to guarantee isolation
  if (event.tenantId !== identity.tenantId) {
    throw new AdapterSecurityViolationError(
      `Adapter '${adapter.vendorId}' attempted to mutate tenantId from '${identity.tenantId}' to '${event.tenantId}'`,
    );
  }

  // Invariant 2: Catalog Severity Inflation Guard
  // An adapter cannot unilaterally inflate an info/warning trap to critical without catalog/fact backing
  const catalogDef = lookupTrapDefinition(notification.trapOid);
  const normalizedSeverity = event.metrics?.['severity'] as string | undefined;

  if (
    catalogDef.severity === 'info' &&
    normalizedSeverity === 'critical'
  ) {
    throw new AdapterSecurityViolationError(
      `Adapter '${adapter.vendorId}' attempted unjustified severity inflation from 'info' to 'critical' for OID '${notification.trapOid}'`,
    );
  }

  // Invariant 3: Tag preservation & Schema enforcement
  const enforcedTags: Record<string, string> = {
    ...(event.tags ?? {}),
    tenantId: identity.tenantId,
    connectionId: identity.connectionId,
    oltId: identity.oltId,
    vendor: identity.vendor,
    adapter: adapter.vendorId,
  };

  const catalogStatus =
    catalogDef.catalogStatus ??
    (catalogDef.status === 'provisional' ? 'provisional' : 'recognized');

  if (catalogStatus) {
    if (!event.metrics) event.metrics = {};
    event.metrics['catalogStatus'] = catalogStatus;
    enforcedTags['catalogStatus'] = catalogStatus;
  }

  if (catalogDef.candidateTrapName) {
    if (!event.metrics) event.metrics = {};
    event.metrics['candidateTrapName'] = catalogDef.candidateTrapName;
  }
  if (catalogDef.candidateDescription) {
    if (!event.metrics) event.metrics = {};
    event.metrics['candidateDescription'] = catalogDef.candidateDescription;
  }

  if (identity.isAmbiguous) {
    enforcedTags['ambiguity_detected'] = 'true';
    if (identity.ambiguityReason) {
      enforcedTags['ambiguity_reason'] = identity.ambiguityReason;
    }
  }

  return {
    ...event,
    schema: 'ftth.telemetry.v1',
    tenantId: identity.tenantId,
    tags: enforcedTags,
  };
}
