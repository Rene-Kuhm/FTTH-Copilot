/**
 * El arranque del stream de eventos de SmartOLT en el worker.
 *
 * Lo que se prueba acá es el contrato del worker con el loop del scheduler: que
 * el default sea apagado (sin listar conexiones y sin tocar la salud), que con
 * la bandera encendida delegue con las opciones recibidas, que publique cuántos
 * streams abrió y que el apagado delegue en el loop.
 *
 * El loop en sí —SSE, persistencia, prioridad FEC— se prueba en
 * `@ftth-copilot/scheduler`, que es donde vive.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __setLogSinkForTests } from '@ftth-copilot/shared';

const mocks = vi.hoisted(() => ({
  startSmartoltEventStreams: vi.fn(),
}));

vi.mock('@ftth-copilot/scheduler', () => ({
  startSmartoltEventStreams: mocks.startSmartoltEventStreams,
}));

import { startWorkerSmartoltEventStreams } from '../src/events';

/** Un loop de mentira, como el que devuelve el scheduler. */
function loopHandle(overrides: {
  enabled?: boolean;
  connections?: number;
  ready?: Promise<void>;
} = {}) {
  let connections = overrides.connections ?? 0;
  let resolveReady: () => void = () => {};
  const ready =
    overrides.ready ??
    new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  const stop = vi.fn(async () => {});
  return {
    handle: {
      get enabled(): boolean {
        return overrides.enabled ?? true;
      },
      get connections(): number {
        connections += 1;
        return connections;
      },
      ready,
      settled: async () => {},
      stop,
    },
    resolveReady,
    stop,
  };
}

beforeEach(() => {
  mocks.startSmartoltEventStreams.mockReset();
  __setLogSinkForTests(null);
});

describe('startWorkerSmartoltEventStreams', () => {
  it('con la bandera apagada no arranca nada y lo deja dicho una vez', () => {
    mocks.startSmartoltEventStreams.mockReturnValue({
      enabled: false,
      connections: 0,
      ready: Promise.resolve(),
      settled: async () => {},
      stop: async () => {},
    });
    const lines: string[] = [];
    __setLogSinkForTests((line) => lines.push(line));

    const handle = startWorkerSmartoltEventStreams({ env: {} });

    expect(handle.enabled).toBe(false);
    expect(handle.connections).toBe(0);
    expect(lines.some((line) => line.includes('SMARTOLT_EVENTS_ENABLED'))).toBe(true);
  });

  it('con la bandera encendida delega en el scheduler con las opciones recibidas', async () => {
    const { handle: loop } = loopHandle({ enabled: true, connections: 2 });
    mocks.startSmartoltEventStreams.mockReturnValue(loop);
    const listConnections = vi.fn(async () => []);

    const handle = startWorkerSmartoltEventStreams({
      env: { SMARTOLT_EVENTS_ENABLED: 'true' },
      listConnections,
    });

    expect(mocks.startSmartoltEventStreams).toHaveBeenCalledWith({
      env: { SMARTOLT_EVENTS_ENABLED: 'true' },
      listConnections,
    });
    expect(handle.enabled).toBe(true);
    expect(handle.connections).toBeGreaterThanOrEqual(2);
  });

  it('loguea cuántos streams abrió cuando el arranque terminó', async () => {
    const { handle: loop, resolveReady } = loopHandle({ enabled: true, connections: 1 });
    mocks.startSmartoltEventStreams.mockReturnValue(loop);
    const lines: string[] = [];
    __setLogSinkForTests((line) => lines.push(line));

    startWorkerSmartoltEventStreams({ env: { SMARTOLT_EVENTS_ENABLED: 'true' } });
    resolveReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(
      lines.some(
        (line) => line.includes('SmartOLT event stream started') && line.includes('"connections"'),
      ),
    ).toBe(true);
  });

  it('stop() delega en el loop', async () => {
    const { handle: loop, stop } = loopHandle({ enabled: true });
    mocks.startSmartoltEventStreams.mockReturnValue(loop);

    const handle = startWorkerSmartoltEventStreams({ env: { SMARTOLT_EVENTS_ENABLED: 'true' } });
    await handle.stop();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stop() con la bandera apagada es un no-op', async () => {
    mocks.startSmartoltEventStreams.mockReturnValue({
      enabled: false,
      connections: 0,
      ready: Promise.resolve(),
      settled: async () => {},
      stop: vi.fn(async () => {}),
    });

    const handle = startWorkerSmartoltEventStreams({ env: {} });

    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
