import { afterEach, describe, expect, it } from 'vitest';
import {
  createMockNmsServer,
  resolveMockNmsBinding,
  startMockNmsFromEnv,
  type MockNmsServer,
} from '../src/mock-nms-server';

/**
 * El servidor del mock NMS.
 *
 * El staging necesita un NMS contra el que polear: sin él, la conexión que
 * crea el seed no se puede consultar y los loops no tienen nada que hacer.
 * El mock es el del propio repo (`smartoltMockResponse`), servido por HTTP
 * para que el conector real —el que aplica la política SSRF y habla con
 * `fetch`— sea el que se ejercita, y no un atajo por dentro.
 */
describe('el servidor del mock NMS', () => {
  let server: MockNmsServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('responde la lista de OLTs con la forma de la API de SmartOLT', async () => {
    server = await createMockNmsServer({ port: 0 });

    const res = await fetch(`${server.url}/api/system/get_olts`);
    const body = (await res.json()) as { status: boolean; response: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.status).toBe(true);
    expect(body.response[0]?.id).toBe('OLT-MOCK-1');
  });

  it('responde la lista de ONUs', async () => {
    server = await createMockNmsServer({ port: 0 });

    const res = await fetch(`${server.url}/api/onu/get_all_onus_details`);
    const body = (await res.json()) as { status: boolean; onus: Array<{ unique_external_id: string }> };

    expect(res.status).toBe(200);
    expect(body.onus[0]?.unique_external_id).toBe('ONU-MOCK-1');
  });

  it('responde 404 con lo que no sabe', async () => {
    server = await createMockNmsServer({ port: 0 });

    const res = await fetch(`${server.url}/api/system/get_lo_que_sea`);

    expect(res.status).toBe(404);
  });

  it('acepta el método que usa el conector', async () => {
    server = await createMockNmsServer({ port: 0 });

    const res = await fetch(`${server.url}/api/system/get_olts`, { method: 'POST' });

    expect(res.status).toBe(200);
  });

  it('escucha en el puerto que le piden', async () => {
    server = await createMockNmsServer({ port: 0 });

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toContain(String(server.port));
  });
});

/**
 * La dirección del mock sale del entorno, y el entorno lo puede garbar.
 *
 * Por qué importa: el servicio del compose lee `MOCK_NMS_PORT` y
 * `MOCK_NMS_HOST`. Si el puerto del entorno no es un número, el mock tiene
 * que caer en el puerto por defecto: levantarse en un puerto raro —o no
 * levantarse— deja al worker poleando contra nada.
 */
describe('la dirección del mock NMS según el entorno', () => {
  it('usa el puerto y la interfaz del entorno', () => {
    const binding = resolveMockNmsBinding({
      MOCK_NMS_PORT: '18081',
      MOCK_NMS_HOST: '0.0.0.0',
    });

    expect(binding).toEqual({ host: '0.0.0.0', port: 18081 });
  });

  it('cae en el puerto por defecto si el del entorno no es un número', () => {
    expect(resolveMockNmsBinding({}).port).toBe(18080);
    expect(resolveMockNmsBinding({ MOCK_NMS_PORT: '' }).port).toBe(18080);
    expect(resolveMockNmsBinding({ MOCK_NMS_PORT: 'no-es-un-puerto' }).port).toBe(18080);
  });

  it('acepta el puerto cero como "uno libre"', () => {
    // El cero es el "elegí un puerto libre" de Node. Los tests lo usan para
    // no arriesgarse a pisar el puerto de otro proceso.
    expect(resolveMockNmsBinding({ MOCK_NMS_PORT: '0' }).port).toBe(0);
  });

  it('cae en el loopback si la interfaz del entorno está vacía', () => {
    expect(resolveMockNmsBinding({ MOCK_NMS_HOST: '   ' }).host).toBe('127.0.0.1');
    expect(resolveMockNmsBinding({}).host).toBe('127.0.0.1');
  });
});

describe('el mock NMS levantado desde el entorno', () => {
  it('escucha donde dice el entorno y se apaga', async () => {
    const running = await startMockNmsFromEnv({
      MOCK_NMS_PORT: '0',
      MOCK_NMS_HOST: '127.0.0.1',
    });

    try {
      expect(running.server.port).toBeGreaterThan(0);

      const res = await fetch(`${running.server.url}/api/system/get_olts`);
      expect(res.status).toBe(200);
    } finally {
      await running.stop();
    }
  });
});
