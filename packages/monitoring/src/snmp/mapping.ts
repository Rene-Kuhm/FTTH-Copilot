/**
 * SNMP Sender Registry and Tenant Isolation (Roadmap Fase 6 — 6.2 & Roadmap Fase 0).
 *
 * 6.2: "Documentar versión SNMP, autenticación soportada, red de gestión,
 *      remitentes permitidos y asociación administrada remitente → tenant/conexión/equipo.
 *      No confiar en un tenant incluido en el payload."
 * Fase 0: "Validar community v2c sin exponerla; implementar USM SNMPv3 authPriv conforme a RFC 3414.
 *          Mantener v1/v2c disponibles por compatibilidad, con advertencia y segmentación de red."
 */

import type { SnmpV3UserConfig, SnmpVersion } from './types';

export interface SnmpSenderContext {
  tenantId: string;
  connectionId: string;
  oltId: string;
  vendor?: string;
  model?: string;
  hardwareModel?: string;
  managementNetwork?: string;
}

export interface SnmpSenderRegistration extends SnmpSenderContext {
  senderIp: string;
  version?: SnmpVersion;
  community?: string;
  v3User?: SnmpV3UserConfig;
}

export type SnmpSenderRegistry = Map<string, SnmpSenderRegistration>;

/**
 * Checks security parameters for a registration and returns operational warnings.
 */
export function checkSenderSecurity(registration: SnmpSenderRegistration): string[] {
  const warnings: string[] = [];
  const version = registration.version ?? (registration.v3User ? 'v3' : 'v2c');

  if (version === 'v1' || version === 'v2c') {
    warnings.push(
      `[SECURITY] Sender ${registration.senderIp} uses SNMP ${version}. Plaintext community string transmission is vulnerable to sniffing. Dedicated management VLAN or IPsec segmentation is strongly required.`
    );
  }

  if (version === 'v3' && registration.v3User && registration.v3User.level !== 'authPriv') {
    warnings.push(
      `[SECURITY] Sender ${registration.senderIp} uses SNMPv3 with level '${registration.v3User.level}'. Encrypted 'authPriv' is recommended per RFC 3414.`
    );
  }

  return warnings;
}

/**
 * Creates an immutable sender lookup map from registrations.
 */
export function createSenderRegistry(
  registrations: ReadonlyArray<SnmpSenderRegistration>,
): SnmpSenderRegistry {
  const map = new Map<string, SnmpSenderRegistration>();
  for (const reg of registrations) {
    map.set(reg.senderIp.trim(), { ...reg });
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
