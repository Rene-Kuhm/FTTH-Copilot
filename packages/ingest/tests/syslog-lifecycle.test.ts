import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import dgram from 'node:dgram';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { delay, freeUdpPort } from './fixtures';

/**
 * The lifecycle of the receiver: the socket that cannot bind, the detection
 * pass and the shutdown.
 *
 * The bug report these cover is explicit: "el puerto syslog puede estar
 * ocupado y el error no queda informado". A socket that fails to bind must
 * be visible in the health registry, not only in a log line.
 */
vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    deviceEvent: {
      findMany: async () => {
        throw new Error('the database is not reachable from this spec');
      },
    },
  },
}));

describe('syslog receiver lifecycle', () => {
  let dir: string;
  let port = 0;
  let stop: (() => void) | null = null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'syslog-lifecycle-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    process.env['SYSLOG_RECEIVER_ENABLED'] = 'true';
    process.env['SYSLOG_TENANT_ID'] = 'tenant-lifecycle';
    process.env['SYSLOG_MAX_EVENTS_PER_MINUTE'] = '10000';
    port = await freeUdpPort();
    process.env['SYSLOG_UDP_PORT'] = String(port);
    vi.resetModules();
  });

  afterEach(async () => {
    stop?.();
    stop = null;
    const { stopEventDrainer } = await import('../src/ingest');
    stopEventDrainer();
    rmSync(dir, { recursive: true, force: true });
  });

  it('records the error when the port is already taken', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');
    const { startSyslogReceiver } = await import('../src/syslog-receiver');

    // The port is taken before the receiver tries to bind it.
    const blocker = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => blocker.bind(port, '127.0.0.1', () => resolve()));

    try {
      stop = startSyslogReceiver();
      await delay(300);

      const health = snapshotHealth()['syslog'];
      expect(health?.lastError).toMatch(/socket error.*EADDRINUSE/i);
      // The socket is not bound: the operator must not see a healthy
      // receiver that receives nothing.
      expect(health?.bound).toBe(false);
    } finally {
      blocker.close();
    }
  });

  it('reports the detection pass in the health registry when it fails', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');
    const { startSyslogReceiver } = await import('../src/syslog-receiver');

    process.env['SYSLOG_DETECTION_INTERVAL_MS'] = '50';
    stop = startSyslogReceiver();
    await delay(400);

    expect(snapshotHealth()['syslog-detection']?.lastError).toBeTruthy();
  });

  it('reports the socket as unbound after the receiver stops', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');
    const { startSyslogReceiver } = await import('../src/syslog-receiver');

    stop = startSyslogReceiver();
    await delay(200);
    expect(snapshotHealth()['syslog']?.bound).toBe(true);

    stop();
    stop = null;

    expect(snapshotHealth()['syslog']?.bound).toBe(false);
  });
});
