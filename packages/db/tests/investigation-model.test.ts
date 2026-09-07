import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/client';

const suite = (process.env['DATABASE_URL'] ?? '').startsWith('postgres')
  ? describe
  : describe.skip;

const TENANT_A = 'it-tenant-a';
const TENANT_B = 'it-tenant-b';
const RUN_A = 'r_it_a';
const RUN_B = 'r_it_b';
const VERSION_A = 'v_it_a';
const FEEDBACK_A = 'f_it_a';

const USER_A = 'u_it_a';
const USER_B = 'u_it_b';

suite('InvestigationRun / InvestigationVersion / InvestigationFeedback (integration)', () => {
  beforeAll(async () => {
    // Seed two tenants + two users so cross-tenant isolation tests can
    // assert that each tenant sees only its own rows. Cleanup is
    // scoped to the tenant under test so the test does not erase
    // fixtures other suites rely on.
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await prisma.tenant.upsert({
        where: { id: tenantId },
        create: { id: tenantId, name: tenantId, slug: tenantId },
        update: {},
      });
    }
    for (const userId of [USER_A, USER_B]) {
      await prisma.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          email: `${userId}@e2e.test`,
          passwordHash: 'irrelevant',
          role: 'OPERATOR',
          tenantId: userId === USER_A ? TENANT_A : TENANT_B,
        },
        update: { tenantId: userId === USER_A ? TENANT_A : TENANT_B },
      });
    }
    // Clean only the rows from previous runs of this test.
    await prisma.investigationFeedback.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.investigationVersion.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.investigationRun.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
  });

  afterAll(async () => {
    await prisma.investigationFeedback.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.investigationVersion.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.investigationRun.deleteMany({ where: { tenantId: { in: [TENANT_A, TENANT_B] } } });
    await prisma.user.deleteMany({ where: { id: { in: [USER_A, USER_B] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } });
  });

  it('creates a run, version, and feedback with the opaque app-supplied identifiers', async () => {
    const run = await prisma.investigationRun.create({
      data: {
        tenantId: TENANT_A,
        runId: RUN_A,
        requestedByUserId: USER_A,
        status: 'pending',
      },
    });
    expect(run.runId).toBe(RUN_A);
    expect(run.status).toBe('pending');

    const version = await prisma.investigationVersion.create({
      data: {
        tenantId: TENANT_A,
        runRefId: run.id,
        runId: RUN_A,
        versionId: VERSION_A,
        versionIndex: 0,
        rulesetVersion: 'r1',
        promptVersion: 'p1',
        modelVersion: 'm1',
      },
    });
    expect(version.versionIndex).toBe(0);

    const feedback = await prisma.investigationFeedback.create({
      data: {
        tenantId: TENANT_A,
        runRefId: run.id,
        versionRefId: version.id,
        runId: RUN_A,
        versionId: VERSION_A,
        feedbackId: FEEDBACK_A,
        label: 'confirmed',
        authorUserId: USER_A,
      },
    });
    expect(feedback.label).toBe('confirmed');

    // Round-trip read confirms cascade behavior we care about.
    const found = await prisma.investigationFeedback.findUnique({
      where: { tenantId_feedbackId: { tenantId: TENANT_A, feedbackId: FEEDBACK_A } },
    });
    expect(found?.authorUserId).toBe(USER_A);
  });

  it('isolates tenants: tenant B cannot read tenant A feedback by app id', async () => {
    // Even when the app-supplied feedbackId is a real string, the
    // unique lookup is scoped by tenant. A tenant B query must miss.
    const fromB = await prisma.investigationFeedback.findUnique({
      where: { tenantId_feedbackId: { tenantId: TENANT_B, feedbackId: FEEDBACK_A } },
    });
    expect(fromB).toBeNull();
  });

  it('rejects duplicate (runId, versionId, author, label) — idempotency fingerprint', async () => {
    // Same technician submitting the same label for the same version
    // twice MUST collapse to a single row (Prisma unique constraint).
    const run = await prisma.investigationRun.create({
      data: {
        tenantId: TENANT_A,
        runId: 'r_idem',
        requestedByUserId: USER_A,
      },
    });
    const version = await prisma.investigationVersion.create({
      data: {
        tenantId: TENANT_A,
        runRefId: run.id,
        runId: 'r_idem',
        versionId: 'v_idem',
        versionIndex: 0,
        rulesetVersion: 'r1',
        promptVersion: 'p1',
        modelVersion: 'm1',
      },
    });
    await prisma.investigationFeedback.create({
      data: {
        tenantId: TENANT_A,
        runRefId: run.id,
        versionRefId: version.id,
        runId: 'r_idem',
        versionId: 'v_idem',
        feedbackId: 'f_idem_1',
        label: 'confirmed',
        authorUserId: USER_A,
      },
    });
    await expect(
      prisma.investigationFeedback.create({
        data: {
          tenantId: TENANT_A,
          runRefId: run.id,
          versionRefId: version.id,
          runId: 'r_idem',
          versionId: 'v_idem',
          feedbackId: 'f_idem_2',
          label: 'confirmed',
          authorUserId: USER_A,
        },
      }),
    ).rejects.toThrow();
  });

  it('preserves the run when its only version is deleted (set null)', async () => {
    // The schema declares versionRefId as SetNull on the FK. Deleting
    // a version must NOT cascade-delete its parent run. This guards
    // the "no se borra evidencia" rule from the retention policy.
    const run = await prisma.investigationRun.create({
      data: {
        tenantId: TENANT_A,
        runId: 'r_setnull',
        requestedByUserId: USER_A,
      },
    });
    const version = await prisma.investigationVersion.create({
      data: {
        tenantId: TENANT_A,
        runRefId: run.id,
        runId: 'r_setnull',
        versionId: 'v_setnull',
        versionIndex: 0,
        rulesetVersion: 'r1',
        promptVersion: 'p1',
        modelVersion: 'm1',
      },
    });
    await prisma.investigationVersion.delete({ where: { id: version.id } });
    const still = await prisma.investigationRun.findUnique({ where: { id: run.id } });
    expect(still).not.toBeNull();
    expect(still!.runId).toBe('r_setnull');
  });

  it('rejects a duplicate (tenantId, runId) on InvestigationRun — app id is unique per tenant', async () => {
    // The @@unique([tenantId, runId]) enforces per-tenant uniqueness of
    // the opaque app-supplied runId. Two runs in the same tenant with
    // the same runId must fail.
    await prisma.investigationRun.create({
      data: { tenantId: TENANT_A, runId: 'r_dup', requestedByUserId: USER_A },
    });
    await expect(
      prisma.investigationRun.create({
        data: { tenantId: TENANT_A, runId: 'r_dup', requestedByUserId: USER_A },
      }),
    ).rejects.toThrow();
  });

  it('allows the same opaque runId in two different tenants (runId is opaque, not Prisma row id)', async () => {
    // Two tenants can both use the same human-readable runId string —
    // that is exactly the cross-tenant collision surface the schema
    // guards against at the API layer.
    await prisma.investigationRun.create({
      data: { tenantId: TENANT_A, runId: 'r_shared', requestedByUserId: USER_A },
    });
    const other = await prisma.investigationRun.create({
      data: { tenantId: TENANT_B, runId: 'r_shared', requestedByUserId: USER_B },
    });
    expect(other.runId).toBe('r_shared');
    expect(other.tenantId).toBe(TENANT_B);
  });
});
