import { describe, it, expect } from 'vitest';
import { classifyEvent } from '../src/classify';
import { parseSyslogMessage } from '../src/syslog';

function classify(line: string) {
  const ev = parseSyslogMessage(line);
  expect(ev).not.toBeNull();
  return classifyEvent(ev!);
}

describe('classifyEvent', () => {
  it('classifies failed auth as auth_failure', () => {
    expect(classify('<86>sshd[1]: Failed password for admin')).toBe('auth_failure');
    expect(classify('<86>sshd[1]: invalid user root')).toBe('auth_failure');
    expect(classify('<86>sshd[1]: authentication failure')).toBe('auth_failure');
  });

  it('classifies successful logins as access', () => {
    expect(classify('<86>sshd[1]: Accepted publickey for admin')).toBe('access');
    expect(classify('<86>login[1]: session opened for user root')).toBe('access');
  });

  it('looks for a user entry on the same line', () => {
    const event = parseSyslogMessage('<86>host cli: idle')!;
    expect(classifyEvent({ ...event, message: 'User Ada\nentered' })).toBe('other');
    expect(classifyEvent({ ...event, message: 'User Ada\u2028 entered' })).toBe('other');
    expect(classifyEvent({ ...event, message: 'User entered' })).toBe('other');

    const message = `USER ${'a'.repeat(50_000)} ENTERED`;
    const start = performance.now();
    const category = classifyEvent({ ...event, message });
    const elapsed = performance.now() - start;

    expect(category).toBe('access');
    expect(elapsed).toBeLessThan(15);
  });

  it('classifies config changes as config_change', () => {
    expect(classify('<86>cli[1]: configure terminal')).toBe('config_change');
    expect(classify('<86>cli[1]: commit confirmed')).toBe('config_change');
    expect(classify('<86>cli[1]: write memory')).toBe('config_change');
  });

  it('classifies unknown messages as other', () => {
    expect(classify('<86>system[1]: temperature 42C')).toBe('other');
    expect(classify('<86>ntp[1]: clock synchronized')).toBe('other');
  });

  it('prefers auth_failure over access for ambiguous text', () => {
    // "password" appears in both failed and accepted contexts; failure wins.
    expect(classify('<86>sshd[1]: Failed password accepted')).toBe('auth_failure');
  });
});
