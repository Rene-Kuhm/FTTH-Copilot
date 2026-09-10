import { describe, expect, it } from 'vitest';
import {
  extractEnterprisePen,
  resolveVendorByPen,
  resolveVendorByOid,
  isStandardOid,
  IANA_VENDOR_REGISTRY,
} from '../../src/snmp/iana-pen';

describe('IANA Private Enterprise Numbers Registry (Roadmap Fase 1)', () => {
  it('extracts integer PEN from enterprise OID', () => {
    expect(extractEnterprisePen('1.3.6.1.4.1.2011.6.128')).toBe(2011);
    expect(extractEnterprisePen('1.3.6.1.4.1.3902')).toBe(3902);
    expect(extractEnterprisePen('.1.3.6.1.4.1.637.1')).toBe(637);
    expect(extractEnterprisePen('1.3.6.1.2.1.1.3.0')).toBeNull(); // standard mib-2
    expect(extractEnterprisePen('invalid.oid')).toBeNull();
  });

  it('resolves all 12 target vendors from their registered PENs', () => {
    const expected = [
      { pen: 2011, vendor: 'Huawei', priority: 'P0' },
      { pen: 3902, vendor: 'ZTE', priority: 'P0' },
      { pen: 637, vendor: 'Nokia', priority: 'P0' },
      { pen: 6527, vendor: 'Nokia', priority: 'P0' },
      { pen: 3807, vendor: 'FiberHome', priority: 'P0' },
      { pen: 6321, vendor: 'Calix', priority: 'P1' },
      { pen: 1264, vendor: 'Calix', priority: 'P1' },
      { pen: 664, vendor: 'Adtran', priority: 'P1' },
      { pen: 5504, vendor: 'DZS', priority: 'P1' },
      { pen: 5597, vendor: 'DZS', priority: 'P1' },
      { pen: 6296, vendor: 'DZS', priority: 'P1' },
      { pen: 890, vendor: 'Zyxel', priority: 'P1' },
      { pen: 37950, vendor: 'VSOL', priority: 'P1' },
      { pen: 34592, vendor: 'C-Data', priority: 'P1' },
      { pen: 3320, vendor: 'BDCOM', priority: 'P2' },
      { pen: 41112, vendor: 'Ubiquiti', priority: 'P2' },
    ];

    for (const exp of expected) {
      const record = resolveVendorByPen(exp.pen);
      expect(record, `Failed resolving PEN ${exp.pen}`).not.toBeNull();
      expect(record?.displayName).toBe(exp.vendor);
      expect(record?.priority).toBe(exp.priority);
    }
  });

  it('resolves vendor from complete enterprise OID', () => {
    const huawei = resolveVendorByOid('1.3.6.1.4.1.2011.6.128.1.1.2.43');
    expect(huawei?.displayName).toBe('Huawei');

    const zte = resolveVendorByOid('1.3.6.1.4.1.3902.1082.500.1.2.3');
    expect(zte?.displayName).toBe('ZTE');

    const uncataloged = resolveVendorByOid('1.3.6.1.4.1.999999.1');
    expect(uncataloged).toBeNull();
  });

  it('prevents free-text vendor guessing on standard OIDs', () => {
    // sysUpTime and linkDown must not resolve to any vendor
    expect(resolveVendorByOid('1.3.6.1.2.1.1.3.0')).toBeNull();
    expect(resolveVendorByOid('1.3.6.1.6.3.1.1.5.3')).toBeNull();
    expect(isStandardOid('1.3.6.1.2.1.2.2.1.1')).toBe(true);
    expect(isStandardOid('1.3.6.1.6.3.1.1.4.1.0')).toBe(true);
    expect(isStandardOid('1.3.6.1.4.1.2011.1')).toBe(false);
  });
});
