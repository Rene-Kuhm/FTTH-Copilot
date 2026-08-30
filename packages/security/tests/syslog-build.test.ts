import { describe, expect, it } from 'vitest';
import { buildSyslogMessage, buildSocScenarioMessages } from '../src/syslog-build';
import { parseSyslogMessage } from '../src/syslog';
import { classifyEvent } from '../src/classify';

describe('buildSyslogMessage', () => {
  it('round-trips through parseSyslogMessage', () => {
    const line = buildSyslogMessage({
      priority: 13,
      hostname: 'edge-01',
      tag: 'sshd',
      message: 'Failed password for root from 203.0.113.5 port 22 ssh2',
    });
    const parsed = parseSyslogMessage(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.priority).toBe(13);
    expect(parsed?.hostname).toBe('edge-01');
    expect(parsed?.tag).toBe('sshd');
    expect(parsed?.message).toBe('Failed password for root from 203.0.113.5 port 22 ssh2');
  });

  it('omits optional fields when absent', () => {
    const line = buildSyslogMessage({ priority: 5, message: 'reboot' });
    expect(parseSyslogMessage(line)?.message).toBe('reboot');
    expect(parseSyslogMessage(line)?.hostname).toBeNull();
  });
});

describe('buildSocScenarioMessages', () => {
  it('produces a brute-force burst, an access and a config change', () => {
    const lines = buildSocScenarioMessages();
    const categories = lines.map((line) => classifyEvent(parseSyslogMessage(line)!));

    const failures = categories.filter((c) => c === 'auth_failure');
    expect(failures).toHaveLength(6);
    expect(categories).toContain('access');
    expect(categories).toContain('config_change');
  });
});
