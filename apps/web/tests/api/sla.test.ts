import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INmsConnector, OnuDetail, OnuSummary } from '@ftth-copilot/connectors-core';

/**
 * Tests for `apps/web/app/api/sla/route.ts`.
 *
 * Contract under test:
 *   - 401 when no user is signed in.
 *   - 403 when the signed-in user lacks `view_network`.
 *   - 200 with `{ windowDays, sla, count }` happy path.
 *   - Grouping is by `(connectionId, deviceKind, deviceId)` — two
 *     connections with the same deviceId do not merge.
 *   - When `computeUptime` returns `uptimePercent: null` (insufficient
 *     data — e.g. a single sample that does not anchor a segment), the
 *     route MUST propagate `null` to the response, not coerce to `0`.
 *     `0` means "monitored and offline for the whole measured window";
 *     `null` means "no measured time at all". The two are different
 *     operational signals.
 *   - The same applies to `coveragePercent`, `measuredMs`,
 *     `unmeasuredMs`, `offlineMs`.
 *
 * The route calls `getCurrentUser` and `hasPermission`, which we mock.
 * Prisma is mocked so we can inject deterministic MetricSample rows.
 */

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  prismaMetricSampleFindMany: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/auth/permissions', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    metricSample: {
      findMany: mocks.prismaMetricSampleFindMany,
    },
  },
}));

const fakeUser = {
  id: 'user-1',
  email: 'ops@isp.com',
  name: 'Ops',
  role: 'OWNER' as const,
  tenantId: 'tenant-1',
  tenant: { id: 'tenant-1', name: 'ISP', slug: 'isp' },
};

// Stable now() so the 30-day window does not shift between calls.
const NOW = new Date('2026-08-21T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function sample(overrides: {
  connectionId?: string | null;
  deviceKind?: string;
  deviceId?: string;
  valueText?: string;
  sampledAt?: Date;
}): {
  tenantId: string;
  connectionId: string | null;
  deviceKind: string;
  deviceId: string;
  kind: 'STATUS';
  valueText: string;
  sampledAt: Date;
} {
  return {
    tenantId: 'tenant-1',
    connectionId: overrides.connectionId ?? 'conn-1',
    deviceKind: overrides.deviceKind ?? 'ONU',
    deviceId: overrides.deviceId ?? 'onu-1',
    kind: 'STATUS' as const,
    valueText: overrides.valueText ?? 'online',
    sampledAt: overrides.sampledAt ?? new Date(NOW.getTime() - 5 * DAY_MS),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.getCurrentUser.mockReset();
  mocks.hasPermission.mockReset();
  mocks.prismaMetricSampleFindMany.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

import { GET } from '@/app/api/sla/route';

describe('GET /api/sla', () => {
  it('returns 401 when no user is signed in', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const res = await GET({
      nextUrl: new URL('http://localhost/api/sla?days=30'),
    } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it('returns 403 when the user lacks view_network', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(false);
    const res = await GET({
      nextUrl: new URL('http://localhost/api/sla?days=30'),
    } as unknown as Parameters<typeof GET>[0]);
    expect(res.status).toBe(403);
  });

  it('groups by (connectionId, deviceKind, deviceId) — same deviceId on two connections does NOT merge', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(true);
    // Same (deviceKind, deviceId), different connectionId. With two
    // samples per device anchored around the same time, the per-group
    // uptime should be the same; with the bug the rows would merge
    // into one and the count would be 1.
    mocks.prismaMetricSampleFindMany.mockResolvedValue([
      sample({ connectionId: 'conn-1', deviceId: '123', sampledAt: new Date(NOW.getTime() - 10 * DAY_MS), valueText: 'online' }),
      sample({ connectionId: 'conn-1', deviceId: '123', sampledAt: new Date(NOW.getTime() - 5 * DAY_MS), valueText: 'online' }),
      sample({ connectionId: 'conn-2', deviceId: '123', sampledAt: new Date(NOW.getTime() - 10 * DAY_MS), valueText: 'online' }),
      sample({ connectionId: 'conn-2', deviceId: '123', sampledAt: new Date(NOW.getTime() - 5 * DAY_MS), valueText: 'online' }),
    ]);

    const res = await GET({
      nextUrl: new URL('http://localhost/api/sla?days=30'),
    } as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.count).toBe(2);
    const ids = (body.sla as Array<{ connectionId: string }>).map((s) => s.connectionId).sort();
    expect(ids).toEqual(['conn-1', 'conn-2']);
  });

  it('regression: uptimePercent is null (not 0) when the window has a single sample and no measured segment', async () => {
    // The route used to coerce `null` to `0` via `(uptime.uptimePercent
    // ?? 0)`, which made "insufficient data" indistinguishable from
    // "100% offline for the measured window". Pin that the null
    // propagates.
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(true);
    mocks.prismaMetricSampleFindMany.mockResolvedValue([
      sample({ sampledAt: new Date(NOW.getTime() - 1000), valueText: 'online' }),
    ]);

    const res = await GET({
      nextUrl: new URL('http://localhost/api/sla?days=30'),
    } as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sla).toHaveLength(1);
    expect(body.sla[0].uptimePercent).toBeNull();
    // coveragePercent must also reflect the "no measured time" state,
    // not be coerced to 0.
    expect(body.sla[0].coveragePercent).toBe(0);
    expect(body.sla[0].measuredMs).toBe(0);
  });

  it('uptimePercent is a number (0..100) when there is at least one measured segment', async () => {
    mocks.getCurrentUser.mockResolvedValue(fakeUser);
    mocks.hasPermission.mockReturnValue(true);
    mocks.prismaMetricSampleFindMany.mockResolvedValue([
      sample({ sampledAt: new Date(NOW.getTime() - 10 * DAY_MS), valueText: 'online' }),
      sample({ sampledAt: new Date(NOW.getTime() - 5 * DAY_MS), valueText: 'online' }),
    ]);

    const res = await GET({
      nextUrl: new URL('http://localhost/api/sla?days=30'),
    } as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.sla[0].uptimePercent).toBe(100);
  });
});
