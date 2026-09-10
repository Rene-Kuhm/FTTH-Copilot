/**
 * Pilot Tenant Authorization and Progressive Feature Enablement (Roadmap Fase 7 — 7.1).
 *
 * 7.1: "Elegir un tenant piloto autorizado y habilitar funciones de forma progresiva.
 *       Mantener procedimiento operativo manual de respaldo."
 */

import { z } from 'zod';

export const PILOT_TENANT_CONFIG_SCHEMA = 'ftth.pilot-tenant-config.v1' as const;

export const pilotProgressiveFeaturesSchema = z
  .object({
    cognitiveInvestigation: z.boolean(),
    snmpTraps: z.boolean(),
    autoEnrichment: z.boolean(),
  })
  .strict();

export type PilotProgressiveFeatures = z.infer<typeof pilotProgressiveFeaturesSchema>;

export const pilotTenantConfigSchema = z
  .object({
    schema: z.literal(PILOT_TENANT_CONFIG_SCHEMA),
    tenantId: z.string().min(1),
    pilotAuthorized: z.boolean(),
    progressiveFeatures: pilotProgressiveFeaturesSchema,
    emergencyFallbackProcedure: z.string().min(1),
    pilotStartedAt: z.string().datetime().optional(),
  })
  .strict();

export type PilotTenantConfig = z.infer<typeof pilotTenantConfigSchema>;

export interface FeatureAccessDecision {
  allowed: boolean;
  reason?: string;
  fallbackProcedure?: string;
}

/**
 * Evaluates whether a given feature is allowed for the tenant under pilot governance.
 */
export function evaluatePilotFeatureAccess(
  config: PilotTenantConfig,
  feature: keyof PilotProgressiveFeatures,
): FeatureAccessDecision {
  if (!config.pilotAuthorized) {
    return {
      allowed: false,
      reason: `Tenant '${config.tenantId}' is not authorized for cognitive pilot operations`,
      fallbackProcedure: config.emergencyFallbackProcedure,
    };
  }

  if (!config.progressiveFeatures[feature]) {
    return {
      allowed: false,
      reason: `Feature '${feature}' is disabled in progressive rollout for tenant '${config.tenantId}'`,
      fallbackProcedure: config.emergencyFallbackProcedure,
    };
  }

  return {
    allowed: true,
  };
}
