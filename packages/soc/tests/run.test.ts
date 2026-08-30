import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findManyEvents: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: { deviceEvent: { findMany: mocks.findManyEvents } },
}));

import { runSecurityDetection, buildSecurityText } from '../src/run';
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
