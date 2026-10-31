/**
 * Selector of the backend mode.
 *
 * Under `BACKEND_MODE=worker` the web must not start the recurring loops:
 * the worker process owns them. Under `embedded` — the default, and the
 * behavior of today — the web starts them exactly as it always did.
 *
 * The syslog and SNMP receivers stay in the web for now: the worker does
 * not receive them yet (tasks T9 and T10), and moving them before it can
 * receive them would silently drop every trap and every syslog message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startPollingLoop: vi.fn(),
  startFirmwareAuditLoop: vi.fn(),
  startFecCollectionLoop: vi.fn(),
  startSyslogReceiver: vi.fn(),
  startEventDrainer: vi.fn(),
  startSnmpReceiver: vi.fn(),
  markNotExpected: vi.fn(),
  startInvestigationSweep: vi.fn(),
}));

vi.mock('@/lib/investigations/sweep', () => ({
  startInvestigationSweep: mocks.startInvestigationSweep,
}));

vi.mock('@/lib/monitoring/scheduler', () => ({
  startPollingLoop: mocks.startPollingLoop,
  startFirmwareAuditLoop: mocks.startFirmwareAuditLoop,
  startFecCollectionLoop: mocks.startFecCollectionLoop,
}));

vi.mock('@/lib/monitoring/scheduler-health', () => ({
  markNotExpected: mocks.markNotExpected,
}));

vi.mock('@/lib/monitoring/syslog', () => ({
  startSyslogReceiver: mocks.startSyslogReceiver,
}));

vi.mock('@/lib/monitoring/snmp', () => ({
  startSnmpReceiver: mocks.startSnmpReceiver,
}));

vi.mock('@/lib/monitoring/event-ingest', () => ({
  startEventDrainer: mocks.startEventDrainer,
}));

vi.mock('@/lib/monitoring/snmp-ingest', () => ({
  spoolSnmpTrap: vi.fn(),
}));

vi.mock('@/lib/monitoring/snmp-evidence', () => ({
  storeEvidence: vi.fn(),
}));

async function register(): Promise<void> {
  const mod = await import('@/instrumentation');
  await mod.register();
}

describe('instrumentation: who owns the background work', () => {
  const originalRuntime = process.env['NEXT_RUNTIME'];
  const originalMode = process.env['BACKEND_MODE'];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env['NEXT_RUNTIME'] = 'nodejs';
    delete process.env['BACKEND_MODE'];
    delete process.env['SNMP_RECEIVER_ENABLED'];
  });

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env['NEXT_RUNTIME'];
    else process.env['NEXT_RUNTIME'] = originalRuntime;
    if (originalMode === undefined) delete process.env['BACKEND_MODE'];
    else process.env['BACKEND_MODE'] = originalMode;
    delete process.env['SNMP_RECEIVER_ENABLED'];
  });

  it('starts the recurring loops when the mode is embedded', async () => {
    process.env['BACKEND_MODE'] = 'embedded';

    await register();

    expect(mocks.startPollingLoop).toHaveBeenCalledOnce();
    expect(mocks.startFirmwareAuditLoop).toHaveBeenCalledOnce();
    expect(mocks.startFecCollectionLoop).toHaveBeenCalledOnce();
  });

  it('starts the recurring loops when the mode is not set', async () => {
    await register();

    expect(mocks.startPollingLoop).toHaveBeenCalledOnce();
    expect(mocks.startFirmwareAuditLoop).toHaveBeenCalledOnce();
    expect(mocks.startFecCollectionLoop).toHaveBeenCalledOnce();
  });

  it('sweeps abandoned investigation attempts in process when the mode is embedded', async () => {
    process.env['BACKEND_MODE'] = 'embedded';

    await register();

    expect(mocks.startInvestigationSweep).toHaveBeenCalledOnce();
  });

  it('leaves the investigation sweep to the worker when the worker owns the background work', async () => {
    process.env['BACKEND_MODE'] = 'worker';

    await register();

    expect(mocks.startInvestigationSweep).not.toHaveBeenCalled();
  });

  it('does not start the recurring loops when the worker owns them', async () => {
    process.env['BACKEND_MODE'] = 'worker';

    await register();

    expect(mocks.startPollingLoop).not.toHaveBeenCalled();
    expect(mocks.startFirmwareAuditLoop).not.toHaveBeenCalled();
    expect(mocks.startFecCollectionLoop).not.toHaveBeenCalled();
  });

  it('reports the loops as not expected in this process when the worker owns them', async () => {
    process.env['BACKEND_MODE'] = 'worker';

    await register();

    expect(mocks.markNotExpected).toHaveBeenCalledWith('polling');
    expect(mocks.markNotExpected).toHaveBeenCalledWith('firmware');
    expect(mocks.markNotExpected).toHaveBeenCalledWith('fec');
  });

  it('does not start the syslog receiver when the worker owns it', async () => {
    process.env['BACKEND_MODE'] = 'worker';

    await register();

    // The receiver binds a UDP port. Two processes cannot bind the same
    // port: the kernel delivers each datagram to one socket, so the web
    // would wait forever for messages the worker is receiving.
    expect(mocks.startSyslogReceiver).not.toHaveBeenCalled();
  });

  it('reports the syslog receiver as not expected in this process when the worker owns it', async () => {
    process.env['BACKEND_MODE'] = 'worker';

    await register();

    expect(mocks.markNotExpected).toHaveBeenCalledWith('syslog');
    expect(mocks.markNotExpected).toHaveBeenCalledWith('syslog-detection');
  });

  it('starts the syslog receiver when the mode is embedded', async () => {
    process.env['BACKEND_MODE'] = 'embedded';

    await register();

    expect(mocks.startSyslogReceiver).toHaveBeenCalledOnce();
  });

  it('does not start the SNMP receiver when the worker owns it', async () => {
    process.env['BACKEND_MODE'] = 'worker';
    process.env['SNMP_RECEIVER_ENABLED'] = 'true';

    await register();

    // Another UDP port, same rule: the kernel hands each datagram to one
    // socket, and the worker owns the SNMP one now.
    expect(mocks.startSnmpReceiver).not.toHaveBeenCalled();
    // The web must not drain the spool either: the worker drains it through
    // the queue, and two drainers would advance the same offset.
    expect(mocks.startEventDrainer).not.toHaveBeenCalled();
  });

  it('reports the SNMP receiver as not expected in this process when the worker owns it', async () => {
    process.env['BACKEND_MODE'] = 'worker';

    await register();

    expect(mocks.markNotExpected).toHaveBeenCalledWith('snmp');
  });

  it('starts the SNMP receiver in embedded mode when the flag is on', async () => {
    process.env['BACKEND_MODE'] = 'embedded';
    process.env['SNMP_RECEIVER_ENABLED'] = 'true';

    await register();

    expect(mocks.startSnmpReceiver).toHaveBeenCalledOnce();
  });

  it('does not start the SNMP receiver in embedded mode when the flag is off', async () => {
    process.env['BACKEND_MODE'] = 'embedded';
    delete process.env['SNMP_RECEIVER_ENABLED'];

    await register();

    expect(mocks.startSnmpReceiver).not.toHaveBeenCalled();
  });

  it('does nothing outside the nodejs runtime', async () => {
    process.env['NEXT_RUNTIME'] = 'edge';
    delete process.env['BACKEND_MODE'];

    await register();

    expect(mocks.startPollingLoop).not.toHaveBeenCalled();
    expect(mocks.startSyslogReceiver).not.toHaveBeenCalled();
  });
});
