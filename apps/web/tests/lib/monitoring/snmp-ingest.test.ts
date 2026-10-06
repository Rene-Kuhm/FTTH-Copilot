import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sendSnmpTestTrap } from '@ftth-copilot/monitoring';
import type { TelemetryEvent } from '@ftth-copilot/shared';
import {
  mapTrapCategory,
  mapTrapSeverity,
  describeTrap,
  spoolSnmpTrap,
} from '@/lib/monitoring/snmp-ingest';
import { startEventDrainer, stopEventDrainer } from '@/lib/monitoring/event-ingest';
import { startSnmpReceiver } from '@/lib/monitoring/snmp';

function telemetryEvent(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    schema: 'ftth.telemetry.v1',
    tenantId: 'tenant-a',
    deviceKind: 'OLT',
    deviceId: 'OLT-01',
    source: 'snmp-trap',
    ts: '2026-10-06T10:00:00.000Z',
    metrics: {},
    tags: {
      connectionId: 'conn-1',
      oltId: 'OLT-01',
      vendor: 'Huawei',
      trapCategory: 'link_down',
    },
    ...overrides,
  };
}

interface QueuedEntry {
  ingestId: string;
  payload: Record<string, unknown>;
}

/**
 * The ingest module keeps a module-level spool, so each test must reset it
 * after pointing EVENT_SPOOL_DIR at its own directory, or every test after the
 * first writes into a directory that was already deleted.
 */
function useTempSpoolDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'snmp-spool-'));
  process.env['EVENT_SPOOL_DIR'] = dir;
  stopEventDrainer();
  return dir;
}

function readQueue(dir: string): QueuedEntry[] {
  try {
    return readFileSync(join(dir, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as QueuedEntry);
  } catch {
    return [];
  }
}

describe('mapTrapCategory', () => {
  it('passes through the categories the enum already has', () => {
    expect(mapTrapCategory('auth_failure')).toBe('auth_failure');
    expect(mapTrapCategory('config_change')).toBe('config_change');
  });

  it('collapses link and reachability traps onto access', () => {
    for (const trap of [
      'los',
      'los_clear',
      'dying_gasp',
      'link_down',
      'link_up',
      'onu_offline',
      'onu_online',
      'otdr_fiber_break',
    ]) {
      expect(mapTrapCategory(trap), trap).toBe('access');
    }
  });

  it('falls back to other for unknown or missing categories', () => {
    expect(mapTrapCategory('card_failure')).toBe('other');
    expect(mapTrapCategory(undefined)).toBe('other');
    expect(mapTrapCategory('something-new')).toBe('other');
  });
});

describe('mapTrapSeverity', () => {
  it('maps the catalog levels onto the syslog numbering', () => {
    expect(mapTrapSeverity('critical')).toBe(2);
    expect(mapTrapSeverity('warning')).toBe(4);
    expect(mapTrapSeverity('info')).toBe(6);
  });

  it('returns null for an unknown or missing severity', () => {
    expect(mapTrapSeverity(undefined)).toBeNull();
    expect(mapTrapSeverity('catastrophic')).toBeNull();
  });
});

describe('describeTrap', () => {
  it('summarises the trap with category, device and vendor', () => {
    const line = describeTrap(telemetryEvent());

    expect(line).toContain('link_down');
    expect(line).toContain('OLT OLT-01');
    expect(line).toContain('vendor=Huawei');
  });

  it('still produces a usable line when tags are absent', () => {
    const line = describeTrap(
      telemetryEvent({ tags: undefined, deviceKind: 'ONU', deviceId: 'ONU-9' }),
    );

    expect(line).toBe('snmp-trap | ONU ONU-9');
  });
});

describe('spoolSnmpTrap', () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempSpoolDir();
  });

  afterEach(() => {
    stopEventDrainer();
    rmSync(dir, { recursive: true, force: true });
  });

  it('queues the trap with its device identity and a dedup id', () => {
    spoolSnmpTrap(
      telemetryEvent({
        tags: { trapCategory: 'link_down', severity: 'warning', connectionId: 'conn-1' },
      }),
    );

    const [entry] = readQueue(dir);
    expect(entry.payload).toMatchObject({
      tenantId: 'tenant-a',
      connectionId: 'conn-1',
      category: 'access',
      // Previously always null: the catalog severity never reached the event.
      severity: 4,
      deviceKind: 'OLT',
      deviceId: 'OLT-01',
      occurredAt: '2026-10-06T10:00:00.000Z',
    });
    expect(entry.ingestId).toMatch(/^[0-9a-f]{8}-[0-9a-z]+$/);
  });

  it('carries a critical trap as critical, not as default severity', () => {
    spoolSnmpTrap(
      telemetryEvent({
        tags: { trapCategory: 'dying_gasp', severity: 'critical' },
      }),
    );

    expect(readQueue(dir)[0].payload).toMatchObject({
      category: 'access',
      severity: 2,
    });
  });

  it('queues a trap without touching the database', () => {
    // The whole point of the spool: a trap arriving while Postgres is down is
    // stored, not lost.
    spoolSnmpTrap(telemetryEvent());

    expect(readQueue(dir)).toHaveLength(1);
  });

  it('keeps an ONU outage distinct from an OLT one', () => {
    spoolSnmpTrap(
      telemetryEvent({
        deviceKind: 'ONU',
        deviceId: 'HWTC12345678',
        tags: { trapCategory: 'dying_gasp', vendor: 'ZTE' },
      }),
    );

    const [entry] = readQueue(dir);
    expect(entry.payload).toMatchObject({
      category: 'access',
      deviceKind: 'ONU',
      deviceId: 'HWTC12345678',
    });
  });

  it('gives two identical traps different ids so neither is lost', () => {
    spoolSnmpTrap(telemetryEvent());
    spoolSnmpTrap(telemetryEvent());

    const ids = readQueue(dir).map((e) => e.ingestId);
    expect(new Set(ids).size).toBe(2);
  });
});

/**
 * Proves a real binary trap travels from the UDP socket into the durable spool,
 * which is the path the wiring in instrumentation.ts depends on.
 */
describe('SNMP trap from socket into the spool', () => {
  let dir: string;
  let stop: (() => Promise<void>) & { ready: () => Promise<void> } | null = null;

  beforeEach(() => {
    dir = useTempSpoolDir();
    process.env['SNMP_RECEIVER_ENABLED'] = 'true';
    // `address` only sets the bind host; the port comes from the env var.
    process.env['SNMP_UDP_PORT'] = '12199';
    startEventDrainer();
  });

  afterEach(async () => {
    await stop?.();
    stop = null;
    stopEventDrainer();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lands a real linkDown trap with its device identity', async () => {
    stop = startSnmpReceiver({
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-a',
          connectionId: 'conn-1',
          oltId: 'OLT-E2E-01',
          vendor: 'Huawei',
          community: 'public',
        },
      ],
      onEvent: (event) => {
        spoolSnmpTrap(event);
      },
    });

    await stop.ready();

    await sendSnmpTestTrap({
      port: 12199,
      host: '127.0.0.1',
      version: 'v2c',
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      varbinds: [{ oid: '1.3.6.1.2.1.2.2.2.1.1.1', value: 42 }],
    });

    await new Promise((r) => setTimeout(r, 300));

    const queued = readQueue(dir);
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({
      tenantId: 'tenant-a',
      connectionId: 'conn-1',
      deviceKind: 'OLT',
      deviceId: 'OLT-E2E-01',
    });
    // The catalog severity must survive the real parse path, not just a
    // hand-built event object.
    expect(typeof queued[0].payload.severity).toBe('number');
  });
});