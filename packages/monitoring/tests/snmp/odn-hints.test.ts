import { describe, expect, it } from 'vitest';
import { extractOdnHints } from '../../src/snmp/adapter/odn-hints';
import type { DecodedSnmpNotification } from '../../src/snmp/types';

function makeNotification(varbinds: Array<{ oid: string; value: string | number }>): DecodedSnmpNotification {
  return {
    version: 'v2c',
    pduType: 'TrapV2',
    senderIp: '10.100.1.10',
    senderPort: 162,
    trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1',
    receivedAtMs: 1773316800000,
    varbinds: varbinds.map((v) => ({
      oid: v.oid,
      type: 'OctetString',
      value: v.value,
    })),
  };
}

describe('ODN Hint Extractor', () => {
  it('extracts a CTO hint from a varbind value matching CTO pattern', () => {
    const notif = makeNotification([
      { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.50.1', value: 'CTO-NORTE-12' },
    ]);

    const hints = extractOdnHints(notif);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.kind).toBe('CTO');
    expect(hints[0]?.candidateId).toBe('CTO-NORTE-12');
    expect(hints[0]?.confidence).toBe('high');
    expect(hints[0]?.evidence.oid).toBe('1.3.6.1.4.1.2011.6.128.1.1.2.43.50.1');
  });

  it('extracts a Splitter hint from splitter-related OID', () => {
    const notif = makeNotification([
      { oid: '1.3.6.1.4.1.2011.6.128.10.50.1.splitter.1', value: 'SPL-1234' },
    ]);

    const hints = extractOdnHints(notif);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.kind).toBe('SPLITTER');
    expect(hints[0]?.candidateId).toBe('SPL-1234');
  });

  it('extracts a NAP hint from ODB-style value', () => {
    const notif = makeNotification([
      { oid: '1.3.6.1.4.1.2011.6.128.10.60.1', value: 'ODB-CENTRO-01' },
    ]);

    const hints = extractOdnHints(notif);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.kind).toBe('NAP');
  });

  it('returns empty array when no ODN reference is present', () => {
    const notif = makeNotification([
      { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1', value: 'ZTEGC12345678' },
      { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2', value: 42 },
    ]);

    const hints = extractOdnHints(notif);
    expect(hints).toHaveLength(0);
  });

  it('does not invent components when varbind values are unrelated', () => {
    const notif = makeNotification([
      { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1', value: 'some random text' },
    ]);

    const hints = extractOdnHints(notif);
    expect(hints).toHaveLength(0);
  });

  it('deduplicates repeated hints for the same component', () => {
    const notif = makeNotification([
      { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.50.1', value: 'CTO-NORTE-12' },
      { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.50.2', value: 'CTO-NORTE-12' },
    ]);

    const hints = extractOdnHints(notif);
    expect(hints).toHaveLength(1);
  });

  it('handles FAT (Fiber Access Terminal) values', () => {
    const notif = makeNotification([
      { oid: '1.3.6.1.4.1.2011.6.128.10.70.1', value: 'FAT-SUR-03' },
    ]);

    const hints = extractOdnHints(notif);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.kind).toBe('CTO');
    expect(hints[0]?.candidateId).toBe('FAT-SUR-03');
  });
});
