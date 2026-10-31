import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Firmware audit tick of the scheduler.
 *
 * Adapted from the web suite when the scheduler left the Next.js app: the
 * runnable unit now lives in `@ftth-copilot/scheduler` and builds its
 * connectors through `@ftth-copilot/connectors-factory`.
 */

const mocks = vi.hoisted(() => ({
  prismaNmsConnectionFindMany: vi.fn(),
  buildConnectorFromConnection: vi.fn(),
  runFirmwareAudit: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    nmsConnection: {
      findMany: mocks.prismaNmsConnectionFindMany,
    },
  },
  decryptApiKey: vi.fn(),
}));

vi.mock('@ftth-copilot/connectors-factory', () => ({
  buildConnectorFromConnection: mocks.buildConnectorFromConnection,
}));

vi.mock('@ftth-copilot/soc', () => ({
  runFirmwareAudit: mocks.runFirmwareAudit,
  DEFAULT_VULNERABLE_FIRMWARE: ['1.0.0'],
}));

import { runScheduledFirmwareAudit } from '../src/index';

const CONNECTIONS = [
  {
    id: 'conn-1',
    tenantId: 'tenant-1',
    provider: 'SMARTOLT' as const,
    label: 'SmartOLT prod',
    encryptedKey: 'encrypted-secret',
    baseUrl: 'https://smartolt.example.com/api',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prismaNmsConnectionFindMany.mockResolvedValue(CONNECTIONS);
  mocks.runFirmwareAudit.mockResolvedValue({ flagged: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runScheduledFirmwareAudit', () => {
  it('audits every connected connection', async () => {
    const connector = { ping: vi.fn() };
    mocks.buildConnectorFromConnection.mockReturnValue({ connector });

    const results = await runScheduledFirmwareAudit();

    expect(mocks.runFirmwareAudit).toHaveBeenCalledTimes(1);
    expect(mocks.runFirmwareAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        connectionId: 'conn-1',
        connector,
        includeOnuDetail: true,
        vulnerable: ['1.0.0'],
      }),
    );
    expect(results).toEqual([{ connectionId: 'conn-1', result: { flagged: [] } }]);
  });

  it('skips a connection whose connector cannot be built', async () => {
    mocks.buildConnectorFromConnection.mockImplementation(() => {
      throw new Error('no base url');
    });

    const results = await runScheduledFirmwareAudit();

    expect(mocks.runFirmwareAudit).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('keeps auditing the rest when one connection fails', async () => {
    mocks.buildConnectorFromConnection
      .mockImplementationOnce(() => {
        throw new Error('no base url');
      })
      .mockReturnValueOnce({ connector: { ping: vi.fn() } });
    mocks.prismaNmsConnectionFindMany.mockResolvedValue([
      { ...CONNECTIONS[0], id: 'conn-broken' },
      CONNECTIONS[0],
    ]);

    const results = await runScheduledFirmwareAudit();

    expect(mocks.runFirmwareAudit).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0]?.connectionId).toBe('conn-1');
  });

  it('uses the allowlist of the environment', async () => {
    process.env['FIRMWARE_AUDIT_VULNERABLE_LIST'] = '2.0.0, 3.0.0';
    mocks.buildConnectorFromConnection.mockReturnValue({ connector: { ping: vi.fn() } });

    await runScheduledFirmwareAudit();

    expect(mocks.runFirmwareAudit).toHaveBeenCalledWith(
      expect.objectContaining({ vulnerable: ['2.0.0', '3.0.0'] }),
    );

    delete process.env['FIRMWARE_AUDIT_VULNERABLE_LIST'];
  });
});
