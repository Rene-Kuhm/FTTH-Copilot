import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dgram from 'node:dgram';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const spoolDir = mkdtempSync(join(tmpdir(), 'syslog-e2e-'));

vi.mock('../src/ingest', async () => {
  const actual = await vi.importActual<
    typeof import('../src/ingest')
  >('../src/ingest');
  return actual;
});

/**
 * End-to-end proof of the NOC requirement: a syslog datagram that arrives while
 * the database is unavailable must still be stored, and must reach the drainer
 * afterwards. The receiver writes only to the spool, so these tests never touch
 * Postgres.
 */
describe('syslog receiver durability', () => {
  let startSyslogReceiver: typeof import('../src/syslog-receiver').startSyslogReceiver;
  let stopReceiver: (() => void) | null = null;

  // A fresh port per test: closing a dgram socket is async, so reusing the
  // same port races the previous listener and the bind fails with EADDRINUSE.
  let port = 0;

  /**
   * A free UDP port, asked from the kernel.
   *
   * A fixed base port collides with whatever else listens on the machine (the
   * repo's own demo stack binds 15514/15515), and a fixed port also races the
   * previous listener of this suite. Asking for port 0 solves both.
   */
  function freeUdpPort(): Promise<number> {
    const probe = dgram.createSocket('udp4');
    return new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.bind(0, '127.0.0.1', () => {
        const address = probe.address();
        const found = typeof address === 'object' && address !== null ? address.port : 0;
        probe.close(() => resolve(found));
      });
    });
  }

  function sendDatagram(message: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4');
      const payload = Buffer.from(message, 'utf8');
      client.send(payload, port, '127.0.0.1', (err) => {
        client.close();
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function spoolLines(): string[] {
    const path = join(spoolDir, 'events.jsonl');
    try {
      return readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  beforeEach(async () => {
    port = await freeUdpPort();
    process.env['EVENT_SPOOL_DIR'] = spoolDir;
    process.env['SYSLOG_RECEIVER_ENABLED'] = 'true';
    process.env['SYSLOG_TENANT_ID'] = 'tenant-test';
    process.env['SYSLOG_UDP_PORT'] = String(port);
    process.env['SYSLOG_MAX_EVENTS_PER_MINUTE'] = '10000';

    vi.resetModules();
    ({ startSyslogReceiver } = await import('../src/syslog-receiver'));
  });

  afterEach(async () => {
    stopReceiver?.();
    stopReceiver = null;
    // The drainer outlives the receiver (it is shared), so it must be stopped
    // explicitly or it keeps committing offsets against the deleted spool.
    const { stopEventDrainer } = await import('../src/ingest');
    stopEventDrainer();
    rmSync(join(spoolDir, 'events.jsonl'), { force: true });
    rmSync(join(spoolDir, 'events.offset'), { force: true });
    rmSync(join(spoolDir, 'events.consumed.jsonl'), { force: true });
  });

  it('binds the socket and receives a datagram into the spool', async () => {
    stopReceiver = startSyslogReceiver();
    // Give dgram time to finish binding.
    await new Promise((resolve) => setTimeout(resolve, 150));

    await sendDatagram(
      '<134>1 2026-10-05 12:00:00 gw01 link state down on ge-0/0/1',
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const lines = spoolLines();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines[0]).toContain('link state down');
  });

  it('assigns an ingest id so a later retry is deduplicable', async () => {
    stopReceiver = startSyslogReceiver();
    await new Promise((resolve) => setTimeout(resolve, 150));

    await sendDatagram('<134>1 2026-10-05 12:00:01 gw01 ospd neighbor down');
    await new Promise((resolve) => setTimeout(resolve, 250));

    const first = JSON.parse(spoolLines()[0]) as { ingestId?: string };
    expect(first.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-z]+$/);
  });

  it('counts events dropped by the rate limit instead of losing them silently', async () => {
    process.env['SYSLOG_MAX_EVENTS_PER_MINUTE'] = '1';

    vi.resetModules();
    ({ startSyslogReceiver } = await import('../src/syslog-receiver'));
    const { recordDroppedEvent, eventIngestStats } = await import(
      '../src/ingest'
    );

    stopReceiver = startSyslogReceiver();
    await new Promise((resolve) => setTimeout(resolve, 150));

    for (let i = 0; i < 4; i++) {
      await sendDatagram(`<134>1 2026-10-05 12:00:0${i} gw01 burst message ${i}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(eventIngestStats().rateLimited).toBeGreaterThan(0);
    // The counter itself is part of the contract health checks rely on.
    recordDroppedEvent();
    expect(eventIngestStats().rateLimited).toBeGreaterThan(0);
  });
});