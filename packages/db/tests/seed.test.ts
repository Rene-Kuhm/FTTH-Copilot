import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, decryptApiKey } from '../src/index.js';
import {
  seed,
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_SLUG,
  DEFAULT_ADMIN_EMAIL,
} from '../prisma/seed.js';

const suite = (process.env['DATABASE_URL'] ?? '').startsWith('postgres')
  ? describe
  : describe.skip;

suite('database seed (seed.ts) idempotency and security', () => {
  beforeAll(async () => {
    // Clean demo fixtures if present
    await prisma.nmsConnection.deleteMany({ where: { tenantId: DEFAULT_TENANT_ID } });
    await prisma.user.deleteMany({ where: { email: DEFAULT_ADMIN_EMAIL } });
    await prisma.tenant.deleteMany({ where: { slug: DEFAULT_TENANT_SLUG } });
  });

  afterAll(async () => {
    // Leave seeded state ready for development
    await seed({ adminPassword: 'test-seed-password-123' });
  });

  it('refuses to seed in production without explicit override', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      await expect(seed()).rejects.toThrow(/Refusing to seed database in production/);
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('creates tenant, user with hashed password, and encrypted connection on first run', async () => {
    const res = await seed({ adminPassword: 'first-run-password' });
    expect(res.tenantId).toBe(DEFAULT_TENANT_ID);
    expect(res.adminEmail).toBe(DEFAULT_ADMIN_EMAIL);
    expect(res.adminPassword).toBe('first-run-password');

    const tenant = await prisma.tenant.findUnique({ where: { slug: DEFAULT_TENANT_SLUG } });
    expect(tenant).not.toBeNull();

    const user = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN_EMAIL } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe('ADMIN');

    const conn = await prisma.nmsConnection.findFirst({
      where: { tenantId: DEFAULT_TENANT_ID, provider: 'SMARTOLT' },
    });
    expect(conn).not.toBeNull();
    // Verify decrypted key matches expected plaintext
    const decrypted = decryptApiKey(conn!.encryptedKey);
    expect(decrypted).toBe('mock-api-key');
  });

  it('is idempotent: running seed a second time does not duplicate rows', async () => {
    const initialTenantCount = await prisma.tenant.count({ where: { slug: DEFAULT_TENANT_SLUG } });
    const initialUserCount = await prisma.user.count({ where: { email: DEFAULT_ADMIN_EMAIL } });
    const initialConnCount = await prisma.nmsConnection.count({
      where: { tenantId: DEFAULT_TENANT_ID, provider: 'SMARTOLT' },
    });

    // Run seed again without password override
    const secondRun = await seed();
    expect(secondRun.tenantId).toBe(DEFAULT_TENANT_ID);
    // Preserves existing password
    expect(secondRun.adminPassword).toBeUndefined();

    const newTenantCount = await prisma.tenant.count({ where: { slug: DEFAULT_TENANT_SLUG } });
    const newUserCount = await prisma.user.count({ where: { email: DEFAULT_ADMIN_EMAIL } });
    const newConnCount = await prisma.nmsConnection.count({
      where: { tenantId: DEFAULT_TENANT_ID, provider: 'SMARTOLT' },
    });

    expect(newTenantCount).toBe(initialTenantCount);
    expect(newUserCount).toBe(initialUserCount);
    expect(newConnCount).toBe(initialConnCount);
  });
});
