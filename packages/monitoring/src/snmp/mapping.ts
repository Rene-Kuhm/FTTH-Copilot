/**
 * SNMP Sender Registry and Tenant Isolation (Roadmap Fase 6 — 6.2).
 *
 * 6.2: "Documentar versión SNMP, autenticación soportada, red de gestión,
 *      remitentes permitidos y asociación administrada remitente → tenant/conexión/equipo.
 *      No confiar en un tenant incluido en el payload."
 */

export interface SnmpSenderContext {
  tenantId: string;
  connectionId: string;
  oltId: string;
  vendor?: string;
  managementNetwork?: string;
}

export interface SnmpSenderRegistration extends SnmpSenderContext {
  senderIp: string;
  community?: string;
}

export type SnmpSenderRegistry = Map<string, SnmpSenderContext>;

/**
 * Creates an immutable sender lookup map from registrations.
 */
export function createSenderRegistry(
  registrations: ReadonlyArray<SnmpSenderRegistration>,
): SnmpSenderRegistry {
  const map = new Map<string, SnmpSenderContext>();
  for (const reg of registrations) {
    map.set(reg.senderIp.trim(), {
      tenantId: reg.tenantId,
      connectionId: reg.connectionId,
      oltId: reg.oltId,
      vendor: reg.vendor,
      managementNetwork: reg.managementNetwork,
    });
  }
  return map;
}

/**
 * Resolves the authenticated/authorized context for a trap sender IP.
 *
 * Security: The `payloadTenantClaim` is explicitly rejected. Identity is
 * anchored exclusively to the managed network association for `senderIp`.
 */
export function resolveTrapSender(
  senderIp: string,
  registry: SnmpSenderRegistry,
  _payloadTenantClaim?: string,
): SnmpSenderContext | null {
  const cleanIp = senderIp.trim();
  const context = registry.get(cleanIp);
  if (!context) return null;

  return {
    tenantId: context.tenantId,
    connectionId: context.connectionId,
    oltId: context.oltId,
    vendor: context.vendor,
    managementNetwork: context.managementNetwork,
  };
}
