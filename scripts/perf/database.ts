import { randomUUID } from 'node:crypto';

export async function withTenants<T>(
  count: number,
  run: (db: typeof import('@ftth-copilot/db'), tenantIds: string[]) => Promise<T>,
): Promise<T> {
  const connection = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
  if (!['postgresql:', 'postgres:'].includes(connection.protocol)
    || connection.hostname !== '127.0.0.1'
    || connection.pathname !== '/ftth_perf_test'
    || connection.search || connection.hash) {
    throw new Error('DATABASE_URL must target the dedicated loopback database ftth_perf_test');
  }

  const db = await import('@ftth-copilot/db');
  const prefix = `perf-${randomUUID()}`;
  const tenantIds = Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
  let seeded = false;
  try {
    await db.prisma.tenant.createMany({
      data: tenantIds.map((id) => ({ id, slug: id, name: id })),
    });
    seeded = true;
    return await run(db, tenantIds);
  } finally {
    try {
      if (seeded) await db.prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    } finally {
      await db.prisma.$disconnect();
    }
  }
}
