import { afterEach, describe, expect, it } from 'vitest';
import { createMockNmsServer, type MockNmsServer } from '../src/mock-nms-server';

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
