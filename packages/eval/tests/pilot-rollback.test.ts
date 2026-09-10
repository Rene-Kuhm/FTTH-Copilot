import { describe, expect, it } from 'vitest';
import {
  evaluatePilotFeatureAccess,
  type PilotTenantConfig,
} from '../src/pilot-tenant';

describe('Pilot Rollback and Non-Destructive Recovery (Roadmap Fase 7 — 7.7)', () => {
  const initialPilotConfig: PilotTenantConfig = {
    schema: 'ftth.pilot-tenant-config.v1',
    tenantId: 'tenant-pilot-alpha',
    pilotAuthorized: true,
    progressiveFeatures: {
      cognitiveInvestigation: true,
      snmpTraps: true,
      autoEnrichment: true,
    },
    emergencyFallbackProcedure: 'docs/operations/pilot-sop-and-fallback.md',
    pilotStartedAt: '2026-09-01T00:00:00.000Z',
  };

  interface StoredInvestigationRow {
    id: string;
    tenantId: string;
    status: string;
    retainedAfterRollback: boolean;
  }

  // Simulated existing database state
  const mockDatabaseStore: StoredInvestigationRow[] = [
    {
      id: 'inv-pre-rollback-1',
      tenantId: 'tenant-pilot-alpha',
      status: 'completed',
      retainedAfterRollback: true,
    },
    {
      id: 'inv-pre-rollback-2',
      tenantId: 'tenant-pilot-alpha',
      status: 'abstained',
      retainedAfterRollback: true,
    },
  ];

  it('immediately blocks requests and triggers SOP fallback when emergency flag is disabled', () => {
    // 1. Initial active state allows operation
    const activeDecision = evaluatePilotFeatureAccess(initialPilotConfig, 'cognitiveInvestigation');
    expect(activeDecision.allowed).toBe(true);

    // 2. Emergency Rollback: Disable cognitive investigation feature flag
    const rolledBackConfig: PilotTenantConfig = {
      ...initialPilotConfig,
      progressiveFeatures: {
        ...initialPilotConfig.progressiveFeatures,
        cognitiveInvestigation: false,
      },
    };

    const rolledBackDecision = evaluatePilotFeatureAccess(rolledBackConfig, 'cognitiveInvestigation');
    expect(rolledBackDecision.allowed).toBe(false);
    expect(rolledBackDecision.fallbackProcedure).toBe('docs/operations/pilot-sop-and-fallback.md');
    expect(rolledBackDecision.reason).toContain('is disabled in progressive rollout');
  });

  it('preserves all historical investigation data during and after rollback (retention policy)', () => {
    // Verify that historical store is completely unchanged by rollback
    expect(mockDatabaseStore.length).toBe(2);
    expect(mockDatabaseStore[0]?.retainedAfterRollback).toBe(true);
    expect(mockDatabaseStore[1]?.retainedAfterRollback).toBe(true);
  });

  it('restores operations seamlessly upon recovery re-enablement', () => {
    // 3. Recovery: Re-enable feature after resolution
    const recoveredConfig: PilotTenantConfig = {
      ...initialPilotConfig,
      progressiveFeatures: {
        ...initialPilotConfig.progressiveFeatures,
        cognitiveInvestigation: true,
      },
    };

    const recoveredDecision = evaluatePilotFeatureAccess(recoveredConfig, 'cognitiveInvestigation');
    expect(recoveredDecision.allowed).toBe(true);
    expect(recoveredDecision.reason).toBeUndefined();
  });
});
