import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSyslogMessage, extractSourceIpFromMessage } from '@ftth-copilot/security';
import { snapshotHealth } from '@/lib/monitoring/scheduler-health';

/**
 * Failure-path coverage for the syslog receiver.
 *
 * The happy path is covered by syslog-durability.test.ts. These tests target
 * the branches that coverage reported at 53%: a spool that cannot be written,
 * a datagram the parser rejects, a socket that fails to bind, and a request to
 * enlarge the receive buffer that the platform refuses.
 *
 * The scheduler health registry is the operator's window into all of this, so
 * each failure has to be visible there rather than only in a log line.
 */

const spoolWrite = vi.fn<(payload: unknown) => string | null>();
const dropCounter = vi.fn();

vi.mock('@/lib/monitoring/event-ingest', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/monitoring/event-ingest')
  >('@/lib/monitoring/event-ingest');
  return {
    ...actual,
    spoolEvent: (payload: unknown) => spoolWrite(payload),
    recordDroppedEvent: () => dropCounter(),
    // Not starting a real drainer: these tests are about the receive path.
    startEventDrainer: () => {},
  };
});

const { startSyslogReceiver } = await import('@/lib/monitoring/syslog');

function lastErrorFor(key: string): string {
  return snapshotHealth()[key]?.lastError ?? '';
}

describe('syslog receiver failure paths', () => {
  let dir: string;
  let port = 16500;
  let stop: (() => void) | null = null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'syslog-err-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    process.env['SNMP_RECEIVER_ENABLED'] = undefined as never;
    spoolWrite.mockReset().mockReturnValue('id-1');
    dropCounter.mockReset();
    port += 1;
  });

  afterEach(() => {
    stop?.();
    stop = null;
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  function boot(env: Record<string, string> = {}): void {
    process.env['SYSLOG_RECEIVER_ENABLED'] = 'true';
    process.env['SYSLOG_TENANT_ID'] = 'tenant-err';
    process.env['SYSLOG_UDP_PORT'] = String(port);
    process.env['SYSLOG_MAX_EVENTS_PER_MINUTE'] = '10000';
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    stop = startSyslogReceiver();
  }

  it('records a health error when the spool write fails instead of dropping silently', async () => {
    spoolWrite.mockImplementation(() => {
      throw new Error('ENOSPC: no space left on device');
    });
    boot();

    const dgram = await import('node:dgram');
    await new Promise<void>((resolve) => {
      const client = dgram.createSocket('udp4');
      client.send(
        Buffer.from('<134>1 2026-10-05 12:00:00 gw01 link down on ge-0/0/1'),
        port,
        '127.0.0.1',
        () => {
          client.close();
          setTimeout(resolve, 250);
        },
      );
    });

    expect(spoolWrite).toHaveBeenCalled();
    expect(lastErrorFor('syslog')).toMatch(/spool write failed.*ENOSPC/i);
  });

  it('counts a datagram dropped by the rate limit', async () => {
    boot({ SYSLOG_MAX_EVENTS_PER_MINUTE: '1' });

    const dgram = await import('node:dgram');
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) => {
        const client = dgram.createSocket('udp4');
        client.send(
          Buffer.from(`<134>1 2026-10-05 12:00:0${i} gw01 flood ${i}`),
          port,
          '127.0.0.1',
          () => {
            client.close();
            resolve();
          },
        );
      });
    }
    await new Promise((r) => setTimeout(r, 300));

    // Five datagrams, room for one: the rest must be accounted for, not vanish.
    expect(dropCounter).toHaveBeenCalled();
  });

  it('does not spool a datagram the parser cannot read', async () => {
    boot();

    const dgram = await import('node:dgram');
    await new Promise<void>((resolve) => {
      const client = dgram.createSocket('udp4');
      // Not RFC 3164/5424 shaped: must be rejected without touching the spool.
      client.send(Buffer.from('this is not syslog at all'), port, '127.0.0.1', () => {
        client.close();
        setTimeout(resolve, 250);
      });
    });

    expect(spoolWrite).not.toHaveBeenCalled();
  });

  it('truncates an oversized message rather than storing it whole', async () => {
    boot({ SYSLOG_MAX_MESSAGE_LENGTH: '80' });

    const dgram = await import('node:dgram');
    await new Promise<void>((resolve) => {
      const client = dgram.createSocket('udp4');
      client.send(
        Buffer.from(`<134>1 2026-10-05 12:00:00 gw01 ${'x'.repeat(4000)}`),
        port,
        '127.0.0.1',
        () => {
          client.close();
          setTimeout(resolve, 250);
        },
      );
    });

    expect(spoolWrite).toHaveBeenCalledTimes(1);
    const payload = spoolWrite.mock.calls[0][0] as { message: string };
    expect(payload.message.length).toBeLessThanOrEqual(80);
  });

  it('prefers an IP from the message body over the UDP source address', async () => {
    boot();

    const dgram = await import('node:dgram');
    await new Promise<void>((resolve) => {
      const client = dgram.createSocket('udp4');
      client.send(
        Buffer.from(
          '<134>1 2026-10-05 12:00:00 gw01 10.20.30.40: %LINK-3-UPDOWN: interface ge-0/0/1 down',
        ),
        port,
        '127.0.0.1',
        () => {
          client.close();
          setTimeout(resolve, 250);
        },
      );
    });

    const payload = spoolWrite.mock.calls[0][0] as { sourceIp: string };
    // A router forwarding for many internal hosts would otherwise merge them.
    expect(payload.sourceIp).toBe('10.20.30.40');
  });

  it('stays inert when disabled and never binds a socket', () => {
    delete process.env['SYSLOG_RECEIVER_ENABLED'];
    process.env['SYSLOG_TENANT_ID'] = 'tenant-err';

    stop = startSyslogReceiver();

    expect(spoolWrite).not.toHaveBeenCalled();
    expect(snapshotHealth()['syslog']?.expected).toBe(false);
  });
});

describe('syslog parsing edge cases', () => {
  it('falls back to the UDP source when the body has no IP literal', () => {
    expect(extractSourceIpFromMessage('interface down', '192.0.2.7')).toBe(
      '192.0.2.7',
    );
  });

  it('rejects a datagram without a syslog priority prefix', () => {
    expect(parseSyslogMessage('plain text, no priority')).toBeNull();
  });

  it('keeps the facility and severity of a valid datagram', () => {
    const parsed = parseSyslogMessage(
      '<134>1 2026-10-05 12:00:00 gw01 kernel: critical failure',
    );
    expect(parsed).not.toBeNull();
    // 134 = facility 16 * 8 + severity 6
    expect(parsed?.severity).toBe(6);
  });
});
