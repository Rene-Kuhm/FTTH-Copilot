import { describe, it, expect } from 'vitest';
import { parseSyslogMessage } from '../src/syslog';

describe('parseSyslogMessage', () => {
  it('parses a full RFC3164 line', () => {
    const line = '<134>Aug 30 10:00:00 olt-01 sshd[1234]: Failed password for admin from 1.2.3.4 port 22 ssh2';
    const ev = parseSyslogMessage(line);
    expect(ev).not.toBeNull();
    expect(ev!.priority).toBe(134);
    expect(ev!.facility).toBe(16); // local0
    expect(ev!.severity).toBe(6); // informational
    expect(ev!.timestamp).toBe('Aug 30 10:00:00');
    expect(ev!.hostname).toBe('olt-01');
    expect(ev!.tag).toBe('sshd[1234]');
    expect(ev!.message).toBe('Failed password for admin from 1.2.3.4 port 22 ssh2');
  });

  it('parses a minimal line with only PRI and a single-token message', () => {
    const ev = parseSyslogMessage('<13>somemessage');
    expect(ev).not.toBeNull();
    expect(ev!.facility).toBe(1); // user
    expect(ev!.severity).toBe(5); // notice
    expect(ev!.timestamp).toBeNull();
    expect(ev!.hostname).toBeNull();
    expect(ev!.tag).toBeNull();
    expect(ev!.message).toBe('somemessage');
  });

  it('returns null for a line without a PRI prefix', () => {
    expect(parseSyslogMessage('no priority here')).toBeNull();
  });

  it('returns null for an invalid PRI', () => {
    expect(parseSyslogMessage('<abc>message')).toBeNull();
    expect(parseSyslogMessage('<999>message')).toBeNull();
  });

  it('parses a line without a timestamp', () => {
    const ev = parseSyslogMessage('<86>router-01 interface GigabitEthernet0/1 changed state to up');
    expect(ev).not.toBeNull();
    expect(ev!.facility).toBe(10); // security/auth
    expect(ev!.severity).toBe(6);
    expect(ev!.hostname).toBe('router-01');
    expect(ev!.tag).toBeNull(); // no "tag:" colon in this message
    expect(ev!.message).toBe('interface GigabitEthernet0/1 changed state to up');
  });

  it('parses a tag without a message body', () => {
    const ev = parseSyslogMessage('<14>host sshd:');
    expect(ev).not.toBeNull();
    expect(ev!.hostname).toBe('host');
    expect(ev!.tag).toBe('sshd');
    expect(ev!.message).toBe('');
  });
});
