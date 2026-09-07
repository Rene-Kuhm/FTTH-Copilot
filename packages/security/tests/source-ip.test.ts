import { describe, expect, it } from 'vitest';
import { extractSourceIpFromMessage } from '../src/source-ip';

describe('extractSourceIpFromMessage', () => {
  it.each([
    ['Failed password for root from 1.2.3.4 port 22 ssh2', '1.2.3.4'],
    ['auth failure; user=root from 192.168.1.50', '192.168.1.50'],
    ['Accepted publickey for admin from 10.0.0.5', '10.0.0.5'],
    ['from 8.8.8.8 dns query', '8.8.8.8'],
    ['User logged in from 255.255.255.255', '255.255.255.255'],
    ['1.2.3.4 and 5.6.7.8 attempted', '1.2.3.4'], // first match wins
  ])('extracts the IPv4 from %s', (message: string, expected: string) => {
    expect(extractSourceIpFromMessage(message)).toBe(expected);
  });

  it.each([
    'no ip here',
    'ipv6 only ::1',
    '256.1.1.1 invalid',
    '999.999.999.999 not valid',
    '',
  ])('returns the fallback when %s has no valid IPv4', (message: string) => {
    expect(extractSourceIpFromMessage(message, '1.1.1.1')).toBe('1.1.1.1');
  });

  it('returns null when no IP is found and no fallback is supplied', () => {
    expect(extractSourceIpFromMessage('no ip here')).toBeNull();
  });

  it('returns null when called with empty string and no fallback', () => {
    expect(extractSourceIpFromMessage('')).toBeNull();
  });

  it('regression: distinct IPs in distinct messages produce distinct sources', () => {
    // The bug report:
    //   "intentos desde distintas IP contra un mismo router pueden
    //    atribuirse a una sola fuente".
    // The previous implementation stored the sender hostname as
    // sourceIp, so all four lines below would have collapsed into the
    // single hostname-keyed bucket. With message-based extraction,
    // each line has its own sourceIp and the detectors will group them
    // separately.
    const msgs = [
      'edge-01 Failed password for root from 1.2.3.4 port 22 ssh2',
      'edge-01 Failed password for root from 5.6.7.8 port 22 ssh2',
      'edge-01 Failed password for root from 9.10.11.12 port 22 ssh2',
      'edge-01 Failed password for root from 13.14.15.16 port 22 ssh2',
    ];
    const ips = msgs.map((m) => extractSourceIpFromMessage(m));
    expect(ips).toEqual(['1.2.3.4', '5.6.7.8', '9.10.11.12', '13.14.15.16']);
    expect(new Set(ips).size).toBe(4); // all distinct
  });

  it('does not extract the IP from a hostname-like token', () => {
    // "from" is a common token in syslog messages, but a hostname
    // like "edge-01" or "router.lan" must NOT be confused for an IP.
    expect(extractSourceIpFromMessage('edge-01 some log line')).toBeNull();
    expect(extractSourceIpFromMessage('router.lan: foo bar baz')).toBeNull();
  });

  it('boundary: octets at the edge of the valid range', () => {
    expect(extractSourceIpFromMessage('from 0.0.0.0 test')).toBe('0.0.0.0');
    expect(extractSourceIpFromMessage('from 255.255.255.255 test')).toBe('255.255.255.255');
  });

  it('does not over-match when the candidate IP is embedded in a longer token', () => {
    // The `\b` boundary prevents "1.2.3.456" from being picked up as
    // "1.2.3.4" (456 is past 255). Pin current behavior.
    expect(extractSourceIpFromMessage('id=1.2.3.456 invalid')).toBeNull();
  });

  it('fallback chain: ip in message > rinfo.address > null', () => {
    expect(extractSourceIpFromMessage('from 1.2.3.4', '9.9.9.9')).toBe('1.2.3.4');
    expect(extractSourceIpFromMessage('no ip', '9.9.9.9')).toBe('9.9.9.9');
    expect(extractSourceIpFromMessage('no ip')).toBeNull();
    expect(extractSourceIpFromMessage('no ip', null)).toBeNull();
  });
});
