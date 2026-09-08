import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for
 *   apps/web/app/api/investigations/[runId]/feedbacks/route.ts
 *
 * Contract under test:
 *  1. GET is gated on `view_network` — 403 without it (zero writes).
 *  2. Unknown runId in caller tenant → 404.
 *  3. limit query param clamps to [1, 200]; out-of-range → 400.
 *  4. Response is ordered by `submittedAt` ascending with bounded
 *     count and `limit` echoed back.
 *  5. Empty result returns `feedbacks: []` and `count: 0`, never 404
 *     (only the runId is the existence check).
 *  6. The route MUST NOT honor any client-supplied tenantId; the
 *     lookup is always `tenantId: user.tenantId`.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaRunFindFirst: vi.fn(),
  prismaFeedbackFindMany: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    investigationRun: {
      findFirst: mocks.prismaRunFindFirst,
    },
    investigationFeedback: {
      findMany: mocks.prismaFeedbackFindMany,
    },
  },
}));

const fakeUserA = {
  id: 'user-a',
  email: 'a@isp.com',
  name: 'A',
  role: 'OPERATOR' as const,
  tenantId: 'tenant-a',
  tenant: { id: 'tenant-a', name: 'A', slug: 'a' },
};

const RUN = {
  runId: 'r_1',
  status: 'pending',
  requestedAt: new Date('2026-09-01T00:00:00.000Z'),
};

function resetMocks() {
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaRunFindFirst.mockReset();
  mocks.prismaFeedbackFindMany.mockReset();
  mocks.prismaRunFindFirst.mockResolvedValue(RUN);
  mocks.prismaFeedbackFindMany.mockResolvedValue([]);
}

beforeEach(() => {
  resetMocks();
  mocks.getCurrentUser.mockResolvedValue(fakeUserA);
  mocks.hasPermission.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(runId: string, url = `http://localhost/api/investigations/${runId}/feedbacks`): Promise<Response> {
  const { GET } = await import('@/app/api/investigations/[runId]/feedbacks/route');
  const req = new Request(url, { method: 'GET' });
  return GET(req as unknown as Parameters<typeof GET>[0], {
    params: Promise.resolve({ runId }),
  });
}

describe('GET /api/investigations/:runId/feedbacks — permission gate', () => {
  it('returns 403 when the user lacks view_network (no DB read)', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const res = await callRoute('r_1');
    expect(res.status).toBe(403);
    expect(mocks.prismaRunFindFirst).not.toHaveBeenCalled();
    expect(mocks.prismaFeedbackFindMany).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no authenticated user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callRoute('r_1');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/investigations/:runId/feedbacks — run lookup', () => {
  it('returns 404 when the runId does not exist for this tenant', async () => {
    mocks.prismaRunFindFirst.mockResolvedValue(null);
    const res = await callRoute('r_foreign');
    expect(res.status).toBe(404);
    expect(mocks.prismaFeedbackFindMany).not.toHaveBeenCalled();
  });

  it('returns 200 with empty list when the run exists but has no feedback', async () => {
    mocks.prismaFeedbackFindMany.mockResolvedValue([]);
    const res = await callRoute('r_1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runId: string;
      feedbacks: unknown[];
      count: number;
      limit: number;
    };
    expect(body.runId).toBe('r_1');
    expect(body.feedbacks).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.limit).toBe(50);
  });
});

describe('GET /api/investigations/:runId/feedbacks — limit parsing', () => {
  it('clamps limit to 200 when client asks for 1000', async () => {
    const res = await callRoute('r_1', 'http://localhost/api/investigations/r_1/feedbacks?limit=1000');
    expect(res.status).toBe(400);
    expect(mocks.prismaFeedbackFindMany).not.toHaveBeenCalled();
  });

  it('rejects limit=0', async () => {
    const res = await callRoute('r_1', 'http://localhost/api/investigations/r_1/feedbacks?limit=0');
    expect(res.status).toBe(400);
  });

  it('rejects non-integer limit', async () => {
    const res = await callRoute('r_1', 'http://localhost/api/investigations/r_1/feedbacks?limit=abc');
    expect(res.status).toBe(400);
  });

  it('accepts limit=1 (lower bound) and limit=200 (upper bound)', async () => {
    const r1 = await callRoute('r_1', 'http://localhost/api/investigations/r_1/feedbacks?limit=1');
    expect(r1.status).toBe(200);
    const r200 = await callRoute('r_1', 'http://localhost/api/investigations/r_1/feedbacks?limit=200');
    expect(r200.status).toBe(200);
  });
});

describe('GET /api/investigations/:runId/feedbacks — tenant scoping', () => {
  it('queries Prisma with the caller tenantId (never trusts client)', async () => {
    mocks.prismaFeedbackFindMany.mockResolvedValue([]);
    await callRoute('r_1');
    expect(mocks.prismaRunFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
    expect(mocks.prismaFeedbackFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
  });
});

describe('GET /api/investigations/:runId/feedbacks — response shape', () => {
  it('maps DB rows to the JSON contract, ISO-dating submittedAt', async () => {
    const rows = [
      {
        feedbackId: 'f_1',
        runId: 'r_1',
        versionId: 'v_1',
        label: 'confirmed',
        observations: null,
        realCause: 'Conector sucio',
        resolutionEvidence: null,
        authorUserId: 'user-a',
        submittedAt: new Date('2026-09-07T10:00:00.000Z'),
      },
    ];
    mocks.prismaFeedbackFindMany.mockResolvedValue(rows);
    const res = await callRoute('r_1');
    const body = (await res.json()) as {
      feedbacks: Array<{ feedbackId: string; submittedAt: string }>;
    };
    expect(body.feedbacks[0]?.feedbackId).toBe('f_1');
    expect(body.feedbacks[0]?.submittedAt).toBe('2026-09-07T10:00:00.000Z');
  });
});
