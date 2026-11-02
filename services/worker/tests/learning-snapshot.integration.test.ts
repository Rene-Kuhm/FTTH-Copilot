import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@ftth-copilot/db';
import { buildLearningSnapshot } from '@ftth-copilot/learning';
import { runLearningSnapshot } from '../src/learning-snapshot';

/**
 * The learning snapshot against a real Postgres.
 *
 * The suite needs a live database: point `DATABASE_URL` at one. It skips
 * itself when the variable is missing, so the hermetic unit run stays green
 * on a machine without Postgres (same convention as the rest of the repo).
 *
 * What it proves: the job freezes the dataset, the artifact lands in the
 * table with the hash the pure core computed, and freezing the same dataset
 * twice does not create a second row.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const dbSuite = DATABASE_URL?.startsWith('postgres') ? describe : describe.skip;

const TENANT = 'it-learning-snapshot';
const USER = 'it-learning-snapshot-user';
const NOW = new Date('2026-11-02T12:00:00.000Z');

async function createTenant(): Promise<void> {
  await prisma.tenant.upsert({
    where: { slug: TENANT },
    update: {},
    create: { id: TENANT, name: 'Learning snapshot integration', slug: TENANT },
  });
  await prisma.user.upsert({
    where: { id: USER },
    update: {},
    create: {
      id: USER,
      tenantId: TENANT,
      email: `${TENANT}@example.test`,
      name: 'Integration technician',
      passwordHash: 'not-a-real-hash',
    },
  });
}

async function removeTenant(): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: TENANT } });
}

/** The rows the job reads: an incident under a splitter, and its feedback. */
async function seedDataset(): Promise<void> {
  await prisma.incident.create({
    data: {
      id: 'it-learning-snapshot-incident',
      tenantId: TENANT,
      deviceKind: 'ONU',
      deviceId: 'onu-it-1',
      title: 'Optical power drop',
      description: 'Downstream power below threshold',
      severity: 'warning',
      firstSeenAt: new Date('2026-10-25T10:00:00.000Z'),
      lastSeenAt: new Date('2026-10-25T10:30:00.000Z'),
    },
  });

  await prisma.topologyEdge.create({
    data: {
      id: 'it-learning-snapshot-edge',
      tenantId: TENANT,
      parentKind: 'SPLITTER',
      parentId: 'sp-it-1',
      childKind: 'ONU',
      childId: 'onu-it-1',
      validFrom: new Date('2020-01-01T00:00:00.000Z'),
      validTo: null,
      source: 'integration',
    },
  });

  await prisma.investigationVersion.create({
    data: {
      id: 'it-learning-snapshot-version',
      tenantId: TENANT,
      runId: 'it-learning-snapshot-run',
      versionId: 'v_it_1',
      versionIndex: 1,
      rulesetVersion: '0.2.2',
      promptVersion: '0.2.2',
      modelVersion: '0.2.2',
    },
  });

  await prisma.investigationFeedback.create({
    data: {
      id: 'it-learning-snapshot-feedback',
      tenantId: TENANT,
      runId: 'it-learning-snapshot-run',
      versionId: 'v_it_1',
      feedbackId: 'f_it_1',
      authorUserId: USER,
      label: 'confirmed',
      submittedAt: new Date('2026-10-25T12:00:00.000Z'),
    },
  });
}

dbSuite('learning snapshot (Postgres integration)', () => {
  beforeEach(async () => {
    await createTenant();
    await prisma.learningArtifact.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationFeedback.deleteMany({ where: { tenantId: TENANT } });
    await prisma.investigationVersion.deleteMany({ where: { tenantId: TENANT } });
    await prisma.topologyEdge.deleteMany({ where: { tenantId: TENANT } });
    await prisma.incident.deleteMany({ where: { tenantId: TENANT } });
    await seedDataset();
  });

  afterEach(async () => {
    await removeTenant();
  });

  it('congela el dataset y guarda el artefacto con su hash', async () => {
    const outcomes = await runLearningSnapshot({ tenantId: TENANT, now: NOW });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.created).toBe(true);
    expect(outcomes[0]?.snapshotHash).toMatch(/^s_[0-9a-f]{16}$/);

    const artifacts = await prisma.learningArtifact.findMany({ where: { tenantId: TENANT } });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.snapshotHash).toBe(outcomes[0]?.snapshotHash);
    expect(artifacts[0]?.kind).toBe('snapshot');
    expect(artifacts[0]?.codeVersion).toBeTruthy();
  });

  it('el artefacto lleva el dataset congelado: etiquetas y eventos', async () => {
    await runLearningSnapshot({ tenantId: TENANT, now: NOW });

    const artifact = await prisma.learningArtifact.findFirst({ where: { tenantId: TENANT } });
    const payload = artifact?.payload as {
      labels?: Array<{ versionId?: string; label?: string }>;
      events?: Array<{ incidentIds?: string[] }>;
    };

    expect(payload.labels).toHaveLength(1);
    expect(payload.labels?.[0]).toMatchObject({ versionId: 'v_it_1', label: 'confirmed' });
    expect(payload.events?.[0]?.incidentIds).toContain('it-learning-snapshot-incident');
  });

  it('el hash coincide con el que calcula el núcleo puro', async () => {
    const outcomes = await runLearningSnapshot({ tenantId: TENANT, now: NOW });

    const feedback = await prisma.investigationFeedback.findMany({
      where: { tenantId: TENANT },
      orderBy: { submittedAt: 'asc' },
    });
    const incidents = await prisma.incident.findMany({
      where: { tenantId: TENANT },
      orderBy: { lastSeenAt: 'asc' },
    });
    const topology = await prisma.topologyEdge.findMany({ where: { tenantId: TENANT } });

    const windowEnd = NOW;
    const windowStart = new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    const cutoff = new Date(windowStart.getTime() + (windowEnd.getTime() - windowStart.getTime()) / 2);

    const expected = buildLearningSnapshot({
      tenantId: TENANT,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      codeVersion: outcomes[0] ? (await prisma.learningArtifact.findFirstOrThrow({
        where: { tenantId: TENANT },
      })).codeVersion : '',
      cutoff: cutoff.toISOString(),
      feedbackRows: feedback.map((row) => ({
        tenantId: row.tenantId,
        versionId: row.versionId,
        feedbackId: row.feedbackId,
        authorUserId: row.authorUserId,
        label: row.label,
        submittedAt: row.submittedAt.toISOString(),
      })),
      incidents: incidents.map((row) => ({
        tenantId: row.tenantId,
        incidentId: row.id,
        nodeKind: row.deviceKind,
        nodeId: row.deviceId,
        observedAt: row.lastSeenAt.toISOString(),
      })),
      topology: topology.map((row) => ({
        tenantId: row.tenantId,
        parentKind: row.parentKind,
        parentId: row.parentId,
        childKind: row.childKind,
        childId: row.childId,
        validFrom: row.validFrom.toISOString(),
        validTo: row.validTo?.toISOString() ?? null,
      })),
    });

    expect(expected.snapshotHash).toBe(outcomes[0]?.snapshotHash);
  });

  it('volver a congelar el mismo dataset no crea una segunda fila', async () => {
    const primero = await runLearningSnapshot({ tenantId: TENANT, now: NOW });
    const segundo = await runLearningSnapshot({ tenantId: TENANT, now: NOW });

    expect(segundo[0]?.snapshotHash).toBe(primero[0]?.snapshotHash);
    expect(segundo[0]?.created).toBe(false);
    expect(await prisma.learningArtifact.count({ where: { tenantId: TENANT } })).toBe(1);
  });

  it('un tenant que no existe no deja artefacto: la clave foránea lo impide', async () => {
    // Congelar un tenant inexistente es un error de configuración, no algo
    // que se pueda ignorar en silencio: la clave foránea lo dice.
    await expect(
      runLearningSnapshot({ tenantId: 'otro-tenant-que-no-existe', now: NOW }),
    ).rejects.toThrow();

    expect(await prisma.learningArtifact.count({ where: { tenantId: TENANT } })).toBe(0);
  });
});
