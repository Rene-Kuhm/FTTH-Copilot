import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@ftth-copilot/db';
import { runDetection } from '../../src/manager';

const DATABASE_URL = process.env['DATABASE_URL'];
const suite = DATABASE_URL ? describe : describe.skip;

const TENANT_ID = 'it-tenant';
const CONNECTION_ID = 'it-connection';
const NOW = new Date('2026-08-21T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function rxSamples() {
  return [-22, -23, -24, -25, -26].map((value, index) => ({
    tenantId: TENANT_ID,
    connectionId: CONNECTION_ID,
    deviceKind: 'ONU',
    deviceId: 'onu-1',
    kind: 'RX_POWER_DBM',
    value,
    valueText: null,
    sampledAt: new Date(NOW.getTime() - (4 - index) * DAY),
  }));
}

suite('runDetection (integration, Postgres)', () => {
  beforeAll(async () => {
    // Cascades to nms_connections, metric_samples and detected_alerts.
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.tenant.create({
      data: { id: TENANT_ID, name: 'IT Tenant', slug: 'it-tenant' },
    });
    await prisma.nmsConnection.create({
      data: {
        id: CONNECTION_ID,
        tenantId: TENANT_ID,
        provider: 'SMARTOLT',
        label: 'IT Connection',
        encryptedKey: 'it-encrypted',
        encryptionMeta: 'it-meta',
        status: 'connected',
      },
    });
  });

  afterAll(async () => {
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.$disconnect();
  });

  it('creates, dedupes and resolves an alert end to end', async () => {
    await prisma.metricSample.createMany({ data: rxSamples() });

    // First run: descending RX is detected and an open alert is created.
    const first = await runDetection({ tenantId: TENANT_ID, connectionId: CONNECTION_ID, now: NOW });
    expect(first.detected).toBe(1);
    expect(first.upserted).toBe(1);

    let alerts = await prisma.detectedAlert.findMany({
      where: { tenantId: TENANT_ID, connectionId: CONNECTION_ID },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe('predicted_low_signal');
    expect(alerts[0]!.status).toBe('open');
    expect(alerts[0]!.resolvedAt).toBeNull();

    // Second run within the cooldown: same finding, no duplicate row.
    await runDetection({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      now: new Date(NOW.getTime() + 1000),
    });
    alerts = await prisma.detectedAlert.findMany({
      where: { tenantId: TENANT_ID, connectionId: CONNECTION_ID },
    });
    expect(alerts).toHaveLength(1);

    // Clear samples and run past the resolve window: alert auto-resolves.
    await prisma.metricSample.deleteMany({ where: { tenantId: TENANT_ID, connectionId: CONNECTION_ID } });
    const third = await runDetection({
      tenantId: TENANT_ID,
      connectionId: CONNECTION_ID,
      now: new Date(NOW.getTime() + 25 * 60 * 60 * 1000),
      resolveAfterMs: 24 * 60 * 60 * 1000,
    });
    expect(third.detected).toBe(0);

    alerts = await prisma.detectedAlert.findMany({
      where: { tenantId: TENANT_ID, connectionId: CONNECTION_ID },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.status).toBe('resolved');
    expect(alerts[0]!.resolvedAt).not.toBeNull();
  });
});
