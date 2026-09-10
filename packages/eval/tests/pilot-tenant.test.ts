import { describe, expect, it } from 'vitest';
import {
  evaluatePilotFeatureAccess,
  pilotTenantConfigSchema,
  type PilotTenantConfig,
} from '../src/pilot-tenant';

describe('Pilot Tenant Authorization & Progressive Feature Enablement (Roadmap Fase 7 — 7.1)', () => {
  const authorizedConfig: PilotTenantConfig = {
    schema: 'ftth.pilot-tenant-config.v1',
    tenantId: 'tenant-pilot-alpha',
    pilotAuthorized: true,
    progressiveFeatures: {
      cognitiveInvestigation: true,
      snmpTraps: false, // progressive rollout: traps disabled initially
      autoEnrichment: true,
    },
    emergencyFallbackProcedure: 'docs/operations/pilot-sop-and-fallback.md',
    pilotStartedAt: '2026-09-10T00:00:00.000Z',
  };

  it('validates schema correctly against zod', () => {
    const parsed = pilotTenantConfigSchema.parse(authorizedConfig);
    expect(parsed.tenantId).toBe('tenant-pilot-alpha');
    expect(parsed.pilotAuthorized).toBe(true);
  });

  it('allows access to enabled progressive features for authorized tenant', () => {
    const decision = evaluatePilotFeatureAccess(authorizedConfig, 'cognitiveInvestigation');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeUndefined();
  });

  it('rejects access to unenabled progressive features and points to fallback SOP', () => {
    const decision = evaluatePilotFeatureAccess(authorizedConfig, 'snmpTraps');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('is disabled in progressive rollout');
    expect(decision.fallbackProcedure).toBe('docs/operations/pilot-sop-and-fallback.md');
  });

  it('rejects all features when tenant is not authorized for pilot', () => {
    const unauthorizedConfig: PilotTenantConfig = {
      ...authorizedConfig,
      tenantId: 'tenant-unauthorized',
      pilotAuthorized: false,
    };

    const decision = evaluatePilotFeatureAccess(unauthorizedConfig, 'cognitiveInvestigation');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('is not authorized');
    expect(decision.fallbackProcedure).toBe('docs/operations/pilot-sop-and-fallback.md');
  });
});
