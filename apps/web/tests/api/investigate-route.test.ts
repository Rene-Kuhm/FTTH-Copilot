import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvestigationResult } from '@ftth-copilot/shared';
import type { PersistedInvestigationVersion } from '@ftth-copilot/db';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  consumeInvestigationQuota: vi.fn(),
  runInvestigationPipeline: vi.fn(),
  claimInvestigationAttempt: vi.fn(),
  completeInvestigation: vi.fn(),
  failInvestigation: vi.fn(),
  awaitAttemptOutcome: vi.fn(),
  enqueueInvestigationAttempt: vi.fn(),
  workerOwnsBackgroundWork: vi.fn(),
  getLatestInvestigationVersion: vi.fn(),
  prismaIncidentFindFirst: vi.fn(),
  prismaInvestigationRunFindFirst: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@/lib/investigations/quota', () => ({
  consumeInvestigationQuota: mocks.consumeInvestigationQuota,
}));

vi.mock('@/lib/investigations/pipeline', () => ({
  runInvestigationPipeline: mocks.runInvestigationPipeline,
  claimInvestigationAttempt: mocks.claimInvestigationAttempt,
  completeInvestigation: mocks.completeInvestigation,
  failInvestigation: mocks.failInvestigation,
  awaitAttemptOutcome: mocks.awaitAttemptOutcome,
}));

vi.mock('@/lib/investigations/dispatch', () => ({
  enqueueInvestigationAttempt: mocks.enqueueInvestigationAttempt,
}));

vi.mock('@ftth-copilot/jobs', () => ({
  workerOwnsBackgroundWork: mocks.workerOwnsBackgroundWork,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    incident: { findFirst: mocks.prismaIncidentFindFirst },
    investigationRun: { findFirst: mocks.prismaInvestigationRunFindFirst },
  },
  getLatestInvestigationVersion: mocks.getLatestInvestigationVersion,
}));

const fakeUser = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const INCIDENT = {
  id: 'inc-1',
  deviceKind: 'ONU',
  deviceId: 'onu-1',
  connectionId: 'conn-1',
};

const validSnapshot: InvestigationResult = {
  schema: 'ftth.investigation-result.v1',
  resultId: 'res-test-1',
  runId: 'r_test',
  versionId: 'v_test',
  tenantId: 'tenant-1',
  connectionId: 'conn-1',
  incidentId: 'inc-1',
  windowStart: '2026-09-08T00:00:00.000Z',
  windowEnd: '2026-09-09T00:00:00.000Z',
  windowDays: 1,
  cutoffAt: '2026-09-09T00:00:00.000Z',
  rulesetVersion: 'ruleset@1.0.0',
  modelVersion: 'test-model',
  promptVersion: 'prompt@1.0.0',
  evidenceRefs: [],
  hypotheses: [
    {
      hypothesisId: 'hyp-1',
      summary: 'Atenuación severa detectada',
      supportLevel: 'supported',
      forRefIds: [],
      againstRefIds: [],
    },
  ],
  contradictions: [],
  missing: [],
  suggestedChecks: [],
  sufficiency: 'sufficient',
  sufficiencyReason: 'Evidencia consistente',
  producedAt: '2026-09-09T00:01:00.000Z',
  producedBy: 'agent-core@0.1.0',
};

const persistedVersionV0: PersistedInvestigationVersion = {
  id: 'db-ver-0',
  tenantId: 'tenant-1',
  runId: 'r_test',
  versionId: 'v_test',
  versionIndex: 0,
  rulesetVersion: 'ruleset@1.0.0',
  promptVersion: 'prompt@1.0.0',
  modelVersion: 'test-model',
  snapshot: validSnapshot,
  snapshotAt: new Date('2026-09-09T00:01:00.000Z'),
};

const CLAIMED = {
  kind: 'claimed' as const,
  runId: 'r_test',
  versionId: 'v_test',
  attemptStartedAt: new Date('2026-09-09T00:00:00.000Z'),
};

function resetMocks() {
  for (const mock of Object.values(mocks)) mock.mockReset();

  mocks.getCurrentUser.mockResolvedValue(fakeUser);
  mocks.hasPermission.mockReturnValue(true);
  mocks.consumeInvestigationQuota.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.prismaIncidentFindFirst.mockResolvedValue(INCIDENT);
  mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);
  mocks.workerOwnsBackgroundWork.mockReturnValue(false);
  mocks.claimInvestigationAttempt.mockResolvedValue(CLAIMED);
  mocks.runInvestigationPipeline.mockResolvedValue(validSnapshot);
  mocks.completeInvestigation.mockResolvedValue({ versionId: 'v_test', versionIndex: 0, applied: true });
  mocks.failInvestigation.mockResolvedValue(true);
  mocks.getLatestInvestigationVersion.mockResolvedValue(persistedVersionV0);
  mocks.enqueueInvestigationAttempt.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callPost(id: string, body: Record<string, unknown> = {}): Promise<Response> {
  const { POST } = await import('@/app/api/incidents/[id]/investigate/route');
  const req = new Request(`http://localhost/api/incidents/${id}/investigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ id }),
  });
}

async function callGet(id: string): Promise<Response> {
  const { GET } = await import('@/app/api/incidents/[id]/investigate/route');
  const req = new Request(`http://localhost/api/incidents/${id}/investigate`, {
    method: 'GET',
  });
  return GET(req as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ id }),
  });
}

/** Lets the promises scheduled by a route settle. */
function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('POST /api/incidents/:id/investigate — security & quotas', () => {
  it('returns 403 when user lacks view_network', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await callPost('inc-1');
    expect(res.status).toBe(403);
  });

  it('returns 401 when unauthenticated', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callPost('inc-1');
    expect(res.status).toBe(401);
  });

  it('returns 429 with Retry-After when investigation quota is exceeded', async () => {
    mocks.consumeInvestigationQuota.mockResolvedValue({ allowed: false, retryAfter: 45 });
    const res = await callPost('inc-1');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
    const json = (await res.json()) as { error: string; retryAfter: number };
    expect(json.retryAfter).toBe(45);
    expect(mocks.runInvestigationPipeline).not.toHaveBeenCalled();
  });

  it('returns 404 when incident does not belong to caller tenant', async () => {
    mocks.prismaIncidentFindFirst.mockResolvedValue(null);
    const res = await callPost('inc-other-tenant');
    expect(res.status).toBe(404);
    expect(mocks.claimInvestigationAttempt).not.toHaveBeenCalled();
  });
});

describe('POST /api/incidents/:id/investigate — duplicate protection', () => {
  it('returns 202 Pending when an investigation is already in-flight', async () => {
    mocks.claimInvestigationAttempt.mockResolvedValue({ kind: 'pending', runId: 'r_inflight' });

    const res = await callPost('inc-1');
    expect(res.status).toBe(202);
    const json = (await res.json()) as { status: string; runId: string; retryAfterMs: number };
    expect(json.status).toBe('pending');
    expect(json.runId).toBe('r_inflight');
    expect(json.retryAfterMs).toBe(3000);
    expect(mocks.runInvestigationPipeline).not.toHaveBeenCalled();
    expect(mocks.enqueueInvestigationAttempt).not.toHaveBeenCalled();
  });

  it('claims within the caller tenant and passes the refresh flag', async () => {
    await callPost('inc-1', { refresh: true });

    expect(mocks.claimInvestigationAttempt).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      incidentId: 'inc-1',
      connectionId: 'conn-1',
      userId: 'user-1',
      refresh: true,
    });
  });
});

describe('POST /api/incidents/:id/investigate — embedded mode', () => {
  it('runs the pipeline once, closes it, and returns 201 with the diagnosis', async () => {
    const res = await callPost('inc-1');
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      status: string;
      versionIndex: number;
      result: InvestigationResult;
    };
    expect(body.status).toBe('ready');
    expect(body.versionIndex).toBe(0);
    expect(body.result.schema).toBe('ftth.investigation-result.v1');
    expect(mocks.runInvestigationPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.completeInvestigation).toHaveBeenCalledTimes(1);
    expect(mocks.completeInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r_test', versionId: 'v_test', investigationResult: validSnapshot }),
    );
    expect(mocks.enqueueInvestigationAttempt).not.toHaveBeenCalled();
  });

  it('returns 200 with idempotent: true when run is ready and refresh is not requested', async () => {
    mocks.claimInvestigationAttempt.mockResolvedValue({ kind: 'ready', runId: 'r_ready' });

    const res = await callPost('inc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; idempotent: boolean };
    expect(body.status).toBe('ready');
    expect(body.idempotent).toBe(true);
    expect(mocks.runInvestigationPipeline).not.toHaveBeenCalled();
  });

  it('creates a new version when refresh: true is passed', async () => {
    mocks.completeInvestigation.mockResolvedValue({ versionId: 'v_test', versionIndex: 1, applied: true });

    const res = await callPost('inc-1', { refresh: true });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; versionIndex: number; idempotent: boolean };
    expect(body.versionIndex).toBe(1);
    expect(body.idempotent).toBe(false);
    expect(mocks.runInvestigationPipeline).toHaveBeenCalledTimes(1);
  });

  it('past the budget answers 202 and still stores the result of THE SAME run', async () => {
    mocks.runInvestigationPipeline.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(validSnapshot), 120)),
    );

    const res = await callPost('inc-1', { timeoutMs: 30 });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; retryAfterMs: number; versionId: string };
    expect(body.status).toBe('pending');
    expect(body.retryAfterMs).toBe(3000);
    expect(body.versionId).toBe('v_test');
    expect(mocks.completeInvestigation).not.toHaveBeenCalled();

    await settle(200);

    // The late result is stored by the promise that was already running:
    // the pipeline never starts a second time.
    expect(mocks.runInvestigationPipeline).toHaveBeenCalledTimes(1);
    expect(mocks.completeInvestigation).toHaveBeenCalledTimes(1);
    expect(mocks.failInvestigation).not.toHaveBeenCalled();
  });

  it('a failing pipeline leaves the run failed and answers 500', async () => {
    mocks.runInvestigationPipeline.mockRejectedValue(new Error('database exploded'));

    const res = await callPost('inc-1');
    expect(res.status).toBe(500);
    expect(mocks.failInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r_test', versionId: 'v_test', reason: 'database exploded' }),
    );
    expect(mocks.completeInvestigation).not.toHaveBeenCalled();
  });

  it('a pipeline that fails after the budget still leaves the run failed', async () => {
    mocks.runInvestigationPipeline.mockImplementation(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late failure')), 120)),
    );

    const res = await callPost('inc-1', { timeoutMs: 30 });
    expect(res.status).toBe(202);

    await settle(200);

    expect(mocks.failInvestigation).toHaveBeenCalledTimes(1);
    expect(mocks.failInvestigation).toHaveBeenCalledWith(expect.objectContaining({ reason: 'late failure' }));
    expect(mocks.runInvestigationPipeline).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/incidents/:id/investigate — worker mode', () => {
  beforeEach(() => {
    mocks.workerOwnsBackgroundWork.mockReturnValue(true);
  });

  it('enqueues the attempt and never runs the pipeline in the request', async () => {
    mocks.awaitAttemptOutcome.mockResolvedValue({ kind: 'ready', version: persistedVersionV0 });

    const res = await callPost('inc-1');

    expect(res.status).toBe(201);
    expect(mocks.runInvestigationPipeline).not.toHaveBeenCalled();
    expect(mocks.enqueueInvestigationAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        incidentId: 'inc-1',
        runId: 'r_test',
        versionId: 'v_test',
        userId: 'user-1',
      }),
    );
    const body = (await res.json()) as { result: InvestigationResult };
    expect(body.result.schema).toBe('ftth.investigation-result.v1');
  });

  it('answers 202 when the worker does not finish within the budget', async () => {
    mocks.awaitAttemptOutcome.mockResolvedValue({ kind: 'timeout' });

    const res = await callPost('inc-1', { timeoutMs: 50 });

    expect(res.status).toBe(202);
    expect(mocks.awaitAttemptOutcome).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      runId: 'r_test',
      versionId: 'v_test',
      timeoutMs: 50,
    });
  });

  it('answers 500 when the worker reports the attempt failed', async () => {
    mocks.awaitAttemptOutcome.mockResolvedValue({ kind: 'failed' });

    const res = await callPost('inc-1');

    expect(res.status).toBe(500);
  });

  it('fails the attempt and answers 503 when the queue is unavailable', async () => {
    mocks.enqueueInvestigationAttempt.mockRejectedValue(new Error('NOAUTH'));

    const res = await callPost('inc-1');

    expect(res.status).toBe(503);
    expect(mocks.failInvestigation).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r_test', versionId: 'v_test' }),
    );
    expect(mocks.awaitAttemptOutcome).not.toHaveBeenCalled();
  });
});

describe('GET /api/incidents/:id/investigate', () => {
  it('returns 404 when run does not exist for incident', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue(null);
    const res = await callGet('inc-1');
    expect(res.status).toBe(404);
  });

  it('returns 200 with run status and latest version snapshot', async () => {
    mocks.prismaInvestigationRunFindFirst.mockResolvedValue({
      id: 'run-row-ready',
      runId: 'r_ready',
      status: 'ready',
      requestedAt: new Date('2026-09-09T00:00:00.000Z'),
    });

    const res = await callGet('inc-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runId: string;
      status: string;
      version: { versionId: string; versionIndex: number; snapshot: InvestigationResult };
    };
    expect(body.runId).toBe('r_ready');
    expect(body.status).toBe('ready');
    expect(body.version.versionIndex).toBe(0);
    expect(body.version.snapshot.schema).toBe('ftth.investigation-result.v1');
  });
});
