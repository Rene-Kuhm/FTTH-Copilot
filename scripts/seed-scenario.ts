#!/usr/bin/env tsx
/**
 * Seeds a synthetic NOC degradation scenario (RX drift + FEC + optical
 * sagging) and runs the detection pipeline against it, printing the
 * resulting alerts and incidents. No physical equipment needed.
 *
 *   DATABASE_URL=postgresql://ftth:ftth@localhost:5432/ftth_copilot \
 *     pnpm test:scenario
 *
 * Reruns are idempotent: the scenario tenant is dropped and recreated.
 */
import { prisma } from '@ftth-copilot/db';
import { buildNocDegradationScenario, persistSamples } from '@ftth-copilot/analytics';
import { runDetection } from '@ftth-copilot/alerts';

const TENANT_ID = 'scenario-tenant';
const CONNECTION_ID = 'scenario-connection';

async function main(): Promise<void> {
  const now = new Date();

  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.tenant.create({
    data: { id: TENANT_ID, name: 'Scenario Tenant', slug: 'scenario-tenant' },
  });
  await prisma.nmsConnection.create({
    data: {
      id: CONNECTION_ID,
      tenantId: TENANT_ID,
      provider: 'SMARTOLT',
      label: 'Scenario Connection',
      encryptedKey: Buffer.from('placeholder').toString('base64'),
      status: 'connected',
    },
  });

  const meta = { tenantId: TENANT_ID, connectionId: CONNECTION_ID };
  const points = buildNocDegradationScenario(meta, { now });
  const { inserted } = await persistSamples(points);
  console.log(`Seeded ${inserted} metric samples.`);

  const result = await runDetection({
    tenantId: TENANT_ID,
    connectionId: CONNECTION_ID,
    now,
  });
  console.log('Detection result:', result);

  const alerts = await prisma.detectedAlert.findMany({
    where: { tenantId: TENANT_ID, connectionId: CONNECTION_ID },
    orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
  });
  console.log(`\nAlerts (${alerts.length}):`);
  for (const a of alerts) {
    console.log(`  - [${a.severity}] ${a.kind} on ${a.deviceId}: ${a.title}`);
  }

  const incidents = await prisma.incident.findMany({
    where: { tenantId: TENANT_ID, connectionId: CONNECTION_ID },
    orderBy: [{ severity: 'desc' }],
  });
  console.log(`\nIncidents (${incidents.length}):`);
  for (const i of incidents) {
    console.log(`  - [${i.severity}] ${i.title} (${i.deviceKind} ${i.deviceId})`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
