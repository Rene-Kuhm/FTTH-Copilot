import { describe, expect, it } from 'vitest';
import * as snmp from 'net-snmp';
import { decodeSnmpTrap, formatVarbindValue } from '../../src/snmp/decoder';

describe('SNMP BER Datagram Decoder (Roadmap Fase 0)', () => {
  it('formats varbind values correctly for strings, buffers, numbers, and booleans', () => {
    expect(formatVarbindValue(null)).toBeNull();
    expect(formatVarbindValue(123)).toBe(123);
    expect(formatVarbindValue(true)).toBe(true);
    expect(formatVarbindValue('hello')).toBe('hello');
    expect(formatVarbindValue(Buffer.from('HWTC12345678', 'utf8'))).toBe('HWTC12345678');
    expect(formatVarbindValue(Buffer.from([0x00, 0xff, 0x12]))).toBe('00ff12');
  });

  it('decodes SNMPv1 Trap with generic trap mapping to standard OID', () => {
    const rawTrap = {
      pdu: {
        type: snmp.PduType.Trap,
        enterprise: '1.3.6.1.4.1.2011',
        genericTrap: 2, // linkDown
        specificTrap: 0,
        upTime: 12345,
        varbinds: [
          { oid: '1.3.6.1.2.1.2.2.1.1.1', type: snmp.ObjectType.Integer, value: 1 },
        ],
      },
      rinfo: { address: '192.168.1.10', port: 51234 },
    };

    const decoded = decodeSnmpTrap(rawTrap, { receivedAtMs: 1700000000000 });
    expect(decoded.version).toBe('v1');
    expect(decoded.pduType).toBe('Trap');
    expect(decoded.senderIp).toBe('192.168.1.10');
    expect(decoded.trapOid).toBe('1.3.6.1.6.3.1.1.5.3'); // Standard linkDown
    expect(decoded.sysUpTime).toBe(12345);
    expect(decoded.varbinds).toHaveLength(1);
    expect(decoded.varbinds[0]?.oid).toBe('1.3.6.1.2.1.2.2.1.1.1');
    expect(decoded.varbinds[0]?.value).toBe(1);
  });

  it('decodes SNMPv1 enterprise-specific trap (genericTrap = 6)', () => {
    const rawTrap = {
      pdu: {
        type: snmp.PduType.Trap,
        enterprise: '1.3.6.1.4.1.2011.6',
        genericTrap: 6,
        specificTrap: 42,
        upTime: 5555,
        varbinds: [],
      },
      rinfo: { address: '192.168.1.11', port: 51234 },
    };

    const decoded = decodeSnmpTrap(rawTrap);
    expect(decoded.version).toBe('v1');
    expect(decoded.trapOid).toBe('1.3.6.1.4.1.2011.6.0.42');
    expect(decoded.sysUpTime).toBe(5555);
  });

  it('decodes SNMPv2c TrapV2 separating sysUpTime, trapOid, and payload varbinds', () => {
    const rawTrap = {
      pdu: {
        type: snmp.PduType.TrapV2,
        id: 999,
        varbinds: [
          { oid: '1.3.6.1.2.1.1.3.0', type: snmp.ObjectType.TimeTicks, value: 4321 },
          { oid: '1.3.6.1.6.3.1.1.4.1.0', type: snmp.ObjectType.OID, value: '1.3.6.1.4.1.2011.6.128.1.1.2.43' },
          { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1', type: snmp.ObjectType.OctetString, value: Buffer.from('HWTC12345678') },
          { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2', type: snmp.ObjectType.OctetString, value: '2026-09-10T12:00:00Z' },
        ],
      },
      rinfo: { address: '10.0.0.1', port: 162 },
    };

    const decoded = decodeSnmpTrap(rawTrap);
    expect(decoded.version).toBe('v2c');
    expect(decoded.pduType).toBe('TrapV2');
    expect(decoded.sysUpTime).toBe(4321);
    expect(decoded.trapOid).toBe('1.3.6.1.4.1.2011.6.128.1.1.2.43');
    expect(decoded.eventTime).toBe('2026-09-10T12:00:00Z');
    expect(decoded.varbinds).toHaveLength(2);
    expect(decoded.varbinds[0]?.value).toBe('HWTC12345678');
  });

  it('decodes SNMPv2c InformRequest', () => {
    const rawTrap = {
      pdu: {
        type: snmp.PduType.InformRequest,
        id: 1234,
        varbinds: [
          { oid: '1.3.6.1.2.1.1.3.0', type: snmp.ObjectType.TimeTicks, value: 7777 },
          { oid: '1.3.6.1.6.3.1.1.4.1.0', type: snmp.ObjectType.OID, value: '1.3.6.1.6.3.1.1.5.3' },
        ],
      },
      rinfo: { address: '10.0.0.2', port: 162 },
    };

    const decoded = decodeSnmpTrap(rawTrap);
    expect(decoded.pduType).toBe('InformRequest');
    expect(decoded.requestId).toBe(1234);
    expect(decoded.trapOid).toBe('1.3.6.1.6.3.1.1.5.3');
  });
});
