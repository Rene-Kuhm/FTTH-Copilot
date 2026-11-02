import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/ops/runbooks/route';

/**
 * Contract of `GET /api/ops/runbooks`.
 *
 * The route builds its Prisma filters by hand. These tests pin the filters it
 * sends, because they are what the database actually receives: a filter with a
 * field the model does not have, or an enum value outside the enum, is a 500
 * at runtime and not a compile error.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  runbookFindMany: vi.fn(),
  confirmedIncidentFindMany: vi.fn(),
  runbookUpdateMany: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ftth-copilot/db')>();
  return {
    ...actual,
    prisma: {
      runbook: {
        findMany: (...args: unknown[]) => mocks.runbookFindMany(...args),
        updateMany: (...args: unknown[]) => mocks.runbookUpdateMany(...args),
      },
      confirmedIncident: {
        findMany: (...args: unknown[]) => mocks.confirmedIncidentFindMany(...args),
      },
    },
  };
});

/** A request with the given query string. */
function request(query: string): Request {
  return new Request(`http://localhost/api/ops/runbooks${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ id: 'u1', tenantId: 'tenant-a', role: 'ADMIN' });
  mocks.hasPermission.mockReturnValue(true);
  mocks.runbookFindMany.mockResolvedValue([]);
  mocks.confirmedIncidentFindMany.mockResolvedValue([]);
  mocks.runbookUpdateMany.mockResolvedValue({ count: 0 });
});

describe('GET /api/ops/runbooks', () => {
  it('filters the runbooks by tenant only when there is no context', async () => {
    await GET(request('') as never);

    const call = mocks.runbookFindMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; OR?: unknown[] };
    };
    expect(call.where.tenantId).toBe('tenant-a');
    expect(call.where.OR).toBeUndefined();
  });

  it('builds the OR conditions in priority order', async () => {
    await GET(
      request('?deviceKind=OLT&deviceId=OLT-01&alertKind=onu_failure&severity=critical') as never,
    );

    const call = mocks.runbookFindMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; OR: Array<Record<string, unknown>> };
    };
    expect(call.where.OR).toHaveLength(5);
    expect(call.where.OR[0]).toEqual({
      deviceKind: 'OLT',
      deviceId: 'OLT-01',
      alertKind: 'onu_failure',
      severity: 'critical',
    });
    expect(call.where.OR[1]).toEqual({
      deviceKind: 'OLT',
      deviceId: null,
      alertKind: 'onu_failure',
      severity: 'critical',
    });
  });

  it('scopes the confirmed incidents by tenant and device kind', async () => {
    await GET(request('?deviceKind=OLT') as never);

    const call = mocks.confirmedIncidentFindMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; deviceKind?: string };
    };
    expect(call.where).toEqual({ tenantId: 'tenant-a', deviceKind: 'OLT' });
  });

  it('omits the device kind for a kind that no confirmed incident can have', async () => {
    // `ConfirmedIncident.deviceKind` is the enum OLT|ONU, but the query
    // string accepts every topology kind. Sending CTO used to throw in
    // Prisma and the route answered 500.
    await GET(request('?deviceKind=CTO') as never);

    const call = mocks.confirmedIncidentFindMany.mock.calls[0]?.[0] as {
      where: { tenantId: string; deviceKind?: string };
    };
    expect(call.where).toEqual({ tenantId: 'tenant-a' });
    expect(call.where.deviceKind).toBeUndefined();
  });

  it('keeps the runbook filter for a kind that no confirmed incident can have', async () => {
    // The runbook model stores the kind as text, so CTO is a legitimate
    // runbook filter even if it is not a confirmed-incident kind.
    await GET(request('?deviceKind=CTO') as never);

    const call = mocks.runbookFindMany.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(call.where.OR[0]).toMatchObject({ deviceKind: 'CTO' });
  });

  it('ignores a device kind that is not a topology kind at all', async () => {
    await GET(request('?deviceKind=NOT_A_KIND') as never);

    const runbookCall = mocks.runbookFindMany.mock.calls[0]?.[0] as { where: { OR?: unknown[] } };
    expect(runbookCall.where.OR).toBeUndefined();
  });

  it('answers 401 without a user', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await GET(request('') as never);

    expect(response.status).toBe(401);
  });

  it('answers 403 without permission', async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await GET(request('') as never);

    expect(response.status).toBe(403);
  });
});
