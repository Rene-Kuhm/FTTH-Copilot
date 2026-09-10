import { describe, expect, it } from 'vitest';
import {
  extractIfMibVarbinds,
  mapIfAdminStatus,
  mapIfOperStatus,
} from '../../src/snmp/extractors/if-mib';

describe('IF-MIB Extractor (RFC 2863)', () => {
  it('maps admin and operational status integer codes to symbolic names', () => {
    expect(mapIfAdminStatus(1)).toBe('up');
    expect(mapIfAdminStatus(2)).toBe('down');
    expect(mapIfAdminStatus(3)).toBe('testing');
    expect(mapIfAdminStatus(99)).toBe('unknown');

    expect(mapIfOperStatus(1)).toBe('up');
    expect(mapIfOperStatus(2)).toBe('down');
    expect(mapIfOperStatus(3)).toBe('testing');
    expect(mapIfOperStatus(4)).toBe('unknown');
    expect(mapIfOperStatus(5)).toBe('dormant');
    expect(mapIfOperStatus(6)).toBe('notPresent');
    expect(mapIfOperStatus(7)).toBe('lowerLayerDown');
    expect(mapIfOperStatus(99)).toBe('unknown');
  });

  it('extracts complete IF-MIB varbinds from standard linkDown trap', () => {
    const varbinds = [
      { oid: '1.3.6.1.2.1.2.2.1.1.14', value: 14 },
      { oid: '1.3.6.1.2.1.2.2.1.7.14', value: 1 },
      { oid: '1.3.6.1.2.1.2.2.1.8.14', value: 2 },
      { oid: '1.3.6.1.2.1.2.2.1.2.14', value: 'GigabitEthernet0/1/14' },
      { oid: '1.3.6.1.2.1.31.1.1.1.1.14', value: 'ge-0/1/14' },
      { oid: '1.3.6.1.2.1.31.1.1.1.18.14', value: 'Uplink-Core-Switch-A' },
    ];

    const extracted = extractIfMibVarbinds(varbinds);
    expect(extracted.ifIndex).toBe(14);
    expect(extracted.ifAdminStatus).toBe('up');
    expect(extracted.ifAdminStatusCode).toBe(1);
    expect(extracted.ifOperStatus).toBe('down');
    expect(extracted.ifOperStatusCode).toBe(2);
    expect(extracted.ifDescr).toBe('GigabitEthernet0/1/14');
    expect(extracted.ifName).toBe('ge-0/1/14');
    expect(extracted.ifAlias).toBe('Uplink-Core-Switch-A');
  });

  it('extracts ifIndex from OID instance suffix when explicit ifIndex varbind is absent', () => {
    const varbinds = [
      { oid: '1.3.6.1.2.1.2.2.1.8.42', value: 2 },
      { oid: '1.3.6.1.2.1.31.1.1.1.1.42', value: 'pon-0/2/1' },
    ];

    const extracted = extractIfMibVarbinds(varbinds);
    expect(extracted.ifIndex).toBe(42);
    expect(extracted.ifOperStatus).toBe('down');
    expect(extracted.ifName).toBe('pon-0/2/1');
  });

  it('handles empty or non-IF-MIB varbinds gracefully', () => {
    const varbinds = [
      { oid: '1.3.6.1.4.1.2011.6.128.1.1.1', value: 'something' },
    ];

    const extracted = extractIfMibVarbinds(varbinds);
    expect(extracted.ifIndex).toBeUndefined();
    expect(extracted.ifOperStatus).toBeUndefined();
  });
});
