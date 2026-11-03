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

  it('allows seeding in production when explicitly authorized via option or env var', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalAllow = process.env.ALLOW_PRODUCTION_SEED;
    const originalKms = process.env.KMS_MASTER_KEY;
    try {
      process.env.NODE_ENV = 'production';
      process.env.KMS_MASTER_KEY = 'test-kms-master-key-32-chars-long-hex';
      // 1. Authorized via forceAllowProduction option
      const res1 = await seed({ forceAllowProduction: true });
      expect(res1.tenantId).toBe(DEFAULT_TENANT_ID);

      // 2. Authorized via ALLOW_PRODUCTION_SEED environment variable
      process.env.ALLOW_PRODUCTION_SEED = 'true';
      const res2 = await seed();
      expect(res2.tenantId).toBe(DEFAULT_TENANT_ID);
    } finally {
      process.env.NODE_ENV = originalEnv;
      process.env.ALLOW_PRODUCTION_SEED = originalAllow;
      process.env.KMS_MASTER_KEY = originalKms;
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

  /**
   * La URL base de la conexión.
   *
   * Una conexión sin URL base no la puede usar ningún loop: el conector no
   * se puede construir y el poll no tiene contra qué consultar. El staging
   * necesita una que apunte al mock NMS.
   */
  it('creates the connection with the base URL of the environment', async () => {
    const original = process.env.DEMO_NMS_BASE_URL;
    try {
      process.env.DEMO_NMS_BASE_URL = 'http://127.0.0.1:18080';
      await prisma.nmsConnection.deleteMany({
        where: { tenantId: DEFAULT_TENANT_ID, provider: 'SMARTOLT' },
      });

      const res = await seed({ adminPassword: 'seed-with-base-url' });

      const conn = await prisma.nmsConnection.findUnique({ where: { id: res.connectionId } });
      expect(conn?.baseUrl).toBe('http://127.0.0.1:18080');
    } finally {
      if (original === undefined) delete process.env.DEMO_NMS_BASE_URL;
      else process.env.DEMO_NMS_BASE_URL = original;
    }
  });

  it('leaves the connection without a base URL when the environment does not say one', async () => {
    const original = process.env.DEMO_NMS_BASE_URL;
    try {
      delete process.env.DEMO_NMS_BASE_URL;
      await prisma.nmsConnection.deleteMany({
        where: { tenantId: DEFAULT_TENANT_ID, provider: 'SMARTOLT' },
      });

      const res = await seed({ adminPassword: 'seed-without-base-url' });

      const conn = await prisma.nmsConnection.findUnique({ where: { id: res.connectionId } });
      expect(conn?.baseUrl).toBeNull();
    } finally {
      if (original === undefined) delete process.env.DEMO_NMS_BASE_URL;
      else process.env.DEMO_NMS_BASE_URL = original;
    }
  });

  /**
   * La conexión del seed es suya: no pisa la de otro.
   *
   * El seed tomaba cualquier conexión SmartOLT del tenant. Con eso, un
   * `DEMO_NMS_BASE_URL` de staging repuntaba la conexión real del operador
   * al mock sintético, sin avisar: el operador veía su NMS real
   * reemplazado por el mock, y la fila `demo-smartolt-connection` ni
   * siquiera se creaba.
   */
  it('does not overwrite the base URL of a connection that is not the seed\'s', async () => {
    const original = process.env.DEMO_NMS_BASE_URL;
    try {
      await prisma.nmsConnection.deleteMany({
        where: { tenantId: DEFAULT_TENANT_ID, provider: 'SMARTOLT' },
      });
      const operator = await prisma.nmsConnection.create({
        data: {
          id: 'operator-smartolt-connection',
          tenantId: DEFAULT_TENANT_ID,
          provider: 'SMARTOLT',
          label: 'SmartOLT del operador',
          encryptedKey: 'operator-encrypted-key',
          status: 'connected',
          baseUrl: 'https://nms.real.ejemplo.com',
        },
      });
      process.env.DEMO_NMS_BASE_URL = 'http://127.0.0.1:18080';

      await seed({ adminPassword: 'seed-beside-operator-connection' });

      const after = await prisma.nmsConnection.findUnique({ where: { id: operator.id } });
      expect(after?.baseUrl).toBe('https://nms.real.ejemplo.com');
    } finally {
      await prisma.nmsConnection.deleteMany({
        where: { id: 'operator-smartolt-connection' },
      });
      if (original === undefined) delete process.env.DEMO_NMS_BASE_URL;
      else process.env.DEMO_NMS_BASE_URL = original;
    }
  });

  it('creates its own connection pointing at the mock when the operator has one', async () => {
    const original = process.env.DEMO_NMS_BASE_URL;
    try {
      await prisma.nmsConnection.deleteMany({
        where: { tenantId: DEFAULT_TENANT_ID, provider: 'SMARTOLT' },
      });
      await prisma.nmsConnection.create({
        data: {
          id: 'operator-smartolt-connection',
          tenantId: DEFAULT_TENANT_ID,
          provider: 'SMARTOLT',
          label: 'SmartOLT del operador',
          encryptedKey: 'operator-encrypted-key',
          status: 'connected',
          baseUrl: 'https://nms.real.ejemplo.com',
        },
      });
      process.env.DEMO_NMS_BASE_URL = 'http://127.0.0.1:18080';

      const res = await seed({ adminPassword: 'seed-with-own-connection' });

      expect(res.connectionId).not.toBe('operator-smartolt-connection');
      const own = await prisma.nmsConnection.findUnique({ where: { id: res.connectionId } });
      expect(own?.baseUrl).toBe('http://127.0.0.1:18080');
    } finally {
      await prisma.nmsConnection.deleteMany({
        where: { id: 'operator-smartolt-connection' },
      });
      if (original === undefined) delete process.env.DEMO_NMS_BASE_URL;
      else process.env.DEMO_NMS_BASE_URL = original;
    }
  });
});
