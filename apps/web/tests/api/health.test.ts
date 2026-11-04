import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSchedulerHealth,
  markExpected,
  markNotExpected,
  recordError,
  recordSuccess,
  recordSyslogBound,
  snapshotHealth,
} from '@/lib/monitoring/scheduler-health';
import { GET } from '@/app/api/health/route';

const mockQueryRaw = vi.fn();
vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

const { mockReadWorkerHealth } = vi.hoisted(() => ({ mockReadWorkerHealth: vi.fn() }));
vi.mock('@/lib/monitoring/worker-health', () => ({
  readWorkerHealth: mockReadWorkerHealth,
}));

/**
 * Tests for `apps/web/app/api/health/route.ts`.
 *
 * Contract:
 *   - 200 with `status: 'ok'` when no scheduler service is unhealthy.
 *   - 200 with `status: 'ok'` when no service is expected at all.
 *   - 503 with `status: 'degraded'` when an expected service has a
 *     recent error.
 *   - 503 when an expected service has never run.
 *   - 503 when syslog is expected but never bound.
 *   - 200 once the error window has elapsed (recovery).
 *   - Response shape includes `uptime`, `memory`, `version`,
 *     `services` keyed by service name, and `timestamp`.
 *
 * The health route does not consult auth (`getCurrentUser`) so the
 * tests do not need to mock it.
 */

beforeEach(() => {
  __resetSchedulerHealth();
  mockQueryRaw.mockReset();
  mockQueryRaw.mockResolvedValue([{ 1: 1 }]);
  mockReadWorkerHealth.mockReset();
  // The worker is the only owner of the background work, so the state the
  // endpoint reports is the state it publishes in Redis. The registry the
  // tests fill here stands for that published snapshot.
  mockReadWorkerHealth.mockImplementation(async () => ({
    services: snapshotHealth(),
    counters: {},
    publishedAt: Date.now(),
  }));
});

afterEach(() => {
  __resetSchedulerHealth();
});

describe('GET /api/health', () => {
  it('returns 200 ok when nothing is expected', async () => {
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.services).toEqual({});
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptime).toBe('number');
  });

  it('returns 200 ok when an expected service has run cleanly', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now());
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.services['polling']?.expected).toBe(true);
    expect(body.services['polling']?.lastError).toBeNull();
  });

  it('returns 503 degraded when an expected service has a recent error', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now() - 60_000);
    recordError('polling', 'NMS down', Date.now() - 1_000);
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.services['polling']?.lastError).toBe('NMS down');
  });

  it('returns 503 when an expected service has never run', async () => {
    markExpected('polling');
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('returns 503 when syslog is expected but never bound', async () => {
    markExpected('syslog');
    recordSyslogBound(false);
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
  });

  it('returns 200 once the error window has elapsed', async () => {
    markExpected('polling');
    recordError('polling', 'transient failure', Date.now() - 10 * 60 * 1000);
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('returns 200 when a non-expected service has errors (operator did not opt in)', async () => {
    markNotExpected('firmware');
    recordError('firmware', 'should be ignored', Date.now() - 1_000);
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('returns the response shape expected by the dashboard', async () => {
    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body).toMatchObject({
      status: expect.stringMatching(/^(ok|degraded)$/),
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      memory: {
        rss: expect.any(Number),
        heapUsed: expect.any(Number),
      },
      version: expect.any(String),
      services: expect.any(Object),
    });
  });
});

/**
 * El estado de cada loop, en palabras.
 *
 * El registro de salud se vacía en cada arranque, así que un worker recién
 * levantado tiene loops sin ningún tick. El health tiene que decir que
 * están calentando y cuándo esperan su próximo tick, no que están muertos.
 */
describe('GET /api/health — el estado de cada loop', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  afterEach(() => {
    __resetSchedulerHealth();
  });

  it('dice que un loop que espera su primer tick está calentando', async () => {
    markExpected('polling', { intervalMs: 900_000, nextRunAt: Date.now() + 60_000 });

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();

    expect(body.services['polling']?.status).toBe('warming');
  });

  it('publica cuándo espera el próximo tick y con qué cadencia', async () => {
    const nextRunAt = Date.now() + 900_000;
    markExpected('polling', { intervalMs: 900_000, nextRunAt });

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();

    expect(body.services['polling']?.nextRunAt).toBe(nextRunAt);
    expect(body.services['polling']?.intervalMs).toBe(900_000);
  });

  it('no degrada el sistema por un loop que todavía no tickeó', async () => {
    markExpected('firmware', { intervalMs: 86_400_000, nextRunAt: Date.now() + 3_600_000 });

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.services['firmware']?.status).toBe('warming');
  });

  it('dice en error el loop cuyo poll falló, con el motivo', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now() - 60_000);
    recordError('polling', 'la conexión conn-1 no se pudo construir', Date.now() - 1_000);

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();

    expect(body.services['polling']?.status).toBe('error');
    expect(body.services['polling']?.lastError).toBe('la conexión conn-1 no se pudo construir');
  });
});

import { __resetConnectionHealth, recordConnectionError, recordConnectionSuccess } from '@/lib/monitoring/connection-health';

describe('GET /api/health — Fase 2 fields (2.6)', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
    __resetConnectionHealth();
  });
  afterEach(() => {
    __resetSchedulerHealth();
    __resetConnectionHealth();
  });

  it('reports hungLoops for services that never ran (ausencia de primera ejecución)', async () => {
    markExpected('polling');
    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.hungLoops).toContain('polling');
  });

  it('reports hungLoops for services whose last tick is too old (ciclo colgado)', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now() - 20 * 60 * 1000);
    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.hungLoops).toContain('polling');
  });

  it('reports connections[] with per-connection state', async () => {
    const now = Date.now();
    recordConnectionSuccess('c-1', now - 1000);
    recordConnectionError('c-2', 'NMS timeout', now - 1000);
    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.connections).toBeInstanceOf(Array);
    const states = Object.fromEntries(body.connections.map((c: { connectionId: string; state: string }) => [c.connectionId, c.state]));
    expect(states['c-1']).toBe('healthy');
    expect(states['c-2']).toBe('error');
  });

  it('returns hungLoops: [] when every expected service is healthy', async () => {
    markExpected('polling');
    recordSuccess('polling', Date.now());
    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.hungLoops).toEqual([]);
  });
});

describe('GET /api/health — database connectivity', () => {  it('returns 503 degraded when database connection fails', async () => {
    mockQueryRaw.mockRejectedValue(new Error('Connection refused'));
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.database.status).toBe('error');
    expect(body.database.error).toBe('Database connection error');
  });

  it('returns 503 degraded when database check times out', async () => {
    mockQueryRaw.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 5000)),
    );
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('degraded');
    expect(body.database.status).toBe('error');
    expect(body.database.error).toBe('Database check timed out');
  }, 10000);

  it('includes database status and latency in response when healthy', async () => {
    mockQueryRaw.mockResolvedValue([{ 1: 1 }]);
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.database).toMatchObject({
      status: 'connected',
      latencyMs: expect.any(Number),
    });
  });
});


/**
 * When the worker owns the background work, the health of the web has to
 * report the state of the loops of the worker.
 *
 * The web cannot read the registry of the worker from its own memory — it
 * does not even share the copy of the registry with the instrumentation that
 * starts the loops, because Next.js bundles each entry point separately. The
 * worker publishes the state in Redis and the web reads it from there.
 */
describe('GET /api/health — the worker owns the background work', () => {
  const originalMode = process.env['BACKEND_MODE'];

  beforeEach(() => {
    __resetSchedulerHealth();
    mockQueryRaw.mockReset();
    mockQueryRaw.mockResolvedValue([{ 1: 1 }]);
    mockReadWorkerHealth.mockReset();
    mockReadWorkerHealth.mockResolvedValue(null);
    process.env['BACKEND_MODE'] = 'worker';
  });

  afterEach(() => {
    __resetSchedulerHealth();
    if (originalMode === undefined) delete process.env['BACKEND_MODE'];
    else process.env['BACKEND_MODE'] = originalMode;
  });

  it('lists the loops of the worker', async () => {
    mockReadWorkerHealth.mockResolvedValue({
      services: {
        polling: {
          expected: true,
          lastRunAt: Date.now(),
          lastError: null,
          lastErrorAt: null,
        },
      },
      counters: {},
      publishedAt: Date.now(),
    });

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.owner).toBe('worker');
    expect(body.services['polling']?.expected).toBe(true);
    expect(res.status).toBe(200);
  });

  it('is degraded when the worker published nothing', async () => {
    mockReadWorkerHealth.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.owner).toBe('worker');
  });

  it('reports the backlog of the worker, not the empty one of the web', async () => {
    mockReadWorkerHealth.mockResolvedValue({
      services: {},
      counters: { backlog: 5, dropped: 0 },
      publishedAt: Date.now(),
    });

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.ingest.backlog).toBe(5);
  });

  it('el worker es el dueño aunque el flag no esté seteado', async () => {
    // El flag ya no elige entre dos caminos: el worker es siempre el dueño
    // del trabajo de fondo. Lo que el health informa es lo que él publica,
    // no el registro local de esta web.
    delete process.env['BACKEND_MODE'];
    markExpected('polling');
    recordSuccess('polling', Date.now());

    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.owner).toBe('worker');
    expect(body.services['polling']).toBeUndefined();
  });

  it('does not read the worker in container scope', async () => {
    mockReadWorkerHealth.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/health?scope=container'));
    const body = await res.json();
    expect(mockReadWorkerHealth).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('answers 200 in container scope even when the worker is not working', async () => {
    mockReadWorkerHealth.mockResolvedValue(null);

    // The health check of the container measures the container: a worker
    // that is down is a degraded system, not a broken web.
    const res = await GET(new Request('http://localhost/api/health?scope=container'));
    expect(res.status).toBe(200);
  });
});
