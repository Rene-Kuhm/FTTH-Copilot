import fc from 'fast-check';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { POST as createConnector } from '@/app/api/connectors/create/route';
import { POST as createUser } from '@/app/api/users/route';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rateLimit: vi.fn(),
  checkBaseUrl: vi.fn(),
  encryptApiKey: vi.fn(),
  hashPassword: vi.fn(),
  insertConnector: vi.fn(),
  findUser: vi.fn(),
  insertUser: vi.fn(),
  auditConnector: vi.fn(),
  auditUser: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@/lib/rate-limit-store', () => ({ enforceApiRateLimit: mocks.rateLimit }));
vi.mock('@ftth-copilot/connectors-core', () => ({ assertSafeNmsBaseUrl: mocks.checkBaseUrl }));
vi.mock('@ftth-copilot/db', () => ({
  encryptApiKey: mocks.encryptApiKey,
  hashPassword: mocks.hashPassword,
  prisma: {
    nmsConnection: { create: mocks.insertConnector },
    user: { findFirst: mocks.findUser, create: mocks.insertUser },
  },
}));
vi.mock('@ftth-copilot/soc', () => ({
  auditConnector: { created: mocks.auditConnector },
  auditUser: { created: mocks.auditUser },
}));

const replay = { seed: Number(process.env.FUZZ_SEED ?? 250025), path: process.env.FUZZ_PATH };
const baseUrl = 'https://nms.example.test';
const tenants = fc.constantFrom('tenant-lab-a', 'tenant-lab-b');
const unrelatedTenant = 'tenant-lab-c';
const connectorPath = '/api/connectors/create';
const usersPath = '/api/users';
const makeUser = (tenantId: string) => ({
  id: `owner-${tenantId}`, email: 'owner@example.test', role: 'OWNER', tenantId,
});

function post(path: string, body: string): NextRequest {
  return new NextRequest(`https://noc.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUser.mockResolvedValue(makeUser('tenant-lab-a'));
  mocks.checkBaseUrl.mockResolvedValue(baseUrl);
  mocks.encryptApiKey.mockReturnValue({ encryptedKey: 'synthetic-ciphertext' });
  mocks.hashPassword.mockResolvedValue('synthetic-password-hash');
});

it('rejects JSON values that cannot be creation objects in both routes', async () => {
  const json = fc.jsonValue({ maxDepth: 3 });
  const invalidBody = fc.oneof(
    fc.constant(null), fc.boolean(), fc.integer(), fc.string(), fc.array(json, { maxLength: 8 }),
  );
  await fc.assert(fc.asyncProperty(invalidBody, tenants, async (value, tenantId) => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(makeUser(tenantId));
    const body = JSON.stringify(value);
    expect((await createConnector(post(connectorPath, body))).status).toBe(400);
    expect((await createUser(post(usersPath, body))).status).toBe(400);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(2);
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(1, expect.any(NextRequest), tenantId);
    expect(mocks.rateLimit).toHaveBeenNthCalledWith(2, expect.any(NextRequest), tenantId);
    expect(mocks.encryptApiKey).not.toHaveBeenCalled();
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.insertConnector).not.toHaveBeenCalled();
    expect(mocks.insertUser).not.toHaveBeenCalled();
  }), { ...replay, numRuns: 200, examples: [[null, 'tenant-lab-a'], [[], 'tenant-lab-b']] });
});

it('rejects incomplete JSON in both routes before touching dependencies', async () => {
  await fc.assert(fc.asyncProperty(fc.string({ maxLength: 128 }), async (text) => {
    const incompleteJson = `{"label":${JSON.stringify(text)}`;
    expect((await createConnector(post(connectorPath, incompleteJson))).status).toBe(400);
    expect((await createUser(post(usersPath, incompleteJson))).status).toBe(400);
    expect(mocks.checkBaseUrl).not.toHaveBeenCalled();
    expect(mocks.insertConnector).not.toHaveBeenCalled();
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.insertUser).not.toHaveBeenCalled();
  }), { ...replay, numRuns: 200, examples: [[''], ['lab 🧪']] });
});

it('rejects malformed connector fields without echoing the API key', async () => {
  const mutation = fc.oneof(
    fc.boolean().map((provider) => ({ provider })),
    fc.string({ minLength: 81, maxLength: 100 }).map((label) => ({ label: `A${label}A` })),
    fc.nat().map((url) => ({ baseUrl: url })),
  );
  await fc.assert(fc.asyncProperty(mutation, fc.nat(), async (fields, id) => {
    const apiKey = `synthetic-key-marker-${id}`;
    const body = { provider: 'SMARTOLT', label: 'Lab OLT', baseUrl, apiKey, ...fields };
    const res = await createConnector(post(connectorPath, JSON.stringify(body)));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(apiKey);
    expect(mocks.checkBaseUrl).not.toHaveBeenCalled();
    expect(mocks.insertConnector).not.toHaveBeenCalled();
  }), { ...replay, numRuns: 200, examples: [[{ provider: false }, 0], [{ baseUrl: 0 }, 1]] });
});

it('rejects invalid user roles without echoing the password', async () => {
  const invalidRole = fc.oneof(fc.boolean(), fc.integer(), fc.constant(null));
  await fc.assert(fc.asyncProperty(invalidRole, fc.nat(), async (role, id) => {
    const password = `synthetic-password-marker-${id}`;
    const res = await createUser(post(usersPath, JSON.stringify({ email: 'lab@example.test', role, password })));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(password);
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.insertUser).not.toHaveBeenCalled();
  }), { ...replay, numRuns: 200, examples: [[null, 0], [false, 1]] });
});

it('uses the session tenant for connector writes and audit and projects out the key', async () => {
  const provider = fc.constantFrom('SMARTOLT', 'MIKROWISP', 'MIKROTIK');
  await fc.assert(fc.asyncProperty(tenants, provider, fc.nat(), async (tenantId, nms, id) => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(makeUser(tenantId));
    const apiKey = `synthetic-key-marker-${id}`;
    const label = `Lab OLT ${id}`;
    mocks.insertConnector.mockResolvedValue({
      id: 'connector-lab', provider: nms, label, baseUrl, status: 'pending',
      createdAt: new Date('2026-01-01T00:00:00Z'), encryptedKey: 'synthetic-ciphertext',
    });
    const res = await createConnector(post(connectorPath, JSON.stringify({
      provider: nms, label: ` ${label} `, baseUrl, apiKey, tenantId: unrelatedTenant,
    })));
    expect(res.status).toBe(201);
    const payload = await res.text();
    expect(JSON.parse(payload)).toMatchObject({ connector: { label, provider: nms } });
    expect(payload).not.toContain(apiKey);
    expect(payload).not.toContain('synthetic-ciphertext');
    expect(mocks.insertConnector).toHaveBeenCalledExactlyOnceWith({
      data: { tenantId, provider: nms, label, baseUrl, encryptedKey: 'synthetic-ciphertext', status: 'pending' },
    });
    expect(mocks.auditConnector).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId }), 'connector-lab', nms,
    );
  }), {
    ...replay,
    numRuns: 200,
    examples: [['tenant-lab-a', 'SMARTOLT', 0], ['tenant-lab-b', 'MIKROWISP', 1]],
  });
});

it('scopes the user lookup, write and audit to the session tenant', async () => {
  const role = fc.constantFrom('OPERATOR', 'ADMIN');
  await fc.assert(fc.asyncProperty(tenants, role, fc.nat(), async (tenantId, userRole, id) => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(makeUser(tenantId));
    const email = `operator-${id}@example.test`;
    const password = `synthetic-password-marker-${id}`;
    const created = { id: 'user-lab', email, role: userRole, name: null, createdAt: new Date('2026-01-01T00:00:00Z') };
    mocks.insertUser.mockResolvedValue(created);
    const res = await createUser(post(usersPath, JSON.stringify({
      email, password, role: userRole, tenantId: unrelatedTenant,
    })));
    expect(res.status).toBe(201);
    expect(mocks.findUser).toHaveBeenCalledExactlyOnceWith({ where: { email, tenantId } });
    expect(mocks.hashPassword).toHaveBeenCalledExactlyOnceWith(password);
    expect(mocks.insertUser).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: { email, name: null, passwordHash: 'synthetic-password-hash', role: userRole, tenantId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }));
    expect(mocks.auditUser).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tenantId }), created.id);
    const payload = await res.text();
    expect(payload).not.toContain(password);
    expect(payload).not.toContain('synthetic-password-hash');
  }), { ...replay, numRuns: 200, examples: [['tenant-lab-a', 'ADMIN', 0], ['tenant-lab-b', 'OPERATOR', 1]] });
});
