export interface MockNmsResponse {
  status: number;
  body: unknown;
}

/** El único OLT del mock, y la ONU que le cuelga. */
const MOCK_OLT_ID = 'OLT-MOCK-1';

function mockOnu(): Record<string, unknown> {
  return {
    unique_external_id: 'ONU-MOCK-1',
    sn: 'SNMOCK0001',
    olt_id: MOCK_OLT_ID,
    board: '1',
    port: '1',
    onu: '0',
    onu_type_name: 'Huawei-HG8145V5',
    name: 'Cliente Mock',
    status: 'online',
    signal: '-21.5',
    signal_1490: '2.0',
    last_status_change: '2026-08-30T00:00:00Z',
  };
}

/**
 * La ruta y el query de un pedido, sin importar si viene con host o sin él.
 *
 * El cliente real manda `?page=1&page_size=100` a partir de la paginación, y
 * el mock tiene que contestar la misma forma paginada que la API: si no,
 * el staging ejercita un contrato que no existe.
 */
function parsePath(path: string): { pathname: string; query: URLSearchParams } {
  try {
    const url = new URL(path, 'http://mock-nms.local');
    return { pathname: url.pathname, query: url.searchParams };
  } catch {
    return { pathname: path.split('?')[0] ?? path, query: new URLSearchParams() };
  }
}

/**
 * Returns the SmartOLT-shaped response for a request path, matching the real
 * API shapes `SmartOltClient.realFetch` consumes. Lets the live connector run
 * against a local fake NMS with no physical OLTs/ONUs.
 *
 * Las formas salen de la especificación oficial (octubre 2026); los tests de
 * contrato las validan contra `contract/smartolt-openapi.subset.json`.
 */
export function smartoltMockResponse(path: string): MockNmsResponse {
  const { pathname, query } = parsePath(path);

  if (pathname.endsWith('/api/system/get_olts')) {
    return {
      status: 200,
      body: {
        status: true,
        response: [
          {
            id: MOCK_OLT_ID,
            name: 'Mock OLT 1',
            ip: '10.0.0.1',
            olt_hardware_version: 'Huawei-MA5800-X7',
            telnet_port: '2333',
            snmp_port: '2161',
          },
        ],
      },
    };
  }

  if (pathname.endsWith('/api/system/get_zones')) {
    return {
      status: 200,
      body: { status: true, response: [{ id: '1', name: 'Mock Zone' }] },
    };
  }

  if (pathname.includes('/api/olt/get_olt_uptime_and_env_temperature/')) {
    return {
      status: 200,
      body: {
        uptime: '12 days, 03:04',
        env_temp: '38°C',
        color_class: '',
        voltage: 53.6,
        voltage_read_at: '2026-11-02 10:45:12',
        power_state: 'normal',
        status: true,
        response_code: 'success',
      },
    };
  }

  if (pathname.endsWith('/api/onu/get_all_onus_details')) {
    const onus = [mockOnu()];
    // Sin `page` la API devuelve el export completo; con `page`, el sobre
    // paginado. El mock replica las dos formas.
    if (!query.has('page')) {
      return { status: 200, body: { status: true, onus } };
    }
    const pageSize = Number.parseInt(query.get('page_size') ?? '100', 10);
    return {
      status: 200,
      body: {
        status: true,
        page: Number.parseInt(query.get('page') ?? '1', 10),
        page_size: Number.isFinite(pageSize) ? pageSize : 100,
        total_items: onus.length,
        total_pages: 1,
        onus,
      },
    };
  }

  return { status: 404, body: { status: false } };
}
