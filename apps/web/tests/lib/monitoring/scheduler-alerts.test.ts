import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prismaNmsFindMany: vi.fn(),
  pollConnections: vi.fn(),
  buildConnectorFromConnection: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    nmsConnection: {
      findMany: mocks.prismaNmsFindMany,
    },
  },
}));

vi.mock('@ftth-copilot/monitoring', () => ({
  pollConnections: mocks.pollConnections,
}));

vi.mock('@/lib/connectors/chat-client', () => ({
  buildConnectorFromConnection: mocks.buildConnectorFromConnection,
}));

import { runScheduledPoll } from '@/lib/monitoring/scheduler';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
  vi.restoreAllMocks();
});

describe('runScheduledPoll notification routing', () => {
  it('forwards Slack and WhatsApp configurations to pollConnections when env vars are set', async () => {
    process.env['SLACK_WEBHOOK_URL'] = 'https://hooks.slack.com/services/T1/B1/K1';
    process.env['WHATSAPP_API_URL'] = 'https://wa.gateway.com/send';
    process.env['WHATSAPP_RECIPIENT'] = '5491199998888';
    process.env['WHATSAPP_API_KEY'] = 'wa-secret-key';
    process.env['TELEGRAM_BOT_TOKEN'] = '123:token';
    process.env['TELEGRAM_CHAT_ID'] = '987654';

    const mockConnector = { ping: vi.fn() };
    mocks.prismaNmsFindMany.mockResolvedValueOnce([
      {
        id: 'conn-1',
        tenantId: 'tenant-1',
        status: 'connected',
      },
    ]);
    mocks.buildConnectorFromConnection.mockReturnValueOnce({
      connector: mockConnector,
    });
    mocks.pollConnections.mockResolvedValueOnce({
      results: [],
      errors: [],
      deleted: 0,
    });

    await runScheduledPoll();

    expect(mocks.pollConnections).toHaveBeenCalledWith(
      [
        {
          connector: mockConnector,
          meta: { tenantId: 'tenant-1', connectionId: 'conn-1' },
        },
      ],
      expect.objectContaining({
        slack: { webhookUrl: 'https://hooks.slack.com/services/T1/B1/K1' },
        whatsapp: {
          apiUrl: 'https://wa.gateway.com/send',
          recipient: '5491199998888',
          apiKey: 'wa-secret-key',
        },
        telegram: {
          botToken: '123:token',
          chatId: '987654',
        },
      }),
    );
  });

  it('omits Slack and WhatsApp configurations when env vars are absent', async () => {
    delete process.env['SLACK_WEBHOOK_URL'];
    delete process.env['WHATSAPP_API_URL'];
    delete process.env['WHATSAPP_RECIPIENT'];
    delete process.env['WHATSAPP_API_KEY'];
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_CHAT_ID'];

    mocks.prismaNmsFindMany.mockResolvedValueOnce([]);
    mocks.pollConnections.mockResolvedValueOnce({
      results: [],
      errors: [],
      deleted: 0,
    });

    await runScheduledPoll();

    expect(mocks.pollConnections).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        slack: undefined,
        whatsapp: undefined,
        telegram: undefined,
      }),
    );
  });
});
