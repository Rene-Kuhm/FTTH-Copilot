import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Paging contract for GET /api/predictions.
 *
 * The scope was already correct, only open and acknowledged, but there was no
 * limit and no way past the first rows. `status=all` reopens the historical
 * view, where alerts accumulate forever.
 */

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@ftth-copilot/db', () => ({
  prisma: { detectedAlert: { findMany: mocks.findMany } },
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: async () => ({
    id: 'usr-1',
    email: 'op@isp.example',
    role: 'OWNER',
    tenantId: 'ten-1',
  }),
}));

const { GET } = await import('@/app/api/predictions/route');

function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'al-1',
    kind: 'signal_drift',
    severity: 'warning',
    deviceKind: 'ONU',
    deviceId: 'ONU-1',
    title: 'Signal drift',
    description: 'desc',
    etaMs: 3600000,
    confidence: 0.9,
    status: 'open',
    firstSeenAt: new Date('2026-10-01T00:00:00Z'),
    lastSeenAt: new Date('2026-10-02T00:00:00Z'),
    ...overrides,
  };
}

function call(query = '') {
  return GET(new Request(`http://localhost/api/predictions${query}`) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});

describe('default scope', () => {
  it('returns only unresolved predictions by default', async () => {
    await call();

    expect(mocks.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['open', 'acknowledged'],
    });
  });

  it('caps the page', async () => {
    await call();

    expect(mocks.findMany.mock.calls[0][0].take).toBe(51);
  });

  it('orders by lastSeenAt and id so the index backs the query', async () => {
    await call();

    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual([
      { lastSeenAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('keeps the selected columns', async () => {
    await call();

    // Guard against silently widening the payload while paging.
    const select = mocks.findMany.mock.calls[0][0].select;
    expect(Object.keys(select)).toContain('confidence');
    expect(Object.keys(select)).toContain('etaMs');
    expect(Object.keys(select)).not.toContain('modelVersion');
  });
});

describe('explicit scope', () => {
  it('returns resolved only when asked', async () => {
    await call('?status=resolved');

    expect(mocks.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['resolved'],
    });
  });

  it('returns every status only for all', async () => {
    await call('?status=all');

    expect(mocks.findMany.mock.calls[0][0].where.status).toEqual({
      in: ['open', 'acknowledged', 'resolved'],
    });
  });

  it('clamps a hostile limit and falls back on a non numeric one', async () => {
    await call('?limit=100000');
    expect(mocks.findMany.mock.calls[0][0].take).toBe(201);

    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    await call('?limit=abc');
    expect(mocks.findMany.mock.calls[0][0].take).toBe(51);
  });
});

describe('cursor', () => {
  const cursor = Buffer.from(
    JSON.stringify({ l: '2026-10-02T00:00:00.000Z', i: 'al-1' }),
    'utf8',
  ).toString('base64url');

  it('continues strictly after the cursor', async () => {
    await call(`?cursor=${cursor}`);

    expect(mocks.findMany.mock.calls[0][0].where.OR).toEqual([
      { lastSeenAt: { lt: new Date('2026-10-02T00:00:00.000Z') } },
      { lastSeenAt: new Date('2026-10-02T00:00:00.000Z'), id: { lt: 'al-1' } },
    ]);
  });

  it('ignores a corrupt cursor rather than failing', async () => {
    const res = await call('?cursor=nope');

    expect(res.status).toBe(200);
    expect(mocks.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });
});

describe('page metadata and compatibility', () => {
  it('reports hasMore and a cursor on a full page', async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) =>
        alert({ id: `al-${i}`, lastSeenAt: new Date(Date.UTC(2026, 9, 2, 0, 0, 50 - i)) }),
      ),
    );

    const body = await (await call()).json();

    expect(body.predictions).toHaveLength(50);
    expect(body.page.hasMore).toBe(true);
    expect(body.page.nextCursor).toBeTruthy();
  });

  it('reports the last page honestly', async () => {
    mocks.findMany.mockResolvedValue([alert()]);

    const body = await (await call()).json();

    expect(body.page.hasMore).toBe(false);
    expect(body.page.nextCursor).toBeNull();
  });

  it('keeps the legacy shape the panel already reads', async () => {
    mocks.findMany.mockResolvedValue([alert()]);

    const body = await (await call()).json();

    // PredictiveAlerts reads body.predictions and renders its length.
    expect(Array.isArray(body.predictions)).toBe(true);
    expect(body.count).toBe(body.predictions.length);
  });

  it('survives an empty result', async () => {
    const body = await (await call()).json();

    expect(body.predictions).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.page.hasMore).toBe(false);
  });
});

describe('tenant isolation', () => {
  it('scopes every page to the authenticated tenant', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ l: '2026-10-02T00:00:00.000Z', i: 'al-1' }),
      'utf8',
    ).toString('base64url');

    await call(`?status=all&cursor=${cursor}`);

    expect(mocks.findMany.mock.calls[0][0].where.tenantId).toBe('ten-1');
  });
});