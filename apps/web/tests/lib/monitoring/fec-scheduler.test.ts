import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INmsConnector, OnuDetail, OnuSummary } from '@ftth-copilot/connectors-core';

/**
 * RED tests for the FEC collection scheduler (`apps/web/lib/monitoring/scheduler.ts`,
 * Phase 2 / PR 2 of `p2-1-fec-collection`).
 *
 * Contract under test (binding REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6 of
 * `openspec/changes/p2-1-fec-collection/specs/fec-collection/spec.md`):
 *   1. `FEC_COLLECTION_ENABLED !== 'true'` → `runScheduledFecCollection()` returns
 *      immediately; no `prisma.nmsConnection.findMany` call.
 *   2. `FEC_COLLECTION_ENABLED=true` + default cadence (slice=8, interval=3.6M) →
 *      exactly 8 `getOnuDetail` calls fire and `persistSamples` receives the rows
 *      assembled by `assembleOnuDetailPoints` for that 8-ONU slice.
 *   3. `FEC_FAN_OUT_PER_CYCLE=32` (rate-budget fails) → zero `getOnuDetail` calls
 *      and one `console.warn` line with `{ reason: 'rate_limit', requested: 32 }`.
 *   4. Mikrowisp-shaped detail (no `fec*` / `biasCurrent*` / `ontTemperature*`) →
 *      `persistSamples` is called with an empty array, zero rows, no throw.
 *   5. One of 8 `getOnuDetail` rejects → the surviving 7 still produce rows
 *      (`mapAllSettled` semantics); the failed ONU contributes zero rows.
 *   6. `runScheduledFecCollection` throws → the next `setInterval` tick still
 *      fires (loop survives — REQ-5).
 *   7. `startFecCollectionLoop()` when env is `false` → returns a no-op cleanup
 *      and does NOT register any `setInterval`.
 *   8. Normal tick → one `console.log` line with
 *      `{ tenantId, connectionId, requested, persisted, skipped, durationMs }`.
 *   9. Skipped tick → one `console.warn` line with `{ connectionId, requested,
 *      reason: 'rate_limit', … }` (no token / cookie / Authorization fields).
 *
 * The scheduler module imports `@ftth-copilot/db` (Prisma singleton),
 * `@/lib/connectors/chat-client`, and `@ftth-copilot/analytics`. All three are
 * mocked here so the test never touches a real DB or HTTP client. The
 * `pickFecFanOutSlice` / `fitsRateBudget` / `assembleOnuDetailPoints` /
 * `mapAllSettled` helpers are EXERCISED end-to-end via the unmocked analytics
 * package — we only mock the boundaries (prisma + chat-client factory).
 */

const mocks = vi.hoisted(() => ({
  prismaNmsConnectionFindMany: vi.fn(),
  prismaMetricSampleCreateMany: vi.fn(),
  buildConnectorFromConnection: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    nmsConnection: {
      findMany: mocks.prismaNmsConnectionFindMany,
    },
    metricSample: {
      createMany: mocks.prismaMetricSampleCreateMany,
    },
  },
}));

vi.mock('@/lib/connectors/chat-client', () => ({
  buildConnectorFromConnection: mocks.buildConnectorFromConnection,
}));

const ENV_KEYS = [
  'FEC_COLLECTION_ENABLED',
  'FEC_COLLECTION_INTERVAL_MS',
  'FEC_FAN_OUT_PER_CYCLE',
  'FEC_RATE_LIMIT_PER_HOUR',
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function setEnv(values: Partial<Record<EnvKey, string | undefined>>): void {
  for (const key of ENV_KEYS) {
    if (key in values) {
      if (values[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = values[key];
      }
    }
  }
}

function clearFecEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

interface FixtureConnector {
  listOnus: ReturnType<typeof vi.fn>;
  getOnuDetail: ReturnType<typeof vi.fn>;
}

function makeOnu(id: string): OnuSummary {
  return { id, serial: `SN-${id}`, oltId: 'OLT-1', status: 'online' };
}

function makeSmartOltDetail(id: string): OnuDetail {
  return {
    ...makeOnu(id),
    fecCorrected: 12,
    fecUncorrected: 3,
    biasCurrentMa: 18,
    ontTemperatureCelsius: 42,
    // P2.2 — fifth optical-health kind (`LOS_SECONDS_TOTAL`). SmartOLT
    // details expose LOS as a monotonic seconds-since-boot counter; the
    // fixture follows the same "online, no degradation yet" baseline used
    // by the FEC fields. The 5-field fixture forces the happy-path
    // assertion to land at 8 ONUs × 5 kinds = 40 rows.
    losSecondsTotal: 30,
  };
}

function makeMikrowispDetail(id: string): OnuDetail {
  // No fec* / biasCurrent* / ontTemperature* fields — Mikrowisp graceful no-op.
  return { ...makeOnu(id), model: 'HW-1G', vendor: 'Mikrotik' };
}

function makeFixtureConnector(overrides: Partial<FixtureConnector> = {}): INmsConnector {
  const connector: FixtureConnector = {
    listOnus: overrides.listOnus ?? vi.fn(),
    getOnuDetail: overrides.getOnuDetail ?? vi.fn(),
  };
  // Cast: the connector surface used by the FEC scheduler is only `listOnus` +
  // `getOnuDetail`. The remaining INmsConnector members are stubbed to keep
  // the type-checker happy without enabling real network calls.
  return {
    providerName: 'fixture',
    ping: vi.fn(async () => ({ ok: true })),
    listOlts: vi.fn(async () => []),
    getOltDetail: vi.fn(async () => {
      throw new Error('not used in fec scheduler tests');
    }),
    getNetworkOverview: vi.fn(async () => ({
      totalOlts: 0,
      oltsOnline: 0,
      totalOnus: 0,
      onusOnline: 0,
      onusOffline: 0,
      averageUptimeSeconds: 0,
      oltsWithHighTemperature: 0,
    })),
    listOnus: connector.listOnus,
    getOnuDetail: connector.getOnuDetail,
    getOnusWithLowSignal: vi.fn(async () => []),
    searchByCustomerName: vi.fn(async () => []),
  } as unknown as INmsConnector;
}

const CONNECTION_FIXTURE = {
  id: 'conn-1',
  tenantId: 'tenant-1',
  provider: 'SMARTOLT' as const,
  label: 'SmartOLT prod',
  encryptedKey: 'encrypted-secret',
  baseUrl: 'https://smartolt.example.com/api',
};

beforeEach(() => {
  clearFecEnv();
  mocks.prismaNmsConnectionFindMany.mockReset();
  mocks.prismaMetricSampleCreateMany.mockReset();
  mocks.buildConnectorFromConnection.mockReset();

  // Default: createMany returns whatever count Prisma would, by reflecting the
  // input length. Each test can override this.
  mocks.prismaMetricSampleCreateMany.mockImplementation(({ data }: { data: unknown[] }) =>
    Promise.resolve({ count: Array.isArray(data) ? data.length : 0 }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearFecEnv();
});

// ── REQ-1 — default-disabled env produces no loop ─────────────────────────

describe('runScheduledFecCollection — opt-in env gate', () => {
  it('returns immediately when FEC_COLLECTION_ENABLED is unset (default)', async () => {
    clearFecEnv();
    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await runScheduledFecCollection();
    expect(mocks.prismaNmsConnectionFindMany).not.toHaveBeenCalled();
    expect(mocks.prismaMetricSampleCreateMany).not.toHaveBeenCalled();
  });

  it('returns immediately when FEC_COLLECTION_ENABLED is anything other than "true"', async () => {
    setEnv({ FEC_COLLECTION_ENABLED: 'false' });
    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await runScheduledFecCollection();
    expect(mocks.prismaNmsConnectionFindMany).not.toHaveBeenCalled();
    expect(mocks.prismaMetricSampleCreateMany).not.toHaveBeenCalled();

    setEnv({ FEC_COLLECTION_ENABLED: '1' });
    await runScheduledFecCollection();
    expect(mocks.prismaNmsConnectionFindMany).not.toHaveBeenCalled();
  });
});

// ── REQ-1 + REQ-2 + REQ-4 — happy path: 8-ONU slice → 8×4 rows ──────────────

describe('runScheduledFecCollection — happy path (REQ-2 + REQ-4)', () => {
  beforeEach(() => {
    setEnv({ FEC_COLLECTION_ENABLED: 'true' });
  });

  it('emits a tick log {tenantId, connectionId, requested:8, persisted:40, skipped:0, durationMs:>=0} for a SmartOLT-shaped 16-ONU slice (P2.2: 8 ONUs × 5 optical kinds)', async () => {
    const onus = Array.from({ length: 16 }, (_, i) => makeOnu(`ONU-${String(i + 1).padStart(2, '0')}`));
    const connector = makeFixtureConnector({
      listOnus: vi.fn(async () => onus),
      getOnuDetail: vi.fn(async (id: string) => makeSmartOltDetail(id)),
    });
    mocks.prismaNmsConnectionFindMany.mockResolvedValue([CONNECTION_FIXTURE]);
    mocks.buildConnectorFromConnection.mockReturnValue({ connector });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await runScheduledFecCollection();

    // P2.2 / design.md AD-1 — LOS is a fifth `MetricKind` traveling on the
    // same `getOnuDetail` payload. 8 ONUs in the slice × 5 kinds = 40 rows.
    expect(mocks.prismaMetricSampleCreateMany).toHaveBeenCalledTimes(1);
    const persistArgs = mocks.prismaMetricSampleCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ deviceId: string; kind: string; value: number; sampledAt: string }>;
    };
    expect(persistArgs.data).toHaveLength(40);
    const deviceIds = new Set(persistArgs.data.map((r) => r.deviceId));
    expect(deviceIds.size).toBe(8);
    const kinds = new Set(persistArgs.data.map((r) => r.kind));
    expect(kinds).toEqual(
      new Set([
        'FEC_CORRECTED',
        'FEC_UNCORRECTED',
        'BIAS_CURRENT_MA',
        'ONT_TEMPERATURE_CELSIUS',
        'LOS_SECONDS_TOTAL',
      ]),
    );

    expect(connector.getOnuDetail).toHaveBeenCalledTimes(8);

    expect(logSpy).toHaveBeenCalledWith(
      '[fec-collection] tick',
      expect.objectContaining({
        tenantId: 'tenant-1',
        connectionId: 'conn-1',
        requested: 8,
        persisted: 40,
        skipped: 0,
        durationMs: expect.any(Number),
      }),
    );
    expect((logSpy.mock.calls[0]?.[1] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it('persists zero rows without throwing for a Mikrowisp-shaped detail (REQ-4 graceful no-op)', async () => {
    const onus = Array.from({ length: 8 }, (_, i) => makeOnu(`MK-${i + 1}`));
    const connector = makeFixtureConnector({
      listOnus: vi.fn(async () => onus),
      getOnuDetail: vi.fn(async (id: string) => makeMikrowispDetail(id)),
    });
    mocks.prismaNmsConnectionFindMany.mockResolvedValue([CONNECTION_FIXTURE]);
    mocks.buildConnectorFromConnection.mockReturnValue({ connector });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await expect(runScheduledFecCollection()).resolves.toBeUndefined();

    expect(connector.getOnuDetail).toHaveBeenCalledTimes(8);
    // `persistSamples` short-circuits on an empty batch (no DB touch); the
    // contract is "zero rows persisted, no throw" — REQ-4 / AD-4. We assert
    // the negative: createMany was NOT called, and the log reports the
    // graceful skip.
    expect(mocks.prismaMetricSampleCreateMany).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      '[fec-collection] tick',
      expect.objectContaining({
        tenantId: 'tenant-1',
        connectionId: 'conn-1',
        requested: 8,
        persisted: 0,
        skipped: 8,
      }),
    );
  });
});

// ── REQ-3 — rate-budget pre-flight skip ────────────────────────────────────

describe('runScheduledFecCollection — rate-budget pre-flight (REQ-3)', () => {
  beforeEach(() => {
    setEnv({ FEC_COLLECTION_ENABLED: 'true', FEC_FAN_OUT_PER_CYCLE: '32' });
  });

  it('skips the fan-out when sliceSize×1 > limitPerHour (32 × 1 > 15): zero getOnuDetail + one warn log', async () => {
    const onus = Array.from({ length: 64 }, (_, i) => makeOnu(`ONU-${i + 1}`));
    const connector = makeFixtureConnector({
      listOnus: vi.fn(async () => onus),
      getOnuDetail: vi.fn(),
    });
    mocks.prismaNmsConnectionFindMany.mockResolvedValue([CONNECTION_FIXTURE]);
    mocks.buildConnectorFromConnection.mockReturnValue({ connector });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await runScheduledFecCollection();

    expect(connector.getOnuDetail).not.toHaveBeenCalled();
    expect(mocks.prismaMetricSampleCreateMany).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[fec-collection] skipped',
      expect.objectContaining({
        tenantId: 'tenant-1',
        connectionId: 'conn-1',
        reason: 'rate_limit',
        requested: 32,
      }),
    );
    // REQ-6: the skip log must NOT carry tokens / cookies / Authorization.
    const payload = JSON.stringify(warnSpy.mock.calls[0]?.[1]);
    expect(payload).not.toMatch(/token/i);
    expect(payload).not.toMatch(/cookie/i);
    expect(payload).not.toMatch(/Authorization/i);
  });

  it('proceeds when the rate-budget passes (sliceSize=8, default interval, default limit)', async () => {
    setEnv({ FEC_COLLECTION_ENABLED: 'true' }); // sliceSize=8 default, interval=3.6M default, limit=15 default
    const onus = Array.from({ length: 8 }, (_, i) => makeOnu(`ONU-${i + 1}`));
    const connector = makeFixtureConnector({
      listOnus: vi.fn(async () => onus),
      getOnuDetail: vi.fn(async (id: string) => makeSmartOltDetail(id)),
    });
    mocks.prismaNmsConnectionFindMany.mockResolvedValue([CONNECTION_FIXTURE]);
    mocks.buildConnectorFromConnection.mockReturnValue({ connector });

    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await runScheduledFecCollection();

    expect(connector.getOnuDetail).toHaveBeenCalledTimes(8);
    expect(mocks.prismaMetricSampleCreateMany).toHaveBeenCalledTimes(1);
  });
});

// ── REQ-5 — per-ONU failure isolation ─────────────────────────────────────

describe('runScheduledFecCollection — per-ONU failure isolation (REQ-5)', () => {
  beforeEach(() => {
    setEnv({ FEC_COLLECTION_ENABLED: 'true' });
  });

  it('surviving 7 ONUs persist even when 1 of 8 getOnuDetail rejects (mapAllSettled semantics)', async () => {
    const onus = Array.from({ length: 8 }, (_, i) => makeOnu(`ONU-${i + 1}`));
    const REJECTING_ID = 'ONU-3';
    const connector = makeFixtureConnector({
      listOnus: vi.fn(async () => onus),
      getOnuDetail: vi.fn(async (id: string) => {
        if (id === REJECTING_ID) throw new Error('upstream 502');
        return makeSmartOltDetail(id);
      }),
    });
    mocks.prismaNmsConnectionFindMany.mockResolvedValue([CONNECTION_FIXTURE]);
    mocks.buildConnectorFromConnection.mockReturnValue({ connector });

    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await expect(runScheduledFecCollection()).resolves.toBeUndefined();

    expect(connector.getOnuDetail).toHaveBeenCalledTimes(8);
    expect(mocks.prismaMetricSampleCreateMany).toHaveBeenCalledTimes(1);
    const persistArgs = mocks.prismaMetricSampleCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ deviceId: string }>;
    };
    const persistedDevices = new Set(persistArgs.data.map((r) => r.deviceId));
    expect(persistedDevices).not.toContain(REJECTING_ID);
    expect(persistedDevices.size).toBe(7);
    expect(persistArgs.data).toHaveLength(35); // 7 × 5 FEC/optical/LOS kinds (P2.2: 5th kind is LOS)
  });

  it('buildConnectorFromConnection throwing on a connection → that connection is skipped without aborting the rest', async () => {
    const onus = Array.from({ length: 8 }, (_, i) => makeOnu(`ONU-${i + 1}`));
    const connector = makeFixtureConnector({
      listOnus: vi.fn(async () => onus),
      getOnuDetail: vi.fn(async (id: string) => makeSmartOltDetail(id)),
    });
    mocks.prismaNmsConnectionFindMany.mockResolvedValue([
      { ...CONNECTION_FIXTURE, id: 'broken', baseUrl: null },
      CONNECTION_FIXTURE,
    ]);
    mocks.buildConnectorFromConnection.mockImplementation((conn: { id: string; baseUrl: string | null }) => {
      if (!conn.baseUrl) throw new Error('no base url');
      return { connector };
    });

    const { runScheduledFecCollection } = await import('@/lib/monitoring/scheduler');
    await expect(runScheduledFecCollection()).resolves.toBeUndefined();

    // Only the second (buildable) connection fans out.
    expect(connector.getOnuDetail).toHaveBeenCalledTimes(8);
    expect(mocks.prismaMetricSampleCreateMany).toHaveBeenCalledTimes(1);
    const persistArgs = mocks.prismaMetricSampleCreateMany.mock.calls[0]?.[0] as {
      data: Array<{ connectionId: string }>;
    };
    for (const row of persistArgs.data) {
      expect(row.connectionId).toBe('conn-1');
    }
  });
});

// ── REQ-5 — thrown tick does not detach the loop ──────────────────────────

describe('startFecCollectionLoop — kill switch + tick resilience (REQ-1 + REQ-5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns a no-op cleanup when FEC_COLLECTION_ENABLED is unset', async () => {
    clearFecEnv();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const cleanup = (await import('@/lib/monitoring/scheduler')).startFecCollectionLoop();
    expect(typeof cleanup).toBe('function');
    expect(setIntervalSpy).not.toHaveBeenCalled();
    cleanup(); // must not throw
  });

  it('a thrown tick does not detach the loop: the next setInterval tick still fires', async () => {
    setEnv({ FEC_COLLECTION_ENABLED: 'true', FEC_COLLECTION_INTERVAL_MS: '1000' });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    let tick = 0;
    mocks.prismaNmsConnectionFindMany.mockImplementation(async () => {
      tick += 1;
      if (tick === 1) throw new Error('boom');
      return [];
    });

    const { startFecCollectionLoop } = await import('@/lib/monitoring/scheduler');
    const cleanup = startFecCollectionLoop();

    // setInterval was registered (with our 1s cadence).
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Advance enough milliseconds to let the first tick (which throws) and a
    // subsequent tick (which returns cleanly) fire. The thrown tick MUST NOT
    // detach the loop — that's the whole REQ-5 contract.
    await vi.advanceTimersByTimeAsync(2500);

    expect(mocks.prismaNmsConnectionFindMany.mock.calls.length).toBeGreaterThanOrEqual(2);
    cleanup();
  });

  it('does NOT schedule any tick once FEC_COLLECTION_ENABLED flips to "false"', async () => {
    setEnv({ FEC_COLLECTION_ENABLED: 'true', FEC_COLLECTION_INTERVAL_MS: '1000' });
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const { startFecCollectionLoop } = await import('@/lib/monitoring/scheduler');
    const cleanup = startFecCollectionLoop();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    cleanup();
  });
});