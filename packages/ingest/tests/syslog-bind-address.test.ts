import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { startSyslogReceiver } from '../src/syslog-receiver';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it.each([
  { configured: '127.0.0.1', expected: '127.0.0.1' },
  { configured: undefined, expected: '0.0.0.0' },
])('binds syslog to $expected', ({ configured, expected }) => {
  const socket = Object.assign(new EventEmitter(), { bind: vi.fn(), close: vi.fn() });
  vi.spyOn(dgram, 'createSocket').mockReturnValue(socket as unknown as dgram.Socket);
  vi.stubEnv('SYSLOG_RECEIVER_ENABLED', 'true');
  vi.stubEnv('SYSLOG_TENANT_ID', 'load-bind-tenant');
  vi.stubEnv('SYSLOG_BIND_ADDRESS', configured);
  vi.stubEnv('SYSLOG_UDP_PORT', '15514');

  const stop = startSyslogReceiver();
  try {
    expect(socket.bind).toHaveBeenCalledWith(15514, expected, expect.any(Function));
  } finally {
    stop();
  }
});
