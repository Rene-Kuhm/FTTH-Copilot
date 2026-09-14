import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaNmsFindMany: vi.fn(),
  prismaNmsFindFirst: vi.fn(),
  prismaNmsCreate: vi.fn(),
  prismaNmsDeleteMany: vi.fn(),
  prismaNmsUpdate: vi.fn(),
  encryptApiKey: vi.fn(),
  decryptApiKey: vi.fn(),
  assertSafeNmsBaseUrl: vi.fn(),
  ping: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    nmsConnection: {
      findMany: mocks.prismaNmsFindMany,
      findFirst: mocks.prismaNmsFindFirst,
      create: mocks.prismaNmsCreate,
      deleteMany: mocks.prismaNmsDeleteMany,
      update: mocks.prismaNmsUpdate,
    },
  },
  encryptApiKey: mocks.encryptApiKey,
  decryptApiKey: mocks.decryptApiKey,
}));

vi.mock('@ftth-copilot/connectors-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/connectors-core')>();
  return {
    ...actual,
    assertSafeNmsBaseUrl: mocks.assertSafeNmsBaseUrl,
  };
});

vi.mock('@ftth-copilot/connectors-mikrotik', () => {
  class MockMikrotikAdapter {
    ping = mocks.ping;
  }
  return {
    MikrotikNmsAdapter: MockMikrotikAdapter,
  };
});

import { GET as listConnectorsRoute } from '@/app/api/connectors/route';
import { POST as createConnectorRoute } from '@/app/api/connectors/create/route';
import { DELETE as deleteConnectorRoute } from '@/app/api/connectors/[id]/route';
import { POST as testConnectorRoute } from '@/app/api/connectors/[id]/test/route';

const fakeUser = {
  id: 'user-1',
  email: 'admin@isp.com',
  role: 'admin',
  tenantId: 'tenant-1',
  tenant: 'ISP Corp',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
  mocks.encryptApiKey.mockImplementation((k: string) => ({ encryptedKey: `enc:${k}` }));
  mocks.decryptApiKey.mockImplementation((k: string) => k.replace(/^enc:/, ''));
  mocks.assertSafeNmsBaseUrl.mockImplementation(async (url: string) => url);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Connectors API integration', () => {
  describe('GET /api/connectors', () => {
    it('returns connectors for authenticated tenant', async () => {
      mocks.prismaNmsFindMany.mockResolvedValueOnce([
        {
          id: 'conn-1',
          tenantId: 'tenant-1',
          provider: 'MIKROTIK',
          label: 'Core Router MikroTik',
          baseUrl: 'https://router.isp.com',
          encryptedKey: 'enc:admin:secret',
          status: 'connected',
          lastCheckedAt: new Date('2026-09-14T10:00:00Z'),
          lastError: null,
          createdAt: new Date('2026-09-14T09:00:00Z'),
        },
      ]);

      const res = await listConnectorsRoute();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.connectors).toHaveLength(1);
      expect(data.connectors[0]).toMatchObject({
        id: 'conn-1',
        provider: 'MIKROTIK',
        label: 'Core Router MikroTik',
        baseUrl: 'https://router.isp.com',
        status: 'connected',
      });
      // Ensure encryptedKey is not exposed in public projection
      expect(data.connectors[0].encryptedKey).toBeUndefined();
    });
  });

  describe('POST /api/connectors/create', () => {
    it('rejects unauthenticated requests', async () => {
      mocks.getCurrentUser.mockResolvedValueOnce(null);
      const req = new Request('http://localhost/api/connectors/create', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'MIKROTIK',
          label: 'Router 1',
          apiKey: 'admin:password',
          baseUrl: 'https://router.isp.com',
        }),
      });

      const res = await createConnectorRoute(req);
      expect(res.status).toBe(401);
    });

    it('rejects unauthorized users without manage_connectors', async () => {
      mocks.hasPermission.mockReturnValueOnce(false);
      const req = new Request('http://localhost/api/connectors/create', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'MIKROTIK',
          label: 'Router 1',
          apiKey: 'admin:password',
          baseUrl: 'https://router.isp.com',
        }),
      });

      const res = await createConnectorRoute(req);
      expect(res.status).toBe(403);
    });

    it('creates MIKROTIK connector with encrypted credentials', async () => {
      mocks.prismaNmsCreate.mockResolvedValueOnce({
        id: 'conn-m1',
        tenantId: 'tenant-1',
        provider: 'MIKROTIK',
        label: 'Edge MikroTik v7',
        baseUrl: 'https://edge.isp.com',
        encryptedKey: 'enc:admin:pass123',
        status: 'pending',
        lastCheckedAt: null,
        lastError: null,
        createdAt: new Date(),
      });

      const req = new Request('http://localhost/api/connectors/create', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'MIKROTIK',
          label: 'Edge MikroTik v7',
          apiKey: 'admin:pass123',
          baseUrl: 'https://edge.isp.com',
        }),
      });

      const res = await createConnectorRoute(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.connector.id).toBe('conn-m1');
      expect(json.connector.provider).toBe('MIKROTIK');

      expect(mocks.encryptApiKey).toHaveBeenCalledWith('admin:pass123');
      expect(mocks.prismaNmsCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          provider: 'MIKROTIK',
          encryptedKey: 'enc:admin:pass123',
          baseUrl: 'https://edge.isp.com',
          status: 'pending',
        }),
      });
    });
  });

  describe('POST /api/connectors/[id]/test', () => {
    it('executes ping against MIKROTIK adapter and marks connection connected on success', async () => {
      mocks.prismaNmsFindFirst.mockResolvedValueOnce({
        id: 'conn-m1',
        tenantId: 'tenant-1',
        provider: 'MIKROTIK',
        label: 'Edge MikroTik',
        baseUrl: 'https://edge.isp.com',
        encryptedKey: 'enc:admin:pass123',
        status: 'pending',
      });
      mocks.ping.mockResolvedValueOnce({ ok: true, latencyMs: 42 });

      const req = new Request('http://localhost/api/connectors/conn-m1/test', { method: 'POST' });
      const res = await testConnectorRoute(req, {
        params: Promise.resolve({ id: 'conn-m1' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.latencyMs).toBe(42);

      expect(mocks.ping).toHaveBeenCalled();
      expect(mocks.prismaNmsUpdate).toHaveBeenCalledWith({
        where: { id: 'conn-m1' },
        data: expect.objectContaining({
          status: 'connected',
          lastError: null,
        }),
      });
    });

    it('marks connection status as error when ping fails', async () => {
      mocks.prismaNmsFindFirst.mockResolvedValueOnce({
        id: 'conn-m1',
        tenantId: 'tenant-1',
        provider: 'MIKROTIK',
        label: 'Edge MikroTik',
        baseUrl: 'https://edge.isp.com',
        encryptedKey: 'enc:admin:pass123',
        status: 'pending',
      });
      mocks.ping.mockResolvedValueOnce({ ok: false, error: 'Connection refused' });

      const req = new Request('http://localhost/api/connectors/conn-m1/test', { method: 'POST' });
      const res = await testConnectorRoute(req, {
        params: Promise.resolve({ id: 'conn-m1' }),
      });

      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.ok).toBe(false);

      expect(mocks.prismaNmsUpdate).toHaveBeenCalledWith({
        where: { id: 'conn-m1' },
        data: expect.objectContaining({
          status: 'error',
          lastError: 'Connection refused',
        }),
      });
    });
  });

  describe('DELETE /api/connectors/[id]', () => {
    it('deletes connector scoped to tenant', async () => {
      mocks.prismaNmsDeleteMany.mockResolvedValueOnce({ count: 1 });

      const req = new Request('http://localhost/api/connectors/conn-m1', { method: 'DELETE' });
      const res = await deleteConnectorRoute(req, {
        params: Promise.resolve({ id: 'conn-m1' }),
      });

      expect(res.status).toBe(200);
      expect(mocks.prismaNmsDeleteMany).toHaveBeenCalledWith({
        where: { id: 'conn-m1', tenantId: 'tenant-1' },
      });
    });
  });
});
