import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RED tests for the admin promotion route at
 * `apps/web/app/api/pending-incidents/promote/route.ts` (WU4 / D-5.1).
 *
 * Contract under test:
 *  1. POST is gated on OWNER role — 403 for any other role.
 *  2. When `promotePendingIncidents` returns `{ promoted, skipped }` the
 *     route forwards the counters verbatim with status 200.
 *
 * The DB-touching helper is mocked here so the route stays a thin gate; the
 * helper itself is exercised in `promote-pending-incidents.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  promotePendingIncidents: vi.fn(),
  prismaTenantPolicyFindMany: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/promote-pending-incidents', () => ({
  promotePendingIncidents: mocks.promotePendingIncidents,
}));

vi.mock('@/lib/policies/load-tenant-policy', () => ({
  loadTenantPolicy: async (tenantId: string) => {
    const row = mocks.prismaTenantPolicyFindMany.mock.results
      .flatMap((r) => (r.type === 'return' ? (r.value as Array<Record<string, unknown>>) : []))
      .find((r) => r['tenantId'] === tenantId);
    if (!row) return null;
    return {
      schema: 'ftth.tenant-policy.v1' as const,
      schemaVersion: 1,
      tenantId: row['tenantId'] as string,
      ...(row['retrievalLimit'] != null ? { retrievalLimit: row['retrievalLimit'] as number } : {}),
      ...(row['retrievalSinceDays'] != null
        ? { retrievalSinceDays: row['retrievalSinceDays'] as number }
        : {}),
      ...(row['truthGateMode'] != null ? { truthGateMode: row['truthGateMode'] as 'observe' | 'strict' } : {}),
      ...(row['abstainOnCodes'] != null ? { abstainOnCodes: ['stale'] as const } : {}),
      ...(row['promotionMinAgeMs'] != null
        ? { promotionMinAgeMs: row['promotionMinAgeMs'] as number }
        : {}),
      createdAt: '2026-09-01T11:00:00.000Z',
      updatedAt: '2026-09-01T11:00:00.000Z',
    };
  },
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    tenantPolicy: {
      findMany: mocks.prismaTenantPolicyFindMany,
    },
  },
}));

const fakeOwner = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

const fakeAdmin = {
  ...fakeOwner,
  role: 'ADMIN' as const,
};

beforeEach(() => {
  mocks.getCurrentUser.mockReset();
  mocks.promotePendingIncidents.mockReset();
  mocks.prismaTenantPolicyFindMany.mockReset();
  mocks.prismaTenantPolicyFindMany.mockResolvedValue([]);
  mocks.promotePendingIncidents.mockResolvedValue({ promoted: 0, skipped: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function callRoute(): Promise<Response> {
  const { POST } = await import('@/app/api/pending-incidents/promote/route');
  const req = new Request('http://localhost/api/pending-incidents/promote', {
    method: 'POST',
  });
  return POST(req as unknown as Parameters<typeof POST>[0]);
}

describe('POST /api/pending-incidents/promote — permission gate', () => {
  it('returns 401 when no user is signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await callRoute();
    expect(res.status).toBe(401);
    expect(mocks.promotePendingIncidents).not.toHaveBeenCalled();
  });

  it('returns 403 for non-OWNER roles', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeAdmin);
    const res = await callRoute();
    expect(res.status).toBe(403);
    expect(mocks.promotePendingIncidents).not.toHaveBeenCalled();
  });

  it('returns 200 for the OWNER role and forwards the helper counters', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeOwner);
    mocks.promotePendingIncidents.mockResolvedValueOnce({ promoted: 2, skipped: 1 });
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { promoted: number; skipped: number };
    expect(body).toEqual({ promoted: 2, skipped: 1 });
    expect(mocks.promotePendingIncidents).toHaveBeenCalledTimes(1);
  });
});

// ── Fase E — per-tenant policyLoader wiring on the promote route ─────────────

describe('POST /api/pending-incidents/promote — Fase E policyLoader argument', () => {
  it('forwards a 2nd argument (Date + policyLoader) to promotePendingIncidents', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeOwner);
    mocks.promotePendingIncidents.mockResolvedValueOnce({ promoted: 0, skipped: 0 });
    await callRoute();
    expect(mocks.promotePendingIncidents).toHaveBeenCalledTimes(1);
    const args = mocks.promotePendingIncidents.mock.calls[0];
    expect(args).toHaveLength(2);
    expect(args?.[0]).toBeInstanceOf(Date);
    expect(typeof args?.[1]).toBe('function');
  });

  it('policyLoader is async and takes an array of tenantIds', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeOwner);
    mocks.promotePendingIncidents.mockResolvedValueOnce({ promoted: 0, skipped: 0 });
    await callRoute();
    const policyLoader = mocks.promotePendingIncidents.mock.calls[0]?.[1] as (
      tenantIds: ReadonlyArray<string>,
    ) => Promise<Map<string, unknown>>;
    expect(typeof policyLoader).toBe('function');
    const result = await policyLoader(['t1', 't2']);
    expect(result).toBeInstanceOf(Map);
  });
});