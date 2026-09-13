import crypto from 'node:crypto';
import { prisma, hashPassword, encryptApiKey } from '../src/index.js';

export const DEFAULT_TENANT_ID = 'demo-tenant';
export const DEFAULT_TENANT_NAME = 'Demo ISP';
export const DEFAULT_TENANT_SLUG = 'demo';

export const DEFAULT_ADMIN_EMAIL = 'admin@ftth-copilot.local';
export const DEFAULT_ADMIN_NAME = 'Admin User';

export interface SeedResult {
  tenantId: string;
  adminEmail: string;
  adminPassword?: string;
  connectionId: string;
}

export async function seed(options?: {
  adminPassword?: string;
  forceAllowProduction?: boolean;
}): Promise<SeedResult> {
  if (process.env.NODE_ENV === 'production' && !options?.forceAllowProduction) {
    throw new Error('Refusing to seed database in production environment (NODE_ENV=production).');
  }

  const generatedPassword =
    options?.adminPassword ??
    process.env.SEED_ADMIN_PASSWORD ??
    crypto.randomBytes(12).toString('base64url');

  // 1. Ensure default tenant exists
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: { name: DEFAULT_TENANT_NAME },
    create: {
      id: DEFAULT_TENANT_ID,
      name: DEFAULT_TENANT_NAME,
      slug: DEFAULT_TENANT_SLUG,
    },
  });

  // 2. Ensure default admin user exists
  const existingUser = await prisma.user.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL },
  });

  let returnPassword: string | undefined;

  if (!existingUser) {
    const passwordHash = await hashPassword(generatedPassword);
    await prisma.user.create({
      data: {
        email: DEFAULT_ADMIN_EMAIL,
        name: DEFAULT_ADMIN_NAME,
        passwordHash,
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    });
    returnPassword = generatedPassword;
  } else if (options?.adminPassword || process.env.SEED_ADMIN_PASSWORD) {
    const passwordHash = await hashPassword(generatedPassword);
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { passwordHash, role: 'ADMIN', tenantId: tenant.id },
    });
    returnPassword = generatedPassword;
  }

  // 3. Ensure demo NMS connection exists with properly encrypted key
  const existingConn = await prisma.nmsConnection.findFirst({
    where: { tenantId: tenant.id, provider: 'SMARTOLT' },
  });

  let connectionId = existingConn?.id ?? 'demo-smartolt-connection';

  if (!existingConn) {
    const { encryptedKey } = encryptApiKey('mock-api-key');
    const conn = await prisma.nmsConnection.create({
      data: {
        id: connectionId,
        tenantId: tenant.id,
        provider: 'SMARTOLT',
        label: 'Demo SmartOLT (Mock)',
        encryptedKey,
        status: 'connected',
      },
    });
    connectionId = conn.id;
  }

  return {
    tenantId: tenant.id,
    adminEmail: DEFAULT_ADMIN_EMAIL,
    adminPassword: returnPassword,
    connectionId,
  };
}

async function main(): Promise<void> {
  console.log('🌱 Starting database seed...');
  const result = await seed();
  console.log(`✓ Tenant ready: ${DEFAULT_TENANT_NAME} (${result.tenantId})`);
  console.log(`✓ Admin user ready: ${result.adminEmail}`);
  if (result.adminPassword) {
    console.log(`🔑 One-time admin password: ${result.adminPassword}`);
  } else {
    console.log(`✓ Admin user already exists (password preserved)`);
  }
  console.log(`✓ Connection ready: Demo SmartOLT (Mock) (${result.connectionId})`);
  console.log('🎉 Seed completed successfully!');
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  main()
    .catch((e) => {
      console.error('❌ Seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
