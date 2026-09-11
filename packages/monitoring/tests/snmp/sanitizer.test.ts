import { describe, it, expect } from 'vitest';
import {
  sanitizeSnmpText,
  sanitizeSnmpObject,
  sanitizeSnmpCapture,
} from '../../src/snmp/sanitizer';

describe('SNMP Capture & Evidence Sanitizer (Roadmap Fase 8)', () => {
  it('redacts common and custom community strings', () => {
    const raw = 'snmpwalk -v2c -c public 10.1.2.3 system\nsnmptrap -v2c -c superPrivateCommunity 10.1.2.3';
    const clean = sanitizeSnmpText(raw, { customCommunities: ['superPrivateCommunity'] });

    expect(clean).not.toContain('public');
    expect(clean).not.toContain('superPrivateCommunity');
    expect(clean).toContain('<REDACTED_COMMUNITY>');
  });

  it('redacts IPv4 addresses without corrupting SNMP OIDs', () => {
    const raw = 'Trap received from 10.200.5.15 on interface 1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14';
    const clean = sanitizeSnmpText(raw, { ipReplacementMode: 'doc-ip' });

    expect(clean).not.toContain('10.200.5.15');
    // Must map to RFC 5737 documentation IP
    expect(clean).toContain('192.0.2.1');
    // Must preserve SNMP OID completely intact!
    expect(clean).toContain('1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14');
  });

  it('redacts IPv4 addresses with token mode', () => {
    const raw = 'Trap from 172.16.40.10 gateway 192.168.1.1';
    const clean = sanitizeSnmpText(raw, { ipReplacementMode: 'token' });

    expect(clean).not.toContain('172.16.40.10');
    expect(clean).not.toContain('192.168.1.1');
    expect(clean).toContain('<REDACTED_IP>');
  });

  it('redacts IPv6 addresses', () => {
    const raw = 'Trap from 2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const clean = sanitizeSnmpText(raw);

    expect(clean).not.toContain('85a3:0000:0000:8a2e');
    expect(clean).toContain('2001:db8::1');
  });

  it('redacts internal domain names and private hostnames', () => {
    const raw = 'Agent host: olt-central-b.isp.mgmt.local port 162';
    const clean = sanitizeSnmpText(raw);

    expect(clean).not.toContain('olt-central-b.isp.mgmt.local');
    expect(clean).toContain('olt-sanitized.isp.example');
  });

  it('redacts customer PPPoE credentials and circuit identifiers', () => {
    const raw = 'Subscriber disconnected: pppoe-user: "user_7483@isp.com", circuit-id: "GPON-01-VLAN-100"';
    const clean = sanitizeSnmpText(raw);

    expect(clean).not.toContain('user_7483@isp.com');
    expect(clean).not.toContain('GPON-01-VLAN-100');
    expect(clean).toContain('<REDACTED_CUSTOMER_ID>');
  });

  it('masks ONT serial numbers preserving vendor prefix by default', () => {
    const raw = 'Alarms on ONUs: HWTC12345678, ZTEGA1B2C3D4, ALCL99887766, FHTT55443322';
    const clean = sanitizeSnmpText(raw);

    expect(clean).toContain('HWTC********');
    expect(clean).toContain('ZTEG********');
    expect(clean).toContain('ALCL********');
    expect(clean).toContain('FHTT********');
    expect(clean).not.toContain('HWTC12345678');
    expect(clean).not.toContain('ZTEGA1B2C3D4');
  });

  it('masks complete serial when preserveVendorSerialPrefix is false', () => {
    const raw = 'ONT serial: HWTC12345678';
    const clean = sanitizeSnmpText(raw, { preserveVendorSerialPrefix: false });

    expect(clean).not.toContain('HWTC');
    expect(clean).toContain('<REDACTED_SERIAL>');
  });

  it('sanitizes structured JSON evidence envelopes', () => {
    const envelope = {
      senderIp: '10.50.1.100',
      community: 'privateCorpCommunity',
      authKey: 'superSecretAuthKey123',
      varbinds: [
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.9', value: 'HWTC98765432' },
        { oid: '1.3.6.1.2.1.1.5.0', value: 'olt-main.branch.corp' },
      ],
    };

    const sanitized = sanitizeSnmpObject(envelope);

    expect(sanitized.senderIp).toBe('192.0.2.1');
    expect(sanitized.community).toBe('<REDACTED_COMMUNITY>');
    expect(sanitized.authKey).toBe('<REDACTED_COMMUNITY>');
    expect(sanitized.varbinds[0]?.value).toBe('HWTC********');
    expect(sanitized.varbinds[1]?.value).toBe('olt-sanitized.isp.example');
  });

  it('auto-detects JSON string in sanitizeSnmpCapture', () => {
    const jsonStr = JSON.stringify({
      senderIp: '10.0.0.1',
      community: 'secret',
      serial: 'ZTEG11223344',
    });

    const output = sanitizeSnmpCapture(jsonStr);
    const parsed = JSON.parse(output);

    expect(parsed.senderIp).toBe('192.0.2.1');
    expect(parsed.community).toBe('<REDACTED_COMMUNITY>');
    expect(parsed.serial).toBe('ZTEG********');
  });
});
