import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Paging contract for GET /api/incidents.
 *
 * The endpoint used to return every incident the tenant had ever recorded,
 * resolved ones included, with no limit. That grows without bound and, worse,
 * can push unresolved incidents out of the operator's view. The default is now
 * unresolved only, with resolved history reachable through an explicit filter
 * and a cursor.
 *
 * Cursor rather than offset because acknowledging an incident between two
 * requests shifts an offset page and silently skips a row.
 */

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: { incident: { findMany: mocks.findMany } },
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: async () => ({
    id: 'usr-1',
    email: 'op@isp.example',
    role: 'OWNER',
    tenantId: 'ten-1',
  }),
}));

const { GET } = await import('@/app/api/incidents/route');

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    deviceKind: 'OLT',
    deviceId: 'OLT-1',
    title: 'Link down',
    description: 'desc',
    severity: 'critical',
    status: 'open',
    firstSeenAt: new Date('2026-10-01T00:00:00Z'),
    lastSeenAt: new Date('2026-10-02T00:00:00Z'),
    _count: { alerts: 2 },
    ...overrides,
  };
}

function call(query = '') {
  return GET(new Request(`http://localhost/api/incidents${query}`) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

describe('default scope', () => {
  it('returns only unresolved incidents by default', async () => {
    await call();

    const where = mocks.findMany.mock.calls[0][0].where;
    // Resolved incidents accumulate forever; they must not be in the default.
    expect(where.status).toEqual({ in: ['open', 'acknowledged'] });
  });

  it('caps the page so the response cannot grow without bound', async () => {
    await call();

    // take is limit + 1: the extra row is how hasMore is known without a
    // second COUNT query.
    expect(mocks.findMany.mock.calls[0][0].take).toBe(51);
  });

  it('orders by lastSeenAt and id so the index backs the query', async () => {
    await call();

    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual([
      { lastSeenAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});

describe('explicit scope', () => {
  it('returns only resolved when asked', async () => {
    await call('?status=resolved');

    expect(mocks.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['resolved'],
    });
  });

  it('returns every status only when explicitly asked for all', async () => {
    await call('?status=all');

    expect(mocks.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['open', 'acknowledged', 'resolved'],
    });
  });

  it('clamps a hostile limit', async () => {
    await call('?limit=100000');

    expect(mocks.findMany.mock.calls[0][0].take).toBe(201);
  });

  it('falls back to the default when the limit is not a number', async () => {
    await call('?limit=abc');

    expect(mocks.findMany.mock.calls[0][0].take).toBe(51);
  });
});

describe('cursor', () => {
  it('does not filter when no cursor is supplied', async () => {
    await call();

    expect(mocks.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('continues strictly after the cursor position', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ l: '2026-10-02T00:00:00.000Z', i: 'inc-1' }),
      'utf8',
    ).toString('base64url');

    await call(`?cursor=${cursor}`);

    expect(mocks.findMany.mock.calls[0][0].where.OR).toEqual([
      { lastSeenAt: { lt: new Date('2026-10-02T00:00:00.000Z') } },
      {
        lastSeenAt: new Date('2026-10-02T00:00:00.000Z'),
        id: { lt: 'inc-1' },
      },
    ]);
  });

  it('ignores a corrupt cursor instead of failing the request', async () => {
    const res = await call('?cursor=not-base64-json');

    expect(res.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });
});

describe('page metadata', () => {
  it('reports hasMore and a cursor when a full page came back', async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) =>
        incident({
          id: `inc-${i}`,
          lastSeenAt: new Date(Date.UTC(2026, 9, 2, 0, 0, 50 - i)),
        }),
      ),
    );

    const body = await (await call()).json();

    expect(body.incidents).toHaveLength(50);
    expect(body.page.hasMore).toBe(true);
    expect(body.page.nextCursor).toBeTruthy();
  });

  it('reports no more pages when the last page is short', async () => {
    mocks.findMany.mockResolvedValue([incident()]);

    const body = await (await call()).json();

    expect(body.page.hasMore).toBe(false);
    expect(body.page.nextCursor).toBeNull();
  });

  it('keeps the legacy shape so existing consumers keep working', async () => {
    mocks.findMany.mockResolvedValue([incident()]);

    const body = await (await call()).json();

    // IncidentsPanel reads body.incidents and renders body count semantics.
    expect(Array.isArray(body.incidents)).toBe(true);
    expect(body.count).toBe(body.incidents.length);
    expect(body.incidents[0]).toMatchObject({
      id: 'inc-1',
      alertCount: 2,
    });
  });

  it('survives an empty result', async () => {
    const body = await (await call()).json();

    expect(body.incidents).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.page.hasMore).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('always scopes the query to the authenticated tenant', async () => {
    await call('?status=all');

    expect(mocks.findMany.mock.calls[0][0].where.tenantId).toBe('ten-1');
  });

  it('keeps the tenant scope on every page of a cursor walk', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ l: '2026-10-02T00:00:00.000Z', i: 'inc-1' }),
      'utf8',
    ).toString('base64url');

    await call(`?cursor=${cursor}`);

    expect(mocks.findMany.mock.calls[0][0].where.tenantId).toBe('ten-1');
  });
});