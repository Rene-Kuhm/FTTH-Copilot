import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { INmsConnector, OnuDetail, OnuSummary } from '@ftth-copilot/connectors-core';

const mocks = vi.hoisted(() => ({
  findManyEvents: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: { deviceEvent: { findMany: mocks.findManyEvents } },
}));

import {
  runSecurityDetection,
  buildSecurityText,
  buildSecurityPayload,
  runFirmwareAudit,
  DEFAULT_VULNERABLE_FIRMWARE,
} from '../src/run';
import type { SecurityFinding } from '@ftth-copilot/security';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const MIN = 60 * 1000;

function event(overrides: Record<string, unknown> = {}) {
  return {
    category: 'other',
    sourceIp: '1.2.3.4',
    message: '',
    occurredAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.findManyEvents.mockReset();
});

describe('runSecurityDetection', () => {
  it('returns zero findings for no events', async () => {
    mocks.findManyEvents.mockResolvedValue([]);
    const res = await runSecurityDetection({ tenantId: 't1', now: NOW });
    expect(res).toEqual({
      events: 0,
      bruteForce: 0,
      accessAfterFailures: 0,
      configChanges: 0,
      notified: 0,
    });
  });

  it('detects brute force and notifies the webhook', async () => {
    mocks.findManyEvents.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) =>
        event({ category: 'auth_failure', occurredAt: new Date(NOW.getTime() - i * MIN) }),
      ),
    );
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));

    const res = await runSecurityDetection({
      tenantId: 't1',
      now: NOW,
      webhookUrl: 'https://hook',
      fetchImpl,
    });

    expect(res.bruteForce).toBe(1);
    expect(res.notified).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('detects config changes', async () => {
    mocks.findManyEvents.mockResolvedValue([event({ category: 'config_change', message: 'commit' })]);
    const res = await runSecurityDetection({ tenantId: 't1', now: NOW });
    expect(res.configChanges).toBe(1);
    expect(res.notified).toBe(0); // no channel configured
  });

  it('notifies Telegram and webhook together', async () => {
    mocks.findManyEvents.mockResolvedValue([event({ category: 'config_change' })]);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));

    const res = await runSecurityDetection({
      tenantId: 't1',
      now: NOW,
      webhookUrl: 'https://hook',
      telegram: { botToken: 'tok', chatId: 'chat' },
      fetchImpl,
    });

    expect(res.notified).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('records an error when the webhook fails', async () => {
    mocks.findManyEvents.mockResolvedValue([event({ category: 'config_change' })]);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500, statusText: 'boom' }));

    const res = await runSecurityDetection({
      tenantId: 't1',
      now: NOW,
      webhookUrl: 'https://hook',
      fetchImpl,
    });

    expect(res.notified).toBe(0);
    expect(res.error).toBe('boom');
  });
});

describe('buildSecurityText', () => {
  it('formats findings into a digest', () => {
    const finding: SecurityFinding = {
      id: '1',
      kind: 'brute_force',
      severity: 'critical',
      sourceIp: '1.2.3.4',
      title: 'Posible fuerza bruta',
      description: 'x',
      detectedAt: NOW.toISOString(),
    };
    const text = buildSecurityText([finding]);
    expect(text).toContain('FTTH-Copilot SOC');
    expect(text).toContain('🔴 [1.2.3.4] Posible fuerza bruta');
  });
});

describe('runFirmwareAudit', () => {
  function makeConnector(overrides: Partial<INmsConnector> = {}): {
    connector: INmsConnector;
    listOnus: ReturnType<typeof vi.fn>;
    getOnuDetail: ReturnType<typeof vi.fn>;
  } {
    const listOnus = vi.fn(async () => [] as OnuSummary[]);
    const getOnuDetail = vi.fn(async () => null as OnuDetail | null);
    const connector = {
      providerName: 'test',
      ping: vi.fn(async () => ({ ok: true })),
      listOlts: vi.fn(async () => []),
      getOltDetail: vi.fn(async () => {
        throw new Error('getOltDetail not stubbed');
      }),
      getNetworkOverview: vi.fn(async () => ({
        totalOlts: 0,
        oltsOnline: 0,
        totalOnus: 0,
        onusOnline: 0,
        onusOffline: 0,
        averageUptimeSeconds: 0,
        oltsWithHighTemperature: 0,
      })),
      listOnus,
      getOnuDetail,
      getOnusWithLowSignal: vi.fn(async () => []),
      searchByCustomerName: vi.fn(async () => []),
      ...overrides,
    } as unknown as INmsConnector;
    return { connector, listOnus, getOnuDetail };
  }

  it('returns zero findings when the bulk response carries no firmware', async () => {
    const { connector, getOnuDetail } = makeConnector({
      listOnus: vi.fn(async () => [
        { id: 'ONU-1', serial: 'SN-1', oltId: 'OLT-1', status: 'online' },
        { id: 'ONU-2', serial: 'SN-2', oltId: 'OLT-1', status: 'online' },
      ]),
    });

    const res = await runFirmwareAudit({
      tenantId: 't1',
      connectionId: 'c1',
      connector,
      vulnerable: [...DEFAULT_VULNERABLE_FIRMWARE],
      now: NOW,
    });

    expect(res.devicesScanned).toBe(2);
    expect(res.vulnerable).toBe(0);
    expect(res.notified).toBe(0);
    expect(getOnuDetail).not.toHaveBeenCalled();
  });

  it('flags devices whose firmware appears in the vulnerable allowlist', async () => {
    const { connector } = makeConnector({
      listOnus: vi.fn(async () => [
        { id: 'ONU-1', serial: 'SN-1', oltId: 'OLT-1', status: 'online' },
        { id: 'ONU-2', serial: 'SN-2', oltId: 'OLT-1', status: 'online' },
      ]),
      getOnuDetail: vi.fn(async (id: string) => {
        if (id === 'ONU-1') {
          return {
            id: 'ONU-1',
            serial: 'SN-1',
            oltId: 'OLT-1',
            status: 'online',
            firmwareVersion: DEFAULT_VULNERABLE_FIRMWARE[0],
          } as OnuDetail;
        }
        return {
          id: 'ONU-2',
          serial: 'SN-2',
          oltId: 'OLT-1',
          status: 'online',
          firmwareVersion: 'V3R019C10S160',
        } as OnuDetail;
      }),
    });

    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const res = await runFirmwareAudit({
      tenantId: 't1',
      connectionId: 'c1',
      connector,
      includeOnuDetail: true,
      vulnerable: [...DEFAULT_VULNERABLE_FIRMWARE],
      now: NOW,
      webhookUrl: 'https://hook',
      fetchImpl,
    });

    expect(res.devicesScanned).toBe(2);
    expect(res.vulnerable).toBe(1);
    expect(res.notified).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not fan out when includeOnuDetail is false, even if firmware is missing', async () => {
    const { connector, getOnuDetail } = makeConnector({
      listOnus: vi.fn(async () => [
        { id: 'ONU-1', serial: 'SN-1', oltId: 'OLT-1', status: 'online' },
      ]),
    });

    const res = await runFirmwareAudit({
      tenantId: 't1',
      connectionId: 'c1',
      connector,
      vulnerable: [...DEFAULT_VULNERABLE_FIRMWARE],
      now: NOW,
    });

    expect(res.vulnerable).toBe(0);
    expect(getOnuDetail).not.toHaveBeenCalled();
  });

  it('survives a getOnuDetail failure for one device', async () => {
    const { connector } = makeConnector({
      listOnus: vi.fn(async () => [
        { id: 'ONU-1', serial: 'SN-1', oltId: 'OLT-1', status: 'online' },
        { id: 'ONU-2', serial: 'SN-2', oltId: 'OLT-1', status: 'online' },
      ]),
      getOnuDetail: vi.fn(async (id: string) => {
        if (id === 'ONU-1') throw new Error('boom');
        return {
          id: 'ONU-2',
          serial: 'SN-2',
          oltId: 'OLT-1',
          status: 'online',
          firmwareVersion: DEFAULT_VULNERABLE_FIRMWARE[0],
        } as OnuDetail;
      }),
    });

    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const res = await runFirmwareAudit({
      tenantId: 't1',
      connectionId: 'c1',
      connector,
      includeOnuDetail: true,
      vulnerable: [...DEFAULT_VULNERABLE_FIRMWARE],
      now: NOW,
      webhookUrl: 'https://hook',
      fetchImpl,
    });

    expect(res.devicesScanned).toBe(2);
    expect(res.vulnerable).toBe(1);
    expect(res.notified).toBe(1);
  });

  it('does not notify when no devices match the allowlist', async () => {
    const { connector } = makeConnector({
      listOnus: vi.fn(async () => [
        { id: 'ONU-1', serial: 'SN-1', oltId: 'OLT-1', status: 'online' },
      ]),
      getOnuDetail: vi.fn(async () => ({
        id: 'ONU-1',
        serial: 'SN-1',
        oltId: 'OLT-1',
        status: 'online',
        firmwareVersion: 'V3R019C10S160',
      } as OnuDetail)),
    });

    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const res = await runFirmwareAudit({
      tenantId: 't1',
      connectionId: 'c1',
      connector,
      includeOnuDetail: true,
      vulnerable: [...DEFAULT_VULNERABLE_FIRMWARE],
      now: NOW,
      webhookUrl: 'https://hook',
      fetchImpl,
    });

    expect(res.vulnerable).toBe(0);
    expect(res.notified).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


function makeFinding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    id: 'f-default',
    kind: 'brute_force',
    severity: 'warning',
    sourceIp: '1.2.3.4',
    title: 'Default title',
    description: 'Default description',
    detectedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildSecurityPayload (mapping primitive, direct tests)', () => {
  it('returns the canonical envelope shape for an empty findings list', () => {
    const payload = buildSecurityPayload([]);
    expect(payload).toEqual({
      type: 'ftth-copilot.security',
      count: 0,
      findings: [],
    });
  });

  it('sets count to the length of the findings array', () => {
    const payload = buildSecurityPayload([
      makeFinding({ id: 'f-1' }),
      makeFinding({ id: 'f-2', kind: 'config_change' }),
      makeFinding({ id: 'f-3', kind: 'vulnerable_firmware' }),
    ]);
    expect((payload as { count: number }).count).toBe(3);
    expect((payload as { findings: unknown[] }).findings).toHaveLength(3);
  });

  it('strips `id` from each finding (the canonical wire shape does not include it)', () => {
    // The function intentionally drops `id` — see the source map: only
    // kind, severity, sourceIp, title, description, detectedAt survive.
    // Pin current behavior so any future schema bump is loud.
    const payload = buildSecurityPayload([
      makeFinding({ id: 'secret-internal-id-1' }),
    ]);
    const finding = (payload as { findings: Record<string, unknown>[] }).findings[0];
    expect(finding).not.toHaveProperty('id');
    expect(Object.keys(finding).sort()).toEqual(
      ['description', 'detectedAt', 'kind', 'severity', 'sourceIp', 'title'].sort(),
    );
  });

  it('preserves null sourceIp (does not coerce to undefined or empty string)', () => {
    const payload = buildSecurityPayload([
      makeFinding({ sourceIp: null }),
    ]);
    const finding = (payload as { findings: Record<string, unknown>[] }).findings[0];
    expect(finding.sourceIp).toBeNull();
  });

  it('maps every documented SecurityFindingKind value', () => {
    const kinds: SecurityFinding['kind'][] = [
      'brute_force',
      'access_after_failures',
      'config_change',
      'vulnerable_firmware',
      'traffic_anomaly',
    ];
    const payload = buildSecurityPayload(
      kinds.map((k, i) => makeFinding({ id: `f-${i}`, kind: k })),
    );
    const findings = (payload as { findings: { kind: string }[] }).findings;
    expect(findings.map((f) => f.kind)).toEqual(kinds);
  });

  it('maps severity values verbatim (warning and critical)', () => {
    const payload = buildSecurityPayload([
      makeFinding({ id: 'f-w', severity: 'warning' }),
      makeFinding({ id: 'f-c', severity: 'critical' }),
    ]);
    const findings = (payload as { findings: { severity: string }[] }).findings;
    expect(findings.map((f) => f.severity)).toEqual(['warning', 'critical']);
  });

  it('always sets type to "ftth-copilot.security"', () => {
    const payload = buildSecurityPayload([]);
    expect((payload as { type: string }).type).toBe('ftth-copilot.security');
    const payload2 = buildSecurityPayload([makeFinding()]);
    expect((payload2 as { type: string }).type).toBe('ftth-copilot.security');
  });
});
