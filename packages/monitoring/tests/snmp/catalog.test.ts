import { describe, expect, it } from 'vitest';
import {
  lookupTrapDefinition,
  isKnownTrapOid,
  KNOWN_TRAP_DEFINITIONS,
  validateCatalogAdmission,
  type SnmpTrapCategory,
} from '../../src/snmp/catalog';

describe('SNMP Trap Catalog (Roadmap Fase 6 — 6.1)', () => {
  it('recognizes standard RFC linkDown, linkUp, and start traps', () => {
    const linkDown = lookupTrapDefinition('1.3.6.1.6.3.1.1.5.3');
    expect(linkDown.category).toBe('link_down');
    expect(linkDown.severity).toBe('warning');
    expect(linkDown.source_id).toBe('rfc-2863-if-mib');

    const linkUp = lookupTrapDefinition('1.3.6.1.6.3.1.1.5.4');
    expect(linkUp.category).toBe('link_up');
    expect(linkUp.severity).toBe('info');
    expect(linkUp.source_id).toBe('rfc-2863-if-mib');

    const coldStart = lookupTrapDefinition('1.3.6.1.6.3.1.1.5.1');
    expect(coldStart.category).toBe('restart');
    expect(coldStart.severity).toBe('info');

    const authFailure = lookupTrapDefinition('1.3.6.1.6.3.1.1.5.5');
    expect(authFailure.category).toBe('auth_failure');
    expect(authFailure.severity).toBe('warning');
    expect(authFailure.name).toBe('authenticationFailure');

    const entConfig = lookupTrapDefinition('1.3.6.1.2.1.47.2.0.1');
    expect(entConfig.category).toBe('config_change');
    expect(entConfig.severity).toBe('info');
    expect(entConfig.name).toBe('entConfigChange');
  });

  it('verifies all known definitions satisfy Gate 1 catalog admission criteria', () => {
    for (const def of KNOWN_TRAP_DEFINITIONS) {
      const result = validateCatalogAdmission(def);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    }
  });

  it('rejects prospective trap definition lacking source_id or with invalid grade', () => {
    const invalidDef = {
      oid: '1.3.6.1.4.1.9999.1.1',
      name: 'badTrap',
      category: 'los' as const,
      severity: 'critical' as const,
      description: 'Def without audit fields',
    };
    const result = validateCatalogAdmission(invalidDef);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('recognizes Huawei GPON ONT Loss of Signal and Dying Gasp traps', () => {
    const huaweiLos = lookupTrapDefinition('1.3.6.1.4.1.2011.6.128.1.1.2.43.1');
    expect(huaweiLos.category).toBe('los');
    expect(huaweiLos.severity).toBe('critical');
    expect(huaweiLos.vendor).toBe('Huawei');

    const huaweiDyingGasp = lookupTrapDefinition('1.3.6.1.4.1.2011.6.128.1.1.2.43.2');
    expect(huaweiDyingGasp.category).toBe('dying_gasp');
    expect(huaweiDyingGasp.severity).toBe('critical');
    expect(huaweiDyingGasp.vendor).toBe('Huawei');
  });

  it('recognizes ZTE GPON ONT Loss of Signal and Dying Gasp traps', () => {
    const zteLos = lookupTrapDefinition('1.3.6.1.4.1.3902.1082.500.10.2.2.1');
    expect(zteLos.category).toBe('los');
    expect(zteLos.severity).toBe('critical');
    expect(zteLos.vendor).toBe('ZTE');

    const zteDyingGasp = lookupTrapDefinition('1.3.6.1.4.1.3902.1082.500.10.2.2.2');
    expect(zteDyingGasp.category).toBe('dying_gasp');
    expect(zteDyingGasp.severity).toBe('critical');
    expect(zteDyingGasp.vendor).toBe('ZTE');
  });

  it('safely handles unknown OIDs without fabricating diagnoses (6.4)', () => {
    const unknownOid = '1.3.6.1.4.1.99999.1.2.3.4';
    expect(isKnownTrapOid(unknownOid)).toBe(false);

    const def = lookupTrapDefinition(unknownOid);
    expect(def.category).toBe('unknown_trap');
    expect(def.severity).toBe('info');
    expect(def.oid).toBe(unknownOid);
    expect(def.name).toBe('unknownTrap');
  });
});
