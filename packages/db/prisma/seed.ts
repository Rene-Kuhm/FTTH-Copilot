import { prisma, hashPassword } from '../src/index.js';

const DEFAULT_TENANT_ID = 'demo-tenant';
const DEFAULT_TENANT_NAME = 'Demo ISP';
const DEFAULT_TENANT_SLUG = 'demo';

const DEFAULT_ADMIN_EMAIL = 'admin@ftth-copilot.local';
const DEFAULT_ADMIN_NAME = 'Admin User';
const DEFAULT_ADMIN_PASSWORD = 'admin123456';

async function main(): Promise<void> {
  console.log('🌱 Starting database seed...');

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
  console.log(`✓ Tenant ready: ${tenant.name} (${tenant.id})`);

  // 2. Ensure default admin user exists
  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  const user = await prisma.user.upsert({
    where: { email: DEFAULT_ADMIN_EMAIL },
    update: {
      name: DEFAULT_ADMIN_NAME,
      role: 'ADMIN',
      tenantId: tenant.id,
    },
    create: {
      email: DEFAULT_ADMIN_EMAIL,
      name: DEFAULT_ADMIN_NAME,
      passwordHash,
      role: 'ADMIN',
      tenantId: tenant.id,
    },
  });
  console.log(`✓ Admin user ready: ${user.email} (role: ${user.role})`);

  // 3. Ensure demo NMS connection exists
  const existingConn = await prisma.nmsConnection.findFirst({
    where: { tenantId: tenant.id, provider: 'SMARTOLT' },
  });

  if (!existingConn) {
    const conn = await prisma.nmsConnection.create({
      data: {
        id: 'demo-smartolt-connection',
        tenantId: tenant.id,
        provider: 'SMARTOLT',
        label: 'Demo SmartOLT (Mock)',
        encryptedKey: Buffer.from('mock-api-key').toString('base64'),
        status: 'connected',
      },
    });
    console.log(`✓ Default connection ready: ${conn.label} (${conn.id})`);
  } else {
    console.log(`✓ Connection already exists: ${existingConn.label} (${existingConn.id})`);
  }

  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
