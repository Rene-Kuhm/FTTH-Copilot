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
    const { __closeSpoolForTests } = await import('../src/ingest');
    __closeSpoolForTests();
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

  /**
   * The detection pass is a loop: it has a cadence and a tick.
   *
   * The registry needs its deadline. Without it, a worker that just booted
   * reported the loop as hung until the first pass — and the system degraded
   * on every restart, which is what the deadline of the other loops exists to
   * prevent.
   */
  it('publishes when the detection pass is due', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');
    const { startSyslogReceiver } = await import('../src/syslog-receiver');

    process.env['SYSLOG_DETECTION_INTERVAL_MS'] = '60000';
    stop = startSyslogReceiver();
    await delay(100);

    const service = snapshotHealth()['syslog-detection'];
    expect(service?.expected).toBe(true);
    expect(service?.intervalMs).toBe(60_000);
    expect(service?.nextRunAt).toBeGreaterThan(Date.now());
  });

  it('renews the deadline of the detection pass after it runs', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');
    const { startSyslogReceiver } = await import('../src/syslog-receiver');

    // The pass fails in this spec (the database is not reachable), but the
    // loop is alive: the deadline moves forward anyway, or the health would
    // report it as hung.
    process.env['SYSLOG_DETECTION_INTERVAL_MS'] = '50';
    stop = startSyslogReceiver();
    await delay(100);
    const first = snapshotHealth()['syslog-detection']?.nextRunAt ?? 0;

    await delay(300);
    const second = snapshotHealth()['syslog-detection']?.nextRunAt ?? 0;

    // The deadline moves forward with every pass. Comparing the two instants
    // —and not the deadline with the clock— is what makes this stable: with
    // a fifty-millisecond interval, the deadline is in the past most of the
    // time.
    expect(second).toBeGreaterThan(first);
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

describe('the receive buffer of the syslog socket', () => {
  let dir: string;
  let port = 0;
  let stop: (() => void) | null = null;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'syslog-buffer-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    process.env['SYSLOG_RECEIVER_ENABLED'] = 'true';
    process.env['SYSLOG_TENANT_ID'] = 'tenant-buffer';
    process.env['SYSLOG_MAX_EVENTS_PER_MINUTE'] = '10000';
    // A small buffer keeps the test independent of the host's rmem_max.
    process.env['SYSLOG_RECV_BUFFER_BYTES'] = '8192';
    port = await freeUdpPort();
    process.env['SYSLOG_UDP_PORT'] = String(port);
    vi.resetModules();
  });

  afterEach(async () => {
    stop?.();
    stop = null;
    const { __closeSpoolForTests } = await import('../src/ingest');
    __closeSpoolForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it('enlarges the buffer once the socket is bound', async () => {
    const { snapshotHealth } = await import('@ftth-copilot/scheduler');
    const { startSyslogReceiver } = await import('../src/syslog-receiver');

    stop = startSyslogReceiver();
    await delay(300);

    const health = snapshotHealth()['syslog'];
    // The buffer can only be enlarged once the socket has a file descriptor:
    // before the bind, uv_recv_buffer_size fails with EBADF and the socket
    // keeps the small default buffer — the one that drops datagrams when a
    // link flap floods the port.
    expect(health?.lastError ?? null).toBeNull();
    expect(health?.bound).toBe(true);
  });
});
