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

  it('recognizes FiberHome GPON ONT Loss of Signal, Dying Gasp, and recovery traps', () => {
    const fhLos = lookupTrapDefinition('1.3.6.1.4.1.3807.1.3.1.1.1');
    expect(fhLos.category).toBe('los');
    expect(fhLos.severity).toBe('critical');
    expect(fhLos.vendor).toBe('Fiberhome');

    const fhDyingGasp = lookupTrapDefinition('1.3.6.1.4.1.3807.1.3.1.1.2');
    expect(fhDyingGasp.category).toBe('dying_gasp');
    expect(fhDyingGasp.severity).toBe('critical');

    const fhOnline = lookupTrapDefinition('1.3.6.1.4.1.3807.1.3.1.1.4');
    expect(fhOnline.category).toBe('onu_online');
    expect(fhOnline.is_clear).toBe(true);
    expect(fhOnline.clears_trap_oid).toBe('1.3.6.1.4.1.3807.1.3.1.1.3');

    const fhLosClear = lookupTrapDefinition('1.3.6.1.4.1.3807.1.3.1.1.5');
    expect(fhLosClear.category).toBe('los_clear');
    expect(fhLosClear.is_clear).toBe(true);

    const fhPortDown = lookupTrapDefinition('1.3.6.1.4.1.3807.1.3.1.2.1');
    expect(fhPortDown.category).toBe('pon_down');

    const fhCardFault = lookupTrapDefinition('1.3.6.1.4.1.3807.1.1.1.1');
    expect(fhCardFault.category).toBe('card_failure');
  });

  it('recognizes Nokia 7360 ISAM & Lightspan GPON and recovery traps', () => {
    const nokiaLos = lookupTrapDefinition('1.3.6.1.4.1.637.61.1.36.1.1.1');
    expect(nokiaLos.category).toBe('los');
    expect(nokiaLos.severity).toBe('critical');
    expect(nokiaLos.vendor).toBe('Nokia');

    const nokiaDyingGasp = lookupTrapDefinition('1.3.6.1.4.1.637.61.1.36.1.1.2');
    expect(nokiaDyingGasp.category).toBe('dying_gasp');
    expect(nokiaDyingGasp.severity).toBe('critical');

    const nokiaOnline = lookupTrapDefinition('1.3.6.1.4.1.637.61.1.36.1.1.4');
    expect(nokiaOnline.category).toBe('onu_online');
    expect(nokiaOnline.is_clear).toBe(true);
    expect(nokiaOnline.clears_trap_oid).toBe('1.3.6.1.4.1.637.61.1.36.1.1.3');

    const nokiaPortDown = lookupTrapDefinition('1.3.6.1.4.1.637.61.1.36.2.1.1');
    expect(nokiaPortDown.category).toBe('pon_down');

    const nokiaPortUp = lookupTrapDefinition('1.3.6.1.4.1.637.61.1.36.2.1.2');
    expect(nokiaPortUp.category).toBe('pon_up');
    expect(nokiaPortUp.is_clear).toBe(true);

    const nokiaCard = lookupTrapDefinition('1.3.6.1.4.1.637.61.1.3.1.1.1');
    expect(nokiaCard.category).toBe('card_failure');

    const lightspanPortDown = lookupTrapDefinition('1.3.6.1.4.1.6527.3.1.2.2.4.3');
    expect(lightspanPortDown.category).toBe('pon_down');
    expect(lightspanPortDown.vendor).toBe('Nokia');
  });

  it('recognizes Calix E7 alarm, system, and recovery traps', () => {
    const calixAlarm = lookupTrapDefinition('1.3.6.1.4.1.6321.1.2.2.4.2.1');
    expect(calixAlarm.vendor).toBe('Calix');
    expect(calixAlarm.name).toBe('e7TrapAlarm');
    expect(calixAlarm.severity).toBe('critical');

    const calixClear = lookupTrapDefinition('1.3.6.1.4.1.6321.1.2.2.4.2.10');
    expect(calixClear.category).toBe('los_clear');
    expect(calixClear.is_clear).toBe(true);
    expect(calixClear.clears_trap_oid).toBe('1.3.6.1.4.1.6321.1.2.2.4.2.1');

    const calixDb = lookupTrapDefinition('1.3.6.1.4.1.6321.1.2.2.4.2.3');
    expect(calixDb.category).toBe('config_change');
  });

  it('recognizes Adtran TA5000 GPON ONT, PON, and recovery traps', () => {
    const adtranLos = lookupTrapDefinition('1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.1');
    expect(adtranLos.vendor).toBe('Adtran');
    expect(adtranLos.category).toBe('los');
    expect(adtranLos.severity).toBe('critical');

    const adtranDyingGasp = lookupTrapDefinition('1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.38');
    expect(adtranDyingGasp.category).toBe('dying_gasp');
    expect(adtranDyingGasp.severity).toBe('critical');

    const adtranOmciFail = lookupTrapDefinition('1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.25');
    expect(adtranOmciFail.category).toBe('onu_offline');
    expect(adtranOmciFail.severity).toBe('warning');

    const adtranPonDown = lookupTrapDefinition('1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.5');
    expect(adtranPonDown.category).toBe('pon_down');

    const adtranPonUp = lookupTrapDefinition('1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.6');
    expect(adtranPonUp.category).toBe('pon_up');
    expect(adtranPonUp.is_clear).toBe(true);

    const adtranOnline = lookupTrapDefinition('1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.26');
    expect(adtranOnline.category).toBe('onu_online');
    expect(adtranOnline.is_clear).toBe(true);

    const adtranLosClear = lookupTrapDefinition('1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.2');
    expect(adtranLosClear.category).toBe('los_clear');
    expect(adtranLosClear.is_clear).toBe(true);
  });

  it('recognizes VSOL V1600 GPON and recovery traps', () => {
    const vsolLos = lookupTrapDefinition('1.3.6.1.4.1.37950.5.1.1.2');
    expect(vsolLos.category).toBe('los');
    expect(vsolLos.severity).toBe('critical');
    expect(vsolLos.vendor).toBe('VSOL');

    const vsolDyingGasp = lookupTrapDefinition('1.3.6.1.4.1.37950.5.1.1.1');
    expect(vsolDyingGasp.category).toBe('dying_gasp');
    expect(vsolDyingGasp.severity).toBe('critical');

    const vsolOnline = lookupTrapDefinition('1.3.6.1.4.1.37950.5.1.1.3');
    expect(vsolOnline.category).toBe('onu_online');
    expect(vsolOnline.is_clear).toBe(true);

    const vsolPortDown = lookupTrapDefinition('1.3.6.1.4.1.37950.5.1.2.1');
    expect(vsolPortDown.category).toBe('pon_down');

    const vsolPortUp = lookupTrapDefinition('1.3.6.1.4.1.37950.5.1.2.2');
    expect(vsolPortUp.category).toBe('pon_up');
    expect(vsolPortUp.is_clear).toBe(true);
  });

  it('recognizes BDCOM P3600 GPON and recovery traps (NMS-GPON-MIB)', () => {
    const bdcomLos = lookupTrapDefinition('1.3.6.1.4.1.3320.101.10.0.2');
    expect(bdcomLos.category).toBe('los');
    expect(bdcomLos.severity).toBe('critical');
    expect(bdcomLos.vendor).toBe('BDCOM');

    const bdcomDyingGasp = lookupTrapDefinition('1.3.6.1.4.1.3320.101.10.0.1');
    expect(bdcomDyingGasp.category).toBe('dying_gasp');
    expect(bdcomDyingGasp.severity).toBe('critical');

    const bdcomOnline = lookupTrapDefinition('1.3.6.1.4.1.3320.101.10.0.3');
    expect(bdcomOnline.category).toBe('onu_online');
    expect(bdcomOnline.is_clear).toBe(true);

    const bdcomPonDown = lookupTrapDefinition('1.3.6.1.4.1.3320.101.10.0.5');
    expect(bdcomPonDown.category).toBe('pon_down');

    const bdcomPonUp = lookupTrapDefinition('1.3.6.1.4.1.3320.101.10.0.6');
    expect(bdcomPonUp.category).toBe('pon_up');
    expect(bdcomPonUp.is_clear).toBe(true);
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
