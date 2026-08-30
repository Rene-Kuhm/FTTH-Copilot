export interface MockNmsResponse {
  status: number;
  body: unknown;
}

/**
 * Returns the Mikrowisp-shaped response for a request path, matching the real
 * API shapes `MikrowispClient.realFetch` consumes (`GetRouters` →
 * `{ estado: 'exito', routers }`, `GetMonitoreo` → `{ estado: 'exito', equipos }`).
 */
export function mikrowispMockResponse(path: string): MockNmsResponse {
  if (path.includes('GetRouters')) {
    return {
      status: 200,
      body: {
        estado: 'exito',
        routers: [{ id: 'RT-MOCK-1', nombre: 'Mock Router', ip: '10.0.0.1', estado: 'activo' }],
      },
    };
  }

  if (path.includes('GetMonitoreo')) {
    return {
      status: 200,
      body: {
        estado: 'exito',
        equipos: [{ id: 'EQ-MOCK-1', nombre: 'Mock ONU', equipo: 'Mock', ip: '10.0.0.2', estado: 1 }],
      },
    };
  }

  return { status: 404, body: { estado: 'error' } };
}
