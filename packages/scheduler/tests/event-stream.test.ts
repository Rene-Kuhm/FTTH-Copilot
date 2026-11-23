/**
 * El loop de eventos de SmartOLT en el worker (S3 + S5).
 *
 * El stream entrega filas de estado y de señal, y esas filas se guardan por el
 * mismo camino que usa el poll programado: `persistSamples` de
 * `@ftth-copilot/analytics`, con el `tenantId` de la conexión en cada punto.
 * Además, las ONUs que el evento marca degradadas se anotan en el registro que
 * prioriza el barrido FEC.
 *
 * Estas pruebas fijan: el gate apagado por default, un loop por conexión
 * SmartOLT, la persistencia tenant-aware, la marca de salud (y su deadline),
 * los finales tipados (`disabled`, `fallback_polling`), el aislamiento de una
 * conexión rota, el tope de streams por cuenta, la liveness POR conexión (un
 * socket medio abierto se corta y se reconecta) y que un loop sin conexiones
 * vivas no figure colgado.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { __setLogSinkForTests } from '@ftth-copilot/shared';
import {
  TICK_GRACE_MS,
  __resetSchedulerHealth,
  detectHangedLoops,
  overallHealthy,
  serviceStatus,
  snapshotHealth,
} from '../src/health';
import {
  __resetDegradedOnusForTests,
  snapshotDegradedOnus,
} from '../src/degraded-onus';
import { onuEventPoints } from '../src/event-points';
import {
  DEFAULT_EVENT_LIVENESS_MS,
  SMARTOLT_EVENTS_FLAG,
  startSmartoltEventStreams,
  type SmartoltEventConnectionRecord,
  type SmartoltEventStreamFactory,
  type SmartoltEventStreamLike,
} from '../src/event-stream';
import type { MetricPoint } from '@ftth-copilot/analytics';
import type { SmartoltEventBatch } from '@ftth-copilot/connectors-smartolt';

const mocks = vi.hoisted(() => ({
  prismaFindMany: vi.fn(),
  decryptApiKey: vi.fn(),
}));

vi.mock('@ftth-copilot/db', () => ({
  prisma: { nmsConnection: { findMany: mocks.prismaFindMany } },
  decryptApiKey: mocks.decryptApiKey,
}));

vi.mock('@ftth-copilot/analytics', () => ({
  persistSamples: vi.fn(async () => ({ inserted: 0 })),
}));

const CONNECTION = {
  id: 'conn-1',
  tenantId: 'tenant-1',
  provider: 'SMARTOLT',
  baseUrl: 'https://smartolt.example.com',
  encryptedKey: 'encrypted-1',
};

const STATUS_BATCH: SmartoltEventBatch = {
  type: 'onu.status_changed',
  timestamp: '2026-10-08T10:00:01Z',
  family: 'onus',
  rows: [
    {
      unique_external_id: 'ext-1001',
      sn: 'HWTC00000015',
      olt_id: '1',
      status: 'LOS',
      last_status_change: '2026-10-08 10:00:00',
    },
  ],
};

const READING_BATCH: SmartoltEventBatch = {
  type: 'onu.rx1490_reading',
  timestamp: '2026-10-08T10:00:01Z',
  family: 'onus',
  rows: [
    {
      unique_external_id: 'ext-1002',
      sn: 'HWTC7D4A91C2',
      olt_id: '1',
      rx1490: -31.5,
      reading_at: '2026-10-08 10:00:00',
    },
  ],
};

interface Harness {
  listConnections: Mock<() => Promise<SmartoltEventConnectionRecord[]>>;
  decrypt: Mock<(encryptedKey: string) => string>;
  persist: Mock<(points: MetricPoint[]) => Promise<{ inserted: number }>>;
  createStream: Mock<SmartoltEventStreamFactory>;
  opened: Array<{ connectionId: string; baseUrl: string; apiKey: string }>;
  signals: AbortSignal[];
}

/** Un `createStream` que entrega el guion de cada conexión, en orden. */
function harness(script: Record<string, unknown[]> = {}): Harness {
  const opened: Harness['opened'] = [];
  const signals: AbortSignal[] = [];
  const createStream = vi.fn((connection: { connectionId: string; baseUrl: string; apiKey: string }) => {
    opened.push(connection);
    const outcomes = script[connection.connectionId] ?? [];
    const stream: SmartoltEventStreamLike = {
      // eslint-disable-next-line @typescript-eslint/require-await
      events: async function* generator({ signal }: { signal?: AbortSignal } = {}) {
        if (signal) signals.push(signal);
        for (const entry of outcomes) {
          if (signal?.aborted === true) return;
          yield entry as never;
        }
      },
    };
    return stream;
  });

  return {
    listConnections: vi.fn(async () => [CONNECTION]),
    decrypt: vi.fn(() => 'sk-secret-1234'),
    persist: vi.fn(async (points: MetricPoint[]) => ({ inserted: points.length })),
    createStream,
    opened,
    signals,
  };
}

function event(batch: SmartoltEventBatch, id = '1'): unknown {
  return { kind: 'event', id, batch };
}

function outcome(
  kind: 'ping' | 'resync' | 'expired' | 'disabled' | 'error' | 'invalid' | 'fallback_polling',
): Record<string, unknown> {
  switch (kind) {
    case 'ping':
      return { kind: 'ping' };
    case 'error':
      return { kind: 'error', message: 'boom' };
    case 'invalid':
      return { kind: 'invalid', id: '9', message: 'cuerpo raro' };
    case 'fallback_polling':
      return { kind: 'fallback_polling', status: 503, message: 'no disponible' };
    default:
      return { kind, id: '7' };
  }
}

beforeEach(() => {
  __resetSchedulerHealth();
  __resetDegradedOnusForTests();
  mocks.prismaFindMany.mockReset();
  mocks.prismaFindMany.mockResolvedValue([CONNECTION]);
  mocks.decryptApiKey.mockReset();
  mocks.decryptApiKey.mockReturnValue('sk-secret-1234');
});

describe('el gate del loop de eventos', () => {
  it('está apagado por default: no lista conexiones y no se registra en la salud', async () => {
    const harnessed = harness();

    const handle = startSmartoltEventStreams({
      env: {},
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;

    expect(handle.enabled).toBe(false);
    expect(handle.connections).toBe(0);
    expect(harnessed.listConnections).not.toHaveBeenCalled();
    expect(snapshotHealth()['smartolt-events']).toBeUndefined();
    await handle.stop();
  });

  it('con la bandera en "true" arranca un loop por conexión SmartOLT y publica su deadline', async () => {
    const harnessed = harness();

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
      now: () => 1_000_000,
    });
    await handle.ready;
    await handle.settled();

    expect(handle.enabled).toBe(true);
    expect(handle.connections).toBe(1);
    expect(harnessed.opened).toHaveLength(1);
    expect(harnessed.opened[0]).toMatchObject({
      connectionId: 'conn-1',
      baseUrl: 'https://smartolt.example.com',
      apiKey: 'sk-secret-1234',
    });

    const health = snapshotHealth()['smartolt-events'];
    expect(health?.expected).toBe(true);
    expect(health?.intervalMs).toBe(DEFAULT_EVENT_LIVENESS_MS);
    expect(health?.nextRunAt).toBe(1_000_000 + DEFAULT_EVENT_LIVENESS_MS);

    await handle.stop();
  });

  it('sólo consulta las conexiones SmartOLT conectadas', async () => {
    const harnessed = harness();

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;
    await handle.settled();

    expect(mocks.prismaFindMany).toHaveBeenCalledTimes(1);
    const args = mocks.prismaFindMany.mock.calls[0]?.[0] as { where: Record<string, string> };
    expect(args.where).toEqual({ status: 'connected', provider: 'SMARTOLT' });

    await handle.stop();
  });
});

describe('lo que un evento persiste', () => {
  it('guarda el estado de la ONU por el mismo camino del poll, con el tenantId', async () => {
    const harnessed = harness({ 'conn-1': [event(STATUS_BATCH), outcome('ping')] });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
      now: () => 1_000_000,
    });
    await handle.ready;
    await handle.settled();

    expect(harnessed.persist).toHaveBeenCalledTimes(1);
    const points = harnessed.persist.mock.calls[0]?.[0] as MetricPoint[];
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      deviceKind: 'ONU',
      deviceId: 'ext-1001',
      kind: 'STATUS',
      valueText: 'degraded',
      sampledAt: new Date(1_000_000).toISOString(),
    });

    // La ONU quedó marcada para el barrido FEC.
    const degraded = snapshotDegradedOnus({ tenantId: 'tenant-1', connectionId: 'conn-1' }, 1_000_000);
    expect(degraded.map((s) => s.onuId)).toEqual(['ext-1001']);

    // El ping mantiene vivo el deadline y no persiste nada.
    expect(snapshotHealth()['smartolt-events']?.lastRunAt).toBe(1_000_000);

    await handle.stop();
  });

  it('un lote de señal guarda la potencia y prioriza la ONU con peor lectura', async () => {
    const harnessed = harness({ 'conn-1': [event(READING_BATCH)] });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
      now: () => 2_000_000,
    });
    await handle.ready;
    await handle.settled();

    const points = harnessed.persist.mock.calls[0]?.[0] as MetricPoint[];
    expect(points).toEqual([
      expect.objectContaining({ deviceId: 'ext-1002', kind: 'RX_POWER_DBM', value: -31.5 }),
    ]);
    const degraded = snapshotDegradedOnus({ tenantId: 'tenant-1', connectionId: 'conn-1' }, 2_000_000);
    expect(degraded[0]).toMatchObject({ onuId: 'ext-1002', rxPowerDbm: -31.5 });

    await handle.stop();
  });

  it('no persiste nada para un evento sin muestras (una caída de PON)', async () => {
    const harnessed = harness({
      'conn-1': [
        event({
          type: 'pon.outage_started',
          family: 'pons',
          rows: [{ olt_id: '11', board: '2', port: '3', los_count: '8' }],
        }),
      ],
    });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;
    await handle.settled();

    expect(harnessed.persist).not.toHaveBeenCalled();

    await handle.stop();
  });
});

describe('los finales del stream', () => {
  it('guarda la salud sin el token de la API en el mensaje', async () => {
    const harnessed = harness({ 'conn-1': [outcome('error')] });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
      now: () => 3_000_000,
    });
    await handle.ready;
    await handle.settled();

    const health = snapshotHealth()['smartolt-events'];
    expect(health?.lastError).toBe('boom');
    expect(JSON.stringify(health)).not.toContain('sk-secret-1234');
    expect(health?.lastRunAt).toBe(3_000_000);

    await handle.stop();
  });

  it('un `disabled` corta el loop y queda como error de salud', async () => {
    const harnessed = harness({ 'conn-1': [outcome('disabled')] });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;
    await handle.settled();

    const health = snapshotHealth()['smartolt-events'];
    expect(health?.lastError).toMatch(/deshabilit/i);

    await handle.stop();
  });

  it('un 503 cae al poll programado: lo deja anotado y no reintenta', async () => {
    const harnessed = harness({ 'conn-1': [outcome('fallback_polling')] });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;
    await handle.settled();

    expect(snapshotHealth()['smartolt-events']?.lastError).toMatch(/no disponible|poll/i);
    expect(harnessed.opened).toHaveLength(1);

    await handle.stop();
  });

  it('una conexión que no se puede descifrar no impide el loop de la otra', async () => {
    const lines: string[] = [];
    __setLogSinkForTests((line) => lines.push(line));
    const harnessed = harness({ 'conn-2': [event(STATUS_BATCH)] });
    harnessed.listConnections.mockResolvedValue([
      CONNECTION,
      { ...CONNECTION, id: 'conn-2', tenantId: 'tenant-2', encryptedKey: 'encrypted-2' },
    ]);
    harnessed.decrypt.mockImplementation((key: string) => {
      if (key === 'encrypted-1') throw new Error('no se pudo descifrar');
      return 'sk-secret-1234';
    });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;
    await handle.settled();

    expect(harnessed.opened.map((c) => c.connectionId)).toEqual(['conn-2']);
    const points = harnessed.persist.mock.calls[0]?.[0] as MetricPoint[];
    expect(points[0]?.tenantId).toBe('tenant-2');
    // La conexión rota queda en el log con su motivo; el loop de la otra sigue.
    expect(lines.some((line) => line.includes('could not decrypt'))).toBe(true);
    expect(lines.join('\n')).not.toContain('sk-secret-1234');

    __setLogSinkForTests(null);
    await handle.stop();
  });

  it('respeta el tope de streams por cuenta (15 del proveedor)', async () => {
    const connections = Array.from({ length: 17 }, (_, i) => ({
      ...CONNECTION,
      id: `conn-${i + 1}`,
    }));
    const harnessed = harness();
    harnessed.listConnections.mockResolvedValue(connections);

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;
    await handle.settled();

    expect(harnessed.opened).toHaveLength(15);
    expect(snapshotHealth()['smartolt-events']?.lastError).toMatch(/stream/i);

    await handle.stop();
  });

  it('stop() corta los loops con el AbortSignal', async () => {
    const harnessed = harness();
    harnessed.createStream.mockImplementation(() => ({
      events: async function* generator({ signal }: { signal?: AbortSignal } = {}) {
        while (signal?.aborted !== true) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        harnessed.signals.push(signal);
        return;
      },
    }));

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
    });
    await handle.ready;
    await handle.stop();

    expect(harnessed.signals[0]?.aborted).toBe(true);
  });
});

describe('onuEventPoints', () => {
  const meta = { tenantId: 'tenant-1', connectionId: 'conn-1' };

  it('traduce los estados del proveedor al estado del dominio', () => {
    const online = onuEventPoints(
      meta,
      { type: 'onu.status_changed', family: 'onus', rows: [{ sn: 'SN-1', status: 'Online' }] },
      { sampledAt: '2026-10-08T10:00:00.000Z', nowMs: 1_000 },
    );
    const powerFail = onuEventPoints(
      meta,
      { type: 'onu.status_changed', family: 'onus', rows: [{ sn: 'SN-2', status: 'Power fail' }] },
      { sampledAt: '2026-10-08T10:00:00.000Z', nowMs: 1_000 },
    );

    expect(online.points[0]).toMatchObject({ deviceId: 'SN-1', valueText: 'online' });
    expect(online.degraded).toEqual([]);
    expect(powerFail.points[0]).toMatchObject({ valueText: 'degraded' });
    expect(powerFail.degraded[0]).toMatchObject({ onuId: 'SN-2', reason: 'status_changed' });
  });

  it('una caída de señal de 2 dB o más marca la ONU como degradada', () => {
    const result = onuEventPoints(
      meta,
      {
        type: 'onu.signal_changed',
        family: 'onus',
        rows: [{ sn: 'SN-1', rx1310: -25.1, prev_rx1310: -22.9, delta: -2.2, reading_at: 'x' }],
      },
      { sampledAt: '2026-10-08T10:00:00.000Z', nowMs: 5_000 },
    );

    expect(result.points).toEqual([
      expect.objectContaining({ deviceId: 'SN-1', kind: 'TX_POWER_DBM', value: -25.1 }),
    ]);
    expect(result.degraded[0]).toMatchObject({ onuId: 'SN-1', atMs: 5_000, reason: 'signal_changed' });
  });

  it('una mejora de señal no marca la ONU como degradada', () => {
    const result = onuEventPoints(
      meta,
      {
        type: 'onu.signal_changed',
        family: 'onus',
        rows: [{ sn: 'SN-1', rx1310: -20.1, prev_rx1310: -25.1, delta: 5 }],
      },
      { sampledAt: '2026-10-08T10:00:00.000Z', nowMs: 5_000 },
    );

    expect(result.points).toHaveLength(1);
    expect(result.degraded).toEqual([]);
  });

  it('la lectura de 1490 por encima del umbral no se marca; por debajo sí', () => {
    const good = onuEventPoints(
      meta,
      {
        type: 'onu.rx1490_reading',
        family: 'onus',
        rows: [{ sn: 'SN-1', rx1490: -18.4, reading_at: 'x' }],
      },
      { sampledAt: '2026-10-08T10:00:00.000Z', nowMs: 5_000, thresholdDbm: -27 },
    );
    const bad = onuEventPoints(
      meta,
      {
        type: 'onu.rx1490_reading',
        family: 'onus',
        rows: [{ sn: 'SN-1', rx1490: -31.5, reading_at: 'x' }],
      },
      { sampledAt: '2026-10-08T10:00:00.000Z', nowMs: 5_000, thresholdDbm: -27 },
    );

    expect(good.degraded).toEqual([]);
    expect(good.points).toEqual([
      expect.objectContaining({ kind: 'RX_POWER_DBM', value: -18.4 }),
    ]);
    expect(bad.degraded[0]).toMatchObject({ onuId: 'SN-1', rxPowerDbm: -31.5 });
  });
});

/**
 * Timers de mentira para el watchdog de liveness.
 *
 * El loop arma un timer por conexión y lo rearma con cada frame: la prueba
 * decide cuándo vence (y con eso que un socket medio abierto se corte) sin
 * esperar los dos minutos del default.
 */
function fakeTimers(): {
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
  delays: number[];
  pending: () => number;
  fireAll: () => void;
} {
  let nextId = 0;
  const queue = new Map<number, () => void>();
  const delays: number[] = [];
  return {
    timers: {
      setTimeout: (fn, ms) => {
        const id = (nextId += 1);
        queue.set(id, fn);
        delays.push(ms);
        return id;
      },
      clearTimeout: (handle) => {
        queue.delete(handle as number);
      },
    },
    delays,
    pending: () => queue.size,
    fireAll: () => {
      const fires = [...queue.values()];
      queue.clear();
      for (const fire of fires) fire();
    },
  };
}

/** Una promesa que la prueba resuelve cuando el guion llega a ese punto. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Espera a que el socket quede abierto hasta que alguien lo corte. */
function holdUntilAborted(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) return Promise.resolve();
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

describe('la liveness por conexión', () => {
  it('corta el stream de una conexión sin frames y reconecta con backoff acotado', async () => {
    const fake = fakeTimers();
    const signals: AbortSignal[] = [];
    const attempts = new Map<string, number>();
    const firstStarted = deferred();
    const secondStarted = deferred();
    const sleep = vi.fn(async () => {});

    const createStream: SmartoltEventStreamFactory = (connection) => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      events: async function* generator({ signal }: { signal?: AbortSignal } = {}) {
        const attempt = (attempts.get(connection.connectionId) ?? 0) + 1;
        attempts.set(connection.connectionId, attempt);
        if (signal !== undefined) signals.push(signal);
        if (attempt === 1) firstStarted.resolve();
        else secondStarted.resolve();
        yield { kind: 'ping' } as never;
        // Socket medio abierto: no llega nada, ni frames ni `: ping`.
        await holdUntilAborted(signal);
      },
    });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true', SMARTOLT_EVENT_LIVENESS_MS: '200' },
      listConnections: vi.fn(async () => [CONNECTION]),
      decrypt: vi.fn(() => 'sk-secret-1234'),
      persist: vi.fn(async () => ({ inserted: 0 })),
      createStream,
      now: () => 1_000_000,
      sleep,
      timers: fake.timers,
    });
    await handle.ready;
    await firstStarted.promise;

    // El watchdog se arma con la ventana de liveness.
    expect(fake.delays).toContain(200);
    fake.fireAll();

    await secondStarted.promise;

    // El primero se cortó y el loop volvió a abrir el stream.
    expect(signals[0]?.aborted).toBe(true);
    expect(attempts.get('conn-1')).toBe(2);
    expect(handle.connections).toBe(1);
    // La reconexión esperó el backoff inicial, no un valor inventado.
    expect(sleep).toHaveBeenCalledWith(1_000);

    // La salud sigue esperando frames: el plazo es el del intento nuevo.
    const health = snapshotHealth()['smartolt-events'];
    expect(health?.expected).toBe(true);
    expect(health?.nextRunAt).toBe(1_000_000 + 200);

    await handle.stop();
  });

  it('los pings de una conexión sana no tapan el plazo de la que no manda nada', async () => {
    const fake = fakeTimers();
    let clockNow = 1_000_000;
    const secondPingProcessed = deferred();

    const createStream: SmartoltEventStreamFactory = (connection) => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      events: async function* generator({ signal }: { signal?: AbortSignal } = {}) {
        if (connection.connectionId !== 'conn-a') {
          // La conexión colgada no manda ni un frame.
          await holdUntilAborted(signal);
          return;
        }
        yield { kind: 'ping' } as never;
        clockNow = 1_000_050;
        yield { kind: 'ping' } as never;
        // Después del segundo ping consumido, la prueba ya puede mirar la salud.
        secondPingProcessed.resolve();
        await holdUntilAborted(signal);
      },
    });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true', SMARTOLT_EVENT_LIVENESS_MS: '100' },
      listConnections: vi.fn(async () => [
        CONNECTION,
        { ...CONNECTION, id: 'conn-a' },
      ]),
      decrypt: vi.fn(() => 'sk-secret-1234'),
      persist: vi.fn(async () => ({ inserted: 0 })),
      createStream,
      now: () => clockNow,
      sleep: async () => {},
      timers: fake.timers,
    });
    await handle.ready;
    await secondPingProcessed.promise;

    const health = snapshotHealth()['smartolt-events'];
    // El plazo es el de la conexión colgada (1_000_000 + 100), no el que
    // renovó el ping de conn-a en 1_000_050 (que daría 1_000_150).
    expect(health?.nextRunAt).toBe(1_000_100);
    expect(health?.expected).toBe(true);
    expect(serviceStatus(health!, 1_000_090)).toBe('ok');
    expect(serviceStatus(health!, 1_000_100 + TICK_GRACE_MS + 1)).toBe('hung');

    await handle.stop();
  });

  it('stop() corta la espera entre reintentos en vez de esperar el backoff', async () => {
    const fake = fakeTimers();
    const firstStarted = deferred();

    const createStream: SmartoltEventStreamFactory = () => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      events: async function* generator({ signal }: { signal?: AbortSignal } = {}) {
        firstStarted.resolve();
        await holdUntilAborted(signal);
      },
    });
    // La espera entre reintentos no termina nunca: sólo el apagado la corta.
    const sleep = vi.fn(() => new Promise<void>(() => {}));

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true', SMARTOLT_EVENT_LIVENESS_MS: '50' },
      listConnections: vi.fn(async () => [CONNECTION]),
      decrypt: vi.fn(() => 'sk-secret-1234'),
      persist: vi.fn(async () => ({ inserted: 0 })),
      createStream,
      now: () => 1_000_000,
      sleep,
      timers: fake.timers,
    });
    await handle.ready;
    await firstStarted.promise;

    // El watchdog corta el stream: el loop entra en la espera del reintento.
    fake.fireAll();
    await vi.waitFor(() => expect(sleep).toHaveBeenCalled());

    const stoppedAt = performance.now();
    await handle.stop();

    expect(performance.now() - stoppedAt).toBeLessThan(100);
  });

  it('el watchdog de una conexión no se dispara con los frames de la otra', async () => {
    const fake = fakeTimers();
    const createStream: SmartoltEventStreamFactory = (connection) => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      events: async function* generator({ signal }: { signal?: AbortSignal } = {}) {
        if (connection.connectionId === 'conn-a') {
          yield { kind: 'ping' } as never;
          yield { kind: 'event', id: '1', batch: STATUS_BATCH } as never;
        }
        await holdUntilAborted(signal);
      },
    });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true', SMARTOLT_EVENT_LIVENESS_MS: '50' },
      listConnections: vi.fn(async () => [
        { ...CONNECTION, id: 'conn-b' },
        { ...CONNECTION, id: 'conn-a' },
      ]),
      decrypt: vi.fn(() => 'sk-secret-1234'),
      persist: vi.fn(async () => ({ inserted: 1 })),
      createStream,
      now: () => 1_000_000,
      sleep: async () => {},
      timers: fake.timers,
    });
    await handle.ready;

    // Una conexión por watchdog: dos conexiones vivas, dos timers armados.
    await vi.waitFor(() => expect(fake.pending()).toBe(2));
    expect(fake.delays.filter((ms) => ms === 50).length).toBeGreaterThanOrEqual(2);

    await handle.stop();
  });
});

describe('la salud con conexiones terminales', () => {
  /** El instante en que el plazo ya venció de largo (liveness + gracia). */
  const longAfterStart = 1_000_000 + DEFAULT_EVENT_LIVENESS_MS + TICK_GRACE_MS + 1;

  it('sin conexiones SmartOLT el loop no figura colgado', async () => {
    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: vi.fn(async () => []),
      decrypt: vi.fn(() => 'sk-secret-1234'),
      persist: vi.fn(async () => ({ inserted: 0 })),
      createStream: vi.fn(),
      now: () => 1_000_000,
    });
    await handle.ready;
    await handle.settled();

    const health = snapshotHealth()['smartolt-events'];
    expect(health).toBeDefined();
    // La prueba del defecto: con la bandera encendida y cero conexiones el
    // plazo que se publicó al arrancar vence y ya no lo renueva nadie.
    expect(serviceStatus(health!, longAfterStart)).not.toBe('hung');
    expect(detectHangedLoops(snapshotHealth(), longAfterStart)).toEqual([]);
    expect(overallHealthy(snapshotHealth(), undefined, longAfterStart)).toBe(true);
    expect(health?.expected).toBe(false);

    await handle.stop();
  });

  it('un `disabled` saca la conexión de la liveness y la salud dice por qué', async () => {
    const fake = fakeTimers();
    const harnessed = harness({ 'conn-1': [outcome('disabled')] });

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
      now: () => 1_000_000,
      sleep: async () => {},
      timers: fake.timers,
    });
    await handle.ready;
    await handle.settled();

    const health = snapshotHealth()['smartolt-events'];
    expect(health?.lastError).toMatch(/deshabilit/i);
    // No hay stream que vigilar: inactivo, nunca colgado. Pasada la ventana de
    // error reciente, el plazo sin dueño reportaba el loop como colgado.
    const muchLater = longAfterStart + 600_000;
    expect(serviceStatus(health!, muchLater)).toBe('inactive');
    expect(health?.expected).toBe(false);
    expect(detectHangedLoops(snapshotHealth(), muchLater)).toEqual([]);
    // El watchdog de la conexión se apagó con ella.
    expect(fake.pending()).toBe(0);

    await handle.stop();
  });

  it('un `fallback_polling` saca sólo esa conexión de la liveness', async () => {
    const fake = fakeTimers();
    const harnessed = harness();
    harnessed.listConnections.mockResolvedValue([
      CONNECTION,
      { ...CONNECTION, id: 'conn-2' },
    ]);
    harnessed.createStream.mockImplementation((connection) => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      events: async function* generator({ signal }: { signal?: AbortSignal } = {}) {
        if (connection.connectionId === 'conn-1') {
          yield outcome('fallback_polling') as never;
          return;
        }
        yield outcome('ping') as never;
        await holdUntilAborted(signal);
      },
    }));

    const handle = startSmartoltEventStreams({
      env: { [SMARTOLT_EVENTS_FLAG]: 'true' },
      listConnections: harnessed.listConnections,
      decrypt: harnessed.decrypt,
      persist: harnessed.persist,
      createStream: harnessed.createStream,
      now: () => 1_000_000,
      sleep: async () => {},
      timers: fake.timers,
    });
    await handle.ready;

    // La conexión que cayó al poll ya no tiene watchdog; la sana sí.
    await vi.waitFor(() => expect(fake.pending()).toBe(1));

    const health = snapshotHealth()['smartolt-events'];
    expect(health?.lastError).toMatch(/no disponible|poll/i);
    expect(health?.expected).toBe(true);
    expect(health?.nextRunAt).toBe(1_000_000 + DEFAULT_EVENT_LIVENESS_MS);

    await handle.stop();
  });
});
