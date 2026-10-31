import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { delay, freeUdpPort, sendDatagram } from './fixtures';

/**
 * The receiver tells the caller what it spooled.
 *
 * The worker binds the socket and needs to know which event landed on disk,
 * so it can enqueue the drain job for it. The contract has two halves:
 *
 *   - the callback receives the `ingestId` the spool assigned (and `null`
 *     when the spool refused the record);
 *   - the callback fires *after* the event is durably on disk. A callback
 *     that fired earlier would let the worker ask for a drain of an event
 *     that is not there yet.
 *
 * The web passes no callback at all, so its behaviour is unchanged.
 */
describe('syslog receiver reports what it spooled', () => {
  let dir: string;
  let port = 0;
  let stop: (() => void) | null = null;

  function spoolLines(): string[] {
    try {
      return readFileSync(join(dir, 'events.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'syslog-callback-'));
    process.env['EVENT_SPOOL_DIR'] = dir;
    process.env['SYSLOG_RECEIVER_ENABLED'] = 'true';
    process.env['SYSLOG_TENANT_ID'] = 'tenant-callback';
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

  it('reports the ingest id of every spooled event', async () => {
    const { startSyslogReceiver } = await import('../src/syslog-receiver');
    const spooled: Array<string | null> = [];

    stop = startSyslogReceiver({ onEventSpooled: (ingestId) => spooled.push(ingestId) });
    await delay(150);

    await sendDatagram(
      port,
      '<134>1 2026-10-05 12:00:00 gw01 link state down on ge-0/0/1',
    );
    await delay(250);

    expect(spooled).toHaveLength(1);
    // The id the spool assigned: the worker derives the job id from it.
    expect(spooled[0]).toMatch(/^[0-9a-f]{8}-[0-9a-z]+$/);
  });

  it('calls the callback only after the event is on disk', async () => {
    const { startSyslogReceiver } = await import('../src/syslog-receiver');
    let linesOnDisk = -1;

    stop = startSyslogReceiver({
      onEventSpooled: () => {
        linesOnDisk = spoolLines().length;
      },
    });
    await delay(150);

    await sendDatagram(
      port,
      '<134>1 2026-10-05 12:00:01 gw01 ospd neighbor down',
    );
    await delay(250);

    // The event was already written when the callback ran: a drain asked for
    // at that point finds the event on disk.
    expect(linesOnDisk).toBe(1);
    expect(spoolLines()).toHaveLength(1);
  });

  it('reports null when the spool refuses the event', async () => {
    const { startSyslogReceiver } = await import('../src/syslog-receiver');
    const { __setSpoolForTests } = await import('../src/ingest');
    const { DurableSpool } = await import('../src/spool');

    // A spool that refuses everything (the hard size limit is zero): the
    // event never reaches the disk, so there is nothing to drain.
    __setSpoolForTests(new DurableSpool({ dir, maxBytes: 0, hardMaxBytes: 0 }));

    const spooled: Array<string | null> = [];
    stop = startSyslogReceiver({ onEventSpooled: (ingestId) => spooled.push(ingestId) });
    await delay(150);

    await sendDatagram(
      port,
      '<134>1 2026-10-05 12:00:02 gw01 refused message',
    );
    await delay(250);

    expect(spooled).toEqual([null]);
    expect(spoolLines()).toHaveLength(0);
  });

  it('keeps working when the caller passes no callback at all', async () => {
    const { startSyslogReceiver } = await import('../src/syslog-receiver');

    stop = startSyslogReceiver();
    await delay(150);

    await sendDatagram(
      port,
      '<134>1 2026-10-05 12:00:03 gw01 no callback here',
    );
    await delay(250);

    expect(spoolLines()).toHaveLength(1);
  });
});
