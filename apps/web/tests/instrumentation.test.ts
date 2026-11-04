/**
 * The web does not run the background work any more.
 *
 * The worker owns the recurring loops, the UDP receivers and the drainer.
 * The web serves HTTP and the SSE stream, and nothing else: it does not
 * poll, it does not audit, it does not collect FEC telemetry, it does not
 * bind a socket and it does not schedule anything.
 *
 * The instrumentation still marks the loops as "not expected" in this
 * process, so /api/health stays honest about what this container is
 * responsible for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  /** Los módulos del camino en proceso: la web ya no los importa. */
  imported: new Set<string>(),
  markNotExpected: vi.fn(),
}));

vi.mock('@/lib/monitoring/scheduler', () => {
  mocks.imported.add('scheduler');
  return {
    startPollingLoop: vi.fn(),
    startFirmwareAuditLoop: vi.fn(),
    startFecCollectionLoop: vi.fn(),
  };
});

vi.mock('@/lib/monitoring/scheduler-health', () => ({
  markNotExpected: mocks.markNotExpected,
}));

vi.mock('@/lib/monitoring/syslog', () => {
  mocks.imported.add('syslog');
  return { startSyslogReceiver: vi.fn() };
});

vi.mock('@/lib/monitoring/snmp', () => {
  mocks.imported.add('snmp');
  return { startSnmpReceiver: vi.fn() };
});

vi.mock('@/lib/monitoring/event-ingest', () => {
  mocks.imported.add('event-ingest');
  return { startEventDrainer: vi.fn() };
});

vi.mock('@/lib/investigations/sweep', () => {
  mocks.imported.add('sweep');
  return { startInvestigationSweep: vi.fn() };
});

async function register(): Promise<void> {
  const mod = await import('@/instrumentation');
  await mod.register();
}

describe('instrumentation: el worker es el dueño del trabajo de fondo', () => {
  const originalRuntime = process.env['NEXT_RUNTIME'];
  const originalMode = process.env['BACKEND_MODE'];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.imported.clear();
    process.env['NEXT_RUNTIME'] = 'nodejs';
    delete process.env['BACKEND_MODE'];
    delete process.env['SNMP_RECEIVER_ENABLED'];
  });

  afterEach(() => {
    if (originalRuntime === undefined) delete process.env['NEXT_RUNTIME'];
    else process.env['NEXT_RUNTIME'] = originalRuntime;
    if (originalMode === undefined) delete process.env['BACKEND_MODE'];
    else process.env['BACKEND_MODE'] = originalMode;
    delete process.env['SNMP_RECEIVER_ENABLED'];
  });

  it('no arranca con las excepciones de la política SSRF activadas en producción', async () => {
    // En producción, una excepción de la política SSRF es un agujero hacia
    // la red interna. El web no levanta: el operador ve por qué.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NMS_ALLOW_HTTP', 'true');
    vi.stubEnv('DEPLOY_ENV', '');

    await expect(register()).rejects.toThrow(/política SSRF/);

    vi.unstubAllEnvs();
  });

  it('no importa el camino en proceso: ni los loops, ni los receptores, ni el barrido', async () => {
    await register();

    // Ni una sola importación: si la web no importa el módulo, no puede
    // arrancar nada en proceso. Es la forma de comprobar que el camino
    // embedded desapareció de verdad, y no sólo que dejó de llamarse.
    expect([...mocks.imported]).toEqual([]);
  });

  it('reporta los loops como no esperados en este proceso', async () => {
    await register();

    expect(mocks.markNotExpected).toHaveBeenCalledWith('polling');
    expect(mocks.markNotExpected).toHaveBeenCalledWith('firmware');
    expect(mocks.markNotExpected).toHaveBeenCalledWith('fec');
  });

  it('reporta los receptores como no esperados en este proceso', async () => {
    await register();

    // El receptor de syslog y el de SNMP bindean un puerto UDP: el kernel
    // entrega cada datagrama a un solo socket, así que el que no los bindea
    // esperaría por siempre mensajes que el otro sí recibe.
    expect(mocks.markNotExpected).toHaveBeenCalledWith('syslog');
    expect(mocks.markNotExpected).toHaveBeenCalledWith('syslog-detection');
    expect(mocks.markNotExpected).toHaveBeenCalledWith('snmp');
  });

  it('no barre los intentos de investigación abandonados: lo hace el worker', async () => {
    await register();

    expect(mocks.imported.has('sweep')).toBe(false);
  });

  it('arranca con el flag en worker', async () => {
    process.env['BACKEND_MODE'] = 'worker';

    await expect(register()).resolves.toBeUndefined();
  });

  it('arranca sin el flag: el worker es el modo por defecto', async () => {
    await expect(register()).resolves.toBeUndefined();
  });

  it('se niega a arrancar con el camino embedded: ese camino ya no existe', async () => {
    // Un entorno heredado que diga `embedded` es un entorno sin migrar. Si la
    // web aceptara el valor, seguiría sirviendo HTTP y nadie polosaría: el
    // fallo sería silencioso.
    process.env['BACKEND_MODE'] = 'embedded';

    await expect(register()).rejects.toThrow(/embedded/);
  });

  it('no hace nada fuera del runtime nodejs', async () => {
    process.env['NEXT_RUNTIME'] = 'edge';

    await register();

    expect(mocks.markNotExpected).not.toHaveBeenCalled();
  });
});
